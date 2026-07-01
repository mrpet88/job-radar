import type { Board, Job, Vendor } from "./types.js";
import { hashId } from "./util/id.js";
import { webSearch, type SearchConfig } from "./sources/search.js";

type Candidate = Omit<Board, "firstSeen">;

export interface DiscoverResult {
  candidates: Candidate[];   // ATS boards to add to the registry
  webJobs: Job[];            // link-only hits on non-ATS-vendor domains
  queriesRun: number;
}

// Turn keyword groups × ATS domains into `terms site:domain` queries, run them
// through the search API, and parse the result URLs into board candidates.
export async function discover(
  keywordGroups: string[][],
  atsDomains: string[],
  cfg: SearchConfig,
  maxQueries: number,
  locationTerms: string[] = [],
): Promise<DiscoverResult> {
  const queries: string[] = [];
  for (const group of keywordGroups)
    for (const domain of atsDomains)
      queries.push(`${group.join(" ")} site:${domain}`);

  // Location-targeted: one broad query per (domain × term) — all keyword groups
  // OR'd together plus the location word — to find e.g. Dutch company boards.
  if (locationTerms.length) {
    const orClause = keywordGroups.map((g) => `"${g.join(" ")}"`).join(" OR ");
    for (const domain of atsDomains)
      for (const term of locationTerms)
        queries.push(`${orClause} ${term} site:${domain}`);
  }

  const capped = queries.slice(0, Math.max(0, maxQueries));
  const seenBoard = new Set<string>();
  const seenUrl = new Set<string>();
  const candidates: Candidate[] = [];
  const webJobs: Job[] = [];

  for (const q of capped) {
    for (const hit of await webSearch(q, cfg)) {
      const board = parseBoard(hit.url);
      if (board) {
        const k = `${board.vendor}:${board.token}:${board.site ?? ""}`.toLowerCase();
        if (!seenBoard.has(k)) { seenBoard.add(k); candidates.push(board); }
      } else if (!seenUrl.has(hit.url)) {
        seenUrl.add(hit.url);
        webJobs.push(toWebJob(hit));
      }
    }
  }

  return { candidates, webJobs, queriesRun: capped.length };
}

// Extract (vendor, token[, site, dc]) from an ATS posting URL. Returns null for
// URLs we can't map to a direct-fetch vendor.
export function parseBoard(raw: string): Candidate | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const seg = u.pathname.split("/").filter(Boolean);

  if (host.endsWith("greenhouse.io")) {
    // boards.greenhouse.io/{token}, job-boards.greenhouse.io/{token},
    // boards.greenhouse.io/embed/job_app?for={token}
    const forParam = u.searchParams.get("for");
    const token = forParam ?? (seg[0] === "embed" ? undefined : seg[0]);
    return token ? mk("greenhouse", token) : null;
  }
  if (host.endsWith("lever.co")) {
    return seg[0] ? mk("lever", seg[0]) : null;
  }
  if (host.endsWith("ashbyhq.com")) {
    return seg[0] ? mk("ashby", seg[0]) : null;
  }
  const wd = host.match(/^([^.]+)\.(wd\d+)\.myworkdayjobs\.com$/);
  if (wd) {
    const [, token, dc] = wd;
    // path: [locale?]/{site}/job/... — pick first non-locale, non-"job" segment.
    const site = seg.find((s) => !/^[a-z]{2}-[a-z]{2}$/i.test(s) && s !== "job" && s !== "details");
    return { vendor: "workday", token, dc, site: site ?? "External" };
  }
  return null;
}

function mk(vendor: Exclude<Vendor, "web" | "workday">, token: string): Candidate {
  return { vendor, token: token.replace(/[?#].*$/, "") };
}

function toWebJob(hit: { title: string; url: string; snippet?: string }): Job {
  const host = safeHost(hit.url);
  return {
    id: hashId(["web", host, hit.title]),
    source: "web",
    vendor: "web",
    title: hit.title,
    company: host,
    location: "",
    remote: false,
    url: hit.url,
    tags: [],
    description: hit.snippet?.slice(0, 300),
  };
}

const safeHost = (raw: string): string => {
  try { return new URL(raw).hostname.replace(/^www\./, ""); } catch { return "web"; }
};
