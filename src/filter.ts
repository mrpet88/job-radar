import type { Job, SearchCriteria } from "./types.js";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function matchesCriteria(job: Job, c: SearchCriteria): boolean {
  // Excludes scan everything (title/company/tags/description) — cast a wide net.
  const full = `${job.title} ${job.company} ${job.tags.join(" ")} ${job.description ?? ""}`.toLowerCase();
  if (c.excludeKeywords.some((k) => full.includes(k.toLowerCase()))) return false;
  if (c.remoteOnly && !job.remote) return false;

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
