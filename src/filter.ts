import type { Job, LocationPolicy, SearchCriteria } from "./types.js";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Match a location string against a list of terms. Short terms (≤3 chars, e.g.
// "nl", "us") use word boundaries so they don't match inside other words.
export const matchAny = (loc: string, terms: string[]): boolean =>
  terms.some((t) => {
    const term = t.toLowerCase();
    return term.length <= 3 ? new RegExp(`\\b${esc(term)}\\b`).test(loc) : loc.includes(term);
  });

// Keep jobs newer than maxAgeDays. Jobs without a parseable postedAt are kept
// (many ATS/Workday feeds omit it — dropping them would lose real roles).
export function isFresh(job: Job, maxAgeDays?: number): boolean {
  if (!maxAgeDays || !job.postedAt) return true;
  const t = Date.parse(job.postedAt);
  if (Number.isNaN(t)) return true;
  return (Date.now() - t) / 86_400_000 <= maxAgeDays;
}

// Remote → worldwide, minus explicitly low-pay markets. In-person/hybrid
// (remote=false) → only the onsite countries.
export function locationOk(job: Job, p?: LocationPolicy): boolean {
  if (!p) return true;
  const loc = job.location.toLowerCase().trim();
  const onsite = matchAny(loc, p.onsiteCountries);
  if (job.remote) {
    if (onsite) return true;                          // remote, based in NL etc.
    if (matchAny(loc, p.remoteExclude)) return false; // restricted to a low-pay market
    return true;                                      // worldwide / competitive / unspecified
  }
  return onsite;                                       // in-person/hybrid → onsite set only
}

// Word-boundary test: `term` present as a whole word (or phrase) in `hay`.
const wordIn = (hay: string, term: string) =>
  new RegExp(`\\b${esc(term.toLowerCase())}\\b`).test(hay);

export function matchesCriteria(job: Job, c: SearchCriteria): boolean {
  // Excludes scan everything (title/company/tags/description) — cast a wide net.
  // Word-boundary matching so "stage" doesn't trip on "staging environment" and
  // short tokens can't hit inside unrelated words.
  const full = `${job.title} ${job.company} ${job.tags.join(" ")} ${job.description ?? ""}`.toLowerCase();
  if (c.excludeKeywords.some((k) => wordIn(full, k))) return false;
  if (c.remoteOnly && !job.remote) return false;
  if (!isFresh(job, c.maxAgeDays)) return false;
  if (!locationOk(job, c.location)) return false;

  // Keyword match is title+tags only, with word boundaries, so a role must
  // actually *be* about the keyword — not merely mention it in boilerplate.
  // ANY group in ANY tier matches, where a group requires ALL its terms.
  const hay = `${job.title} ${job.tags.join(" ")}`.toLowerCase();
  return c.keywordTiers.some((t) => t.groups.some((g) => g.every((term) => wordIn(hay, term))));
}

// A QA signal in title/description — used to promote a bare "engineering manager"
// match (which is otherwise adjacent-tier, to avoid backend/infra EM false hits).
const QA_SIGNAL = /\b(qa|quality|test|sdet)\b/;
const isEngMgrGroup = (g: string[]) =>
  g.length === 2 && g[0] === "engineering" && g[1] === "manager";

// Score a matched job: the highest matched tier weight wins, with two adjustments —
// (1) "engineering manager" is promoted to lead weight when the title/description
// carries a QA signal; (2) demoteCompanies get their score halved. Returns the
// winning tier name and the numeric score used for ranking.
export function scoreJob(
  job: Job,
  c: SearchCriteria,
  demoteCompanies: string[] = [],
): { tier: string; score: number } {
  const hay = `${job.title} ${job.tags.join(" ")}`.toLowerCase();
  const has = (term: string) => wordIn(hay, term);
  const promoteEng = QA_SIGNAL.test(`${job.title} ${job.description ?? ""}`.toLowerCase());
  const leadWeight = c.keywordTiers.find((t) => t.tier === "lead")?.weight ?? 10;

  let bestScore = 0;
  let bestTier = "";
  for (const t of c.keywordTiers) {
    for (const g of t.groups) {
      if (!g.every(has)) continue;
      let weight = t.weight;
      let name = t.tier;
      if (isEngMgrGroup(g) && promoteEng) { weight = leadWeight; name = "lead"; }
      if (weight > bestScore) { bestScore = weight; bestTier = name; }
    }
  }
  if (bestScore > 0 &&
      demoteCompanies.some((d) => job.company.toLowerCase().includes(d.toLowerCase())))
    bestScore /= 2;
  return { tier: bestTier, score: bestScore };
}

// Cross-posting collapse: aggregators like Jobgether list one role across dozens of
// countries. Fold them to one row per (normalised title + company), preferring an
// NL or remote-EU variant, and record how many other locations were merged away.
const EU_HINT = /\b(eu|europe|european|emea|eea)\b/;
const normTitle = (t: string) =>
  t.toLowerCase()
    .replace(/\(.*?\)/g, " ")                       // drop "(m/f/d)", "(remote)", …
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(remote|hybrid|onsite|on site|fulltime|full time|parttime|part time)\b/g, " ")
    .trim().replace(/\s+/g, " ");

export function collapseCrossPosting(jobs: Job[], nlTerms: string[] = []): Job[] {
  const groups = new Map<string, Job[]>();
  for (const j of jobs) {
    const key = `${normTitle(j.title)}::${j.company.toLowerCase().trim()}`;
    const g = groups.get(key);
    if (g) g.push(j); else groups.set(key, [j]);
  }
  const out: Job[] = [];
  for (const list of groups.values()) {
    if (list.length === 1) { out.push(list[0]); continue; }
    const nl = list.find((j) => matchAny((j.location || "").toLowerCase(), nlTerms));
    const euRemote = list.find((j) => j.remote && EU_HINT.test((j.location || "").toLowerCase()));
    const anyRemote = list.find((j) => j.remote);
    const chosen = nl ?? euRemote ?? anyRemote ?? list[0];
    out.push({ ...chosen, otherLocations: list.length - 1 });
  }
  return out;
}

// Detect an explicit language demand in the posting body (NL roles often require
// C1/C2 or native Dutch). Captured for visibility only — never filtered on.
const LANG_PATTERNS: [RegExp, string][] = [
  [/\bc2\b/, "C2"],
  [/\bc1\b/, "C1"],
  [/\bmoedertaal\b/, "native Dutch (moedertaal)"],
  [/native\s+(dutch|nederlands)/, "native Dutch"],
  [/uitstekende beheersing van het nederlands/, "fluent Dutch"],
];
export function detectLanguageRequirement(desc?: string): string | undefined {
  if (!desc) return undefined;
  const d = desc.toLowerCase();
  for (const [re, label] of LANG_PATTERNS) if (re.test(d)) return label;
  return undefined;
}

export function dedupe(jobs: Job[]): Job[] {
  const seen = new Map<string, Job>();
  for (const j of jobs) if (!seen.has(j.id)) seen.set(j.id, j);
  return [...seen.values()];
}

// Compare against previously seen ids; return {all, fresh}.
export function diffNew(jobs: Job[], knownIds: Set<string>): { all: Job[]; fresh: Job[] } {
  const fresh = jobs.filter((j) => !knownIds.has(j.id));
  return { all: jobs, fresh };
}
