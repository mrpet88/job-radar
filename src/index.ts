import fs from "node:fs/promises";
import path from "node:path";
import type { Board, Job } from "./types.js";
import { criteria, sources, atsDomains, discovery, seedBoards, demoteCompanies } from "./config.js";
import { fetchArbeitnow } from "./sources/arbeitnow.js";
import { fetchAdzuna } from "./sources/adzuna.js";
import { fetchRemoteOk } from "./sources/remoteok.js";
import { fetchRemotive } from "./sources/remotive.js";
import { fetchJobicy } from "./sources/jobicy.js";
import { fetchJooble } from "./sources/jooble.js";
import { fetchBoard } from "./sources/ats/index.js";
import { discover } from "./discover.js";
import { loadBoards, saveBoards, mergeBoards, boardKey, loadDead, saveDead, pruneExpiredDead, loadDiscoveryOffset, saveDiscoveryOffset } from "./boards.js";
import { matchesCriteria, dedupe, diffNew, scoreJob, collapseCrossPosting, detectLanguageRequirement, matchAny } from "./filter.js";
import { renderHtml } from "./render.js";
import { pool } from "./util/http.js";

const DATA_DIR = path.resolve("data");
const STORE = path.join(DATA_DIR, "jobs.json");

async function loadKnownIds(): Promise<Set<string>> {
  try {
    const raw = await fs.readFile(STORE, "utf8");
    const prev = JSON.parse(raw) as Job[];
    return new Set(prev.map((j) => j.id));
  } catch { return new Set(); }
}

