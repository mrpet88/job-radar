// One normalized shape every source maps into.
export type Vendor = "greenhouse" | "lever" | "ashby" | "workday" | "web";

export interface Job {
  id: string;            // stable hash: source+company+title+location
  source: string;        // 'adzuna' | 'arbeitnow' | 'greenhouse' | ...
  vendor?: Vendor;       // set for ATS/discovery-sourced jobs
  title: string;
  company: string;
  location: string;
  remote: boolean;
  url: string;
  salaryMin?: number;
  salaryMax?: number;
  currency?: string;
  tags: string[];
  postedAt?: string;     // ISO date when known
  description?: string;  // short snippet
}

// A company career board we know how to harvest directly.
// `site`/`dc` are only meaningful for Workday tenants.
export interface Board {
  vendor: Exclude<Vendor, "web">;
  token: string;         // greenhouse token / lever slug / ashby name / workday tenant
  site?: string;         // workday site (e.g. "External")
  dc?: string;           // workday data center (e.g. "wd1")
  name?: string;         // display name once resolved
  firstSeen: string;     // ISO date the board entered the registry
  lastOk?: string;       // ISO date of last successful harvest
  fails?: number;        // consecutive harvest failures (reset to 0 on success)
}

// Location policy: remote roles are worldwide (minus low-pay markets); in-person
// and hybrid roles are restricted to onsiteCountries.
export interface LocationPolicy {
  onsiteCountries: string[]; // in-person/hybrid kept only if location matches one
  remoteExclude: string[];   // remote dropped if location is restricted to one
}

export interface SearchCriteria {
  // keyword groups: a job matches if ANY group fully matches.
  // within a group, ALL terms must appear (AND). across groups: OR.
  keywordsAny: string[][];     // e.g. [["qa","head"], ["ai","governance"]]
  excludeKeywords: string[];   // drop if any of these appear
  countries: string[];         // adzuna country codes: ['nl','gb','de']
  remoteOnly: boolean;
  visaSponsorship?: boolean;   // arbeitnow only
  location?: LocationPolicy;   // geo filter applied to every source
}
