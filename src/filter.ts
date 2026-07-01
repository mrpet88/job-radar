import type { Job, LocationPolicy, SearchCriteria } from "./types.js";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Match a location string against a list of terms. Short terms (≤3 chars, e.g.
// "nl", "us") use word boundaries so they don't match inside other words.
const matchAny = (loc: string, terms: string[]): boolean =>
  terms.some((t) => {
    const term = t.toLowerCase();
    return term.length <= 3 ? new RegExp(`\\b${esc(term)}\\b`).test(loc) : loc.includes(term);
  });

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

export function matchesCriteria(job: Job, c: SearchCriteria): boolean {
  // Excludes scan everything (title/company/tags/description) — cast a wide net.
  const full = `${job.title} ${job.company} ${job.tags.join(" ")} ${job.description ?? ""}`.toLowerCase();
  if (c.excludeKeywords.some((k) => full.includes(k.toLowerCase()))) return false;
  if (c.remoteOnly && !job.remote) return false;
  if (!locationOk(job, c.location)) return false;

  // Keyword match is title+tags only, with word boundaries, so a role must
  // actually *be* about the keyword — not merely mention it in boilerplate.
  // ANY group matches, where a group requires ALL its terms.
  const hay = `${job.title} ${job.tags.join(" ")}`.toLowerCase();
  const has = (term: string) => new RegExp(`\\b${esc(term.toLowerCase())}\\b`).test(hay);
  return c.keywordsAny.some((group) => group.every(has));
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