async function safe(label: string, fn: () => Promise<Job[]>): Promise<Job[]> {
  try { return await fn(); }
  catch (e) { console.warn(`[${label}] failed:`, (e as Error).message); return []; }
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const knownIds = await loadKnownIds();
  const collected: Job[] = [];

  // Denylist of gone (404) boards; expired entries drop so revived boards return.
  const dead = pruneExpiredDead(await loadDead());

  // ── Registry: start from saved boards + config seed boards ──
  let boards = mergeBoards(
    await loadBoards(),
    seedBoards.map(({ firstSeen, ...c }) => c),
  ).merged;

  // ── Discover new ATS boards via the search API ──
  // Discovery is restricted to lead-tier keyword groups: companies posting IC roles
  // get picked up anyway once any lead role surfaces their board, and every posting
  // on a known board is then harvested for free. This roughly halves query volume.
  if (discovery.enabled) {
    const leadGroups = criteria.keywordTiers.find((t) => t.tier === "lead")?.groups ?? [];
    const offset = await loadDiscoveryOffset();
    const { candidates, webJobs, queriesRun, nextOffset } =
      await discover(leadGroups, atsDomains, discovery, discovery.maxQueriesPerRun, discovery.locationTerms, offset);
    await saveDiscoveryOffset(nextOffset);
    const { merged, added } = mergeBoards(boards, candidates, dead);
    boards = merged;
    collected.push(...webJobs);
    console.log(`[discover] ${queriesRun} queries (offset ${offset}→${nextOffset}) → ${added.length} new boards, ${webJobs.length} web hits`);
  } else if (process.env.JOB_RADAR_DISCOVER === "false") {
    console.log("[discover] skipped (JOB_RADAR_DISCOVER=false — harvest-only run)");
  } else {
    console.log("[discover] skipped (no search API key — set BRAVE_API_KEY or GOOGLE_API_KEY+GOOGLE_CSE_CX)");
  }

  // ── Harvest every known board directly (no key, no quota) ──
  if (boards.length) {
    const now = new Date().toISOString();
    const gone = new Set<string>();   // returned 404/410 → the board is gone
    let flaky = 0;                    // transient errors (429/5xx/timeout)
    const harvested = await pool(boards, 5, async (b) => {
      try { const jobs = await fetchBoard(b); b.lastOk = now; b.fails = 0; return jobs; }
      catch (e) {
        b.fails = (b.fails ?? 0) + 1;
        if (/HTTP 4(04|10)/.test((e as Error).message)) gone.add(boardKey(b));
        else flaky++;
        return [];
      }
    });
    let n = 0;
    for (const r of harvested) { collected.push(...r); n += r.length; }
    console.log(`[ats] harvested ${boards.length} boards → ${n} jobs`);
    if (gone.size || flaky) console.log(`[ats] ${gone.size} gone (404), ${flaky} transient`);

    // Prune boards that failed MAX_FAILS runs in a row, and gone (404) boards
    // after 2 strikes — then denylist the gone ones so discovery stops re-adding.
    const MAX_FAILS = 3;
    const isDead = (b: Board) => (b.fails ?? 0) >= MAX_FAILS || (gone.has(boardKey(b)) && (b.fails ?? 0) >= 2);
    const dropped = boards.filter(isDead);
    boards = boards.filter((b) => !isDead(b));
    for (const b of dropped) if (gone.has(boardKey(b))) dead[boardKey(b)] = now;
    if (dropped.length) console.log(`[ats] pruned ${dropped.length} boards (${Object.keys(dead).length} denylisted)`);
  }

  // ── Aggregators ──
  if (sources.arbeitnow.enabled)
    collected.push(...await safe("arbeitnow", () =>
      fetchArbeitnow({ maxPages: 5, visaSponsorship: criteria.visaSponsorship })));

  // Flatten every tier's groups into a unique term list for keyword-search sources.
  const allTerms = [...new Set(criteria.keywordTiers.flatMap((t) => t.groups).flat())];

  if (sources.adzuna.enabled) {
    // Adzuna 'what_or' takes space-separated terms; flatten unique keyword terms.
    const what = allTerms.join(" ");
    collected.push(...await safe("adzuna", () => fetchAdzuna({
      appId: sources.adzuna.appId, appKey: sources.adzuna.appKey,
      countries: criteria.countries, what, maxPages: sources.adzuna.maxPagesPerCountry,
    })));
  } else {
    console.log("[adzuna] skipped (no ADZUNA_APP_ID / ADZUNA_APP_KEY set)");
  }

  if (sources.remoteok.enabled) collected.push(...await safe("remoteok", fetchRemoteOk));
  if (sources.remotive.enabled) collected.push(...await safe("remotive", fetchRemotive));
  if (sources.jobicy.enabled) collected.push(...await safe("jobicy", fetchJobicy));
  if (sources.jooble.enabled) {
    const keywords = allTerms.join(" ");
    collected.push(...await safe("jooble", () =>
      fetchJooble({ apiKey: sources.jooble.apiKey, keywords })));
  }

  // ── Filter → dedupe → collapse → score → diff → write ──
  const nlTerms = criteria.location?.onsiteCountries ?? [];
  const gated = dedupe(collected.filter((j) => matchesCriteria(j, criteria)));
  // Collapse cross-posted duplicates (same role across many countries) to one row.
  const collapsed = collapseCrossPosting(gated, nlTerms);
  // Score + detect language while the description is still present (both need it).
  const scored = collapsed.map((j) => {
    const { tier, score } = scoreJob(j, criteria, demoteCompanies);
    return { ...j, tier, score, languageRequirement: detectLanguageRequirement(j.description) };
  });
  const { all, fresh } = diffNew(scored, knownIds);
  const freshIds = new Set(fresh.map((f) => f.id));

  // Drop the description before storing/rendering: the card links straight to the
  // source posting, so the ad text isn't needed in the frontend. Keeps jobs.json
  // small and the dashboard a clean, scannable list. (excludeKeywords, scoring and
  // language detection already consumed the full description above.)
  const enriched = all.map((j) => ({ ...j, description: undefined, isNew: freshIds.has(j.id) }));
  // Rank by score (on-target lead roles first), then most recent.
  enriched.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) ||
    (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));

  await fs.writeFile(STORE, JSON.stringify(enriched, null, 2));
  await fs.writeFile(path.join(DATA_DIR, "index.html"), renderHtml(enriched, nlTerms));
  await saveBoards(boards);
  await saveDead(dead);

  const tierCount = (name: string) => enriched.filter((j) => j.tier === name).length;
  const collapsedAway = enriched.reduce((n, j) => n + (j.otherLocations ?? 0), 0);
  const leadNl = enriched.filter((j) =>
    j.tier === "lead" &&
    (matchAny((j.location || "").toLowerCase(), nlTerms) ||
      (j.remote && /\b(eu|europe|european|emea|eea)\b/.test((j.location || "").toLowerCase()))));

  console.log(`\n── Job Radar ──`);
  console.log(`known boards:     ${boards.length}`);
  console.log(`collected (raw):  ${collected.length}`);
  console.log(`gated+deduped:    ${gated.length}`);
  console.log(`after collapse:   ${enriched.length}  (${collapsedAway} cross-posts folded)`);
  console.log(`by tier:          lead ${tierCount("lead")} · adjacent ${tierCount("adjacent")} · ic ${tierCount("ic")}`);
  console.log(`lead NL/remote-EU: ${leadNl.length}`);
  console.log(`NEW this run:     ${fresh.length}`);
  console.log(`→ data/jobs.json + data/index.html + data/boards.json written`);
  if (leadNl.length) {
    console.log(`\nLead-tier NL / remote-EU:`);
    for (const j of leadNl.slice(0, 25))
      console.log(`  • [${j.score}] ${j.title} — ${j.company} (${j.location || "?"})${j.otherLocations ? ` +${j.otherLocations} loc` : ""}${j.languageRequirement ? ` {${j.languageRequirement}}` : ""} [${j.source}]`);
  }
  if (fresh.length) {
    console.log(`\nNew roles:`);
    for (const j of fresh.slice(0, 15))
      console.log(`  • ${j.title} — ${j.company} (${j.location || "?"}) [${j.source}]`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
