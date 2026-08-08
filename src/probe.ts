import type { Board } from "./types.js";
import { fetchBoard } from "./sources/ats/index.js";
import { pool } from "./util/http.js";

// Free board discovery: guess a company's ATS slug from its name and try the
// vendor APIs directly. Search-based discovery (discover.ts) costs Brave credits
// and is capped at 20 queries/run over a ~160-query rotation, so a named company
// can wait weeks to surface. Probing is unmetered — it only spends HTTP requests.
//
// Workday is deliberately not probed: it needs tenant + data centre + site, and a
// company name yields at most the first, so guesses would be almost all misses.
const VENDORS = [
  "greenhouse", "lever", "ashby", "recruitee", "workable", "smartrecruiters", "teamtailor",
] as const;
export type ProbeVendor = (typeof VENDORS)[number];

// Legal-form and geography suffixes that companies put in their registered name
// but almost never in their careers slug ("Acme Holding B.V." → "acme").
// Longest-first so "-b-v" wins over "-v" when both could match the tail.
const SUFFIXES = ["netherlands", "nederland", "holding", "group", "b-v", "n-v", "bv", "nv"];
const SUFFIX_RE = new RegExp(`(?:-(?:${SUFFIXES.join("|")}))+$`);

// "Booking.com" → "booking-com", "Just Eat Takeaway" → "just-eat-takeaway".
export const deriveSlug = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Up to four slugs to try per company: the plain one, the same with legal/geo
// suffixes stripped, and the de-hyphenated form of each ("bookingcom", "tomtom").
export function slugVariants(name: string): string[] {
  const base = deriveSlug(name);
  const stripped = base.replace(SUFFIX_RE, "");
  const out = [base, stripped, base.replace(/-/g, ""), stripped.replace(/-/g, "")];
  return [...new Set(out.filter(Boolean))];
}

export interface ProbeEntry {
  resolved?: { vendor: ProbeVendor; token: string };
  lastTried: string;   // ISO date of the last probe sweep for this company
  attempts: number;    // how many sweeps it has taken (unresolved companies only)
}
export type ProbeState = Record<string, ProbeEntry>;

export interface ProbeResult {
  candidates: Omit<Board, "firstSeen">[];
  state: ProbeState;
  tried: number;       // companies actually probed this run
  resolved: number;    // of those, how many found a board
  skipped: number;     // already resolved, or still inside the retry TTL
}

// A company counts as resolved only when the endpoint answers AND carries at
// least one job. Reusing fetchBoard() means a resolved board is by construction
// one the harvester can already read — no second, subtly different client.
async function tryBoard(vendor: ProbeVendor, token: string): Promise<boolean> {
  try {
    const jobs = await fetchBoard({ vendor, token, firstSeen: "" } as Board);
    return jobs.length > 0;
  } catch { return false; }
}

// Probe each company across its slug variants × vendors, stopping at the first
// hit. Unresolved companies are retried only after `ttlDays`, mirroring how
// pruneExpiredDead() ages out the board denylist in boards.ts — without it every
// run would re-probe the same misses forever.
export async function probe(
  companies: string[],
  state: ProbeState,
  ttlDays = 30,
  concurrency = 8,
): Promise<ProbeResult> {
  const now = new Date().toISOString();
  const cutoff = Date.now() - ttlDays * 86_400_000;

  const due = companies.filter((c) => {
    const e = state[c];
    if (!e) return true;
    if (e.resolved) return false;
    const t = Date.parse(e.lastTried);
    return Number.isNaN(t) || t < cutoff;
  });

  const next: ProbeState = { ...state };
  const candidates: Omit<Board, "firstSeen">[] = [];

  await pool(due, concurrency, async (company) => {
    const prev = next[company];
    let hit: { vendor: ProbeVendor; token: string } | undefined;
    outer: for (const token of slugVariants(company)) {
      for (const vendor of VENDORS) {
        if (await tryBoard(vendor, token)) { hit = { vendor, token }; break outer; }
      }
    }
    next[company] = {
      ...(hit ? { resolved: hit } : {}),
      lastTried: now,
      attempts: (prev?.attempts ?? 0) + 1,
    };
    // `name` is the configured company name, which beats prettify()'s guess at a
    // display name derived from the slug.
    if (hit) candidates.push({ vendor: hit.vendor, token: hit.token, name: company });
  });

  return {
    candidates,
    state: next,
    tried: due.length,
    resolved: candidates.length,
    skipped: companies.length - due.length,
  };
}
