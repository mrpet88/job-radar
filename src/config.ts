import type { SearchCriteria, Board } from "./types.js";
import { searchConfigFromEnv, type SearchProvider } from "./sources/search.js";

// ── EDIT THIS to change what you track. No code changes needed. ──
export const criteria: SearchCriteria = {
  // A job matches if ANY inner group matches; within a group ALL terms required.
  keywordsAny: [
    ["qa"],
    ["test", "automation"],
    ["quality", "engineer"],
    ["ai", "governance"],
    ["ai", "assurance"],
  ],
  excludeKeywords: ["intern", "stagiair", "werkstudent", "praktikum"],
  countries: ["nl", "gb", "de"], // Adzuna country codes
  remoteOnly: false,
  visaSponsorship: undefined,    // Arbeitnow: true / false / undefined(=any)
};

// ── Direct-ATS discovery ──────────────────────────────────────────
// ATS posting domains scanned by the search API (`<keywords> site:<domain>`).
// Every hit is parsed into a company board and remembered in data/boards.json.
export const atsDomains = [
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "jobs.lever.co",
  "jobs.ashbyhq.com",
  "myworkdayjobs.com",
];

// Provider for discovery: "brave" (BRAVE_API_KEY) or "google"
// (GOOGLE_API_KEY + GOOGLE_CSE_CX). Discovery auto-disables if keys are unset.
const searchProvider: SearchProvider = "brave";
// Harvesting known boards is free; only discovery spends search credits. Set
// JOB_RADAR_DISCOVER=false to skip discovery on a given run (the CI workflow does
// this on the evening run so the Brave free tier — ~1000 searches/mo — is enough).
const searchCfg = searchConfigFromEnv(searchProvider);
export const discovery = {
  ...searchCfg,
  enabled: searchCfg.enabled && process.env.JOB_RADAR_DISCOVER !== "false",
  maxQueriesPerRun: 25, // full coverage: keywordGroups × atsDomains
};

// Optional: pin high-signal company boards directly. These are harvested every
// run even without a search key. Discovered boards accumulate here automatically.
export const seedBoards: Board[] = [
  // { vendor: "greenhouse", token: "stripe", firstSeen: "2026-07-01" },
  // { vendor: "workday", token: "honeywell", dc: "wd1", site: "Honeywell_Careers", firstSeen: "2026-07-01" },
];

export const sources = {
  arbeitnow: { enabled: true },   // no key needed
  adzuna: {
    enabled: Boolean(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY),
    appId: process.env.ADZUNA_APP_ID ?? "",
    appKey: process.env.ADZUNA_APP_KEY ?? "",
    maxPagesPerCountry: 3,       // 50 results/page → 150/country
  },
  remoteok: { enabled: true },    // no key needed
  remotive: { enabled: true },    // no key needed
  jobicy: { enabled: true },      // no key needed
  jooble: {
    enabled: Boolean(process.env.JOOBLE_API_KEY),
    apiKey: process.env.JOOBLE_API_KEY ?? "",
  },
};
