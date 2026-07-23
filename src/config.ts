import type { SearchCriteria, Board } from "./types.js";
import { searchConfigFromEnv, type SearchProvider } from "./sources/search.js";
// ── EDIT THIS to change what you track. No code changes needed. ──
export const criteria: SearchCriteria = {
  // Weighted keyword tiers. A job matches if ANY group in ANY tier fully matches;
  // within a group ALL terms are required. The highest matched tier weight is the
  // job's score, which drives ranking. Tiers, high → low: lead, adjacent, ic.
  keywordTiers: [
    {
      tier: "lead", weight: 10, groups: [
        ["qa", "lead"],
        ["qa", "manager"],
        ["test", "lead"],
        ["test", "manager"],
        ["testmanager"],              // Dutch postings run it as one word
        ["quality", "lead"],
        ["quality", "manager"],
        ["quality", "engineering", "manager"],
        ["head", "of", "quality"],
        ["head", "of", "qa"],
        ["qa", "director"],
        ["qa", "engineering", "manager"],
        ["qa", "engineering", "lead"],
        ["qa", "automation", "lead"],
        ["team", "lead", "test"],
        ["teamlead", "qa"],
        ["testcoordinator"],          // real NL title, lead-adjacent
        ["test", "architect"],        // Polteq-style, routes into lead work
        ["quality", "coach"],
      ],
    },
    {
      // "engineering manager" alone was the biggest false-positive source last run
      // (backend/infra EMs with no QA content), so it sits here at adjacent weight.
      // A match is promoted to lead weight only when the title/description also
      // carries a QA signal (qa / quality / test / sdet) — see scoreJob in filter.ts.
      tier: "adjacent", weight: 5, groups: [
        ["platform", "product", "manager"],
        ["quality", "product", "manager"],
        ["engineering", "operations"],
        ["test", "consultant"],       // Polteq/Sogeti lead track under a consultant title
        ["engineering", "manager"],
      ],
    },
    {
      // IC roles: kept for coverage but scored low so they sink below lead/adjacent.
      tier: "ic", weight: 1, groups: [
        ["sdet"],
        ["software", "engineer", "test"],
        ["qa", "automation"],
        ["test", "automation"],
        ["quality", "engineer"],
        ["automation", "engineer"],
        ["qa", "engineer"],
      ],
    },
  ],
  // Exclusions match on word boundaries (see matchesCriteria), so "stage" no longer
  // trips on "staging environment" and short tokens can't hit inside longer words.
  excludeKeywords: [
  // seniority
  "intern", "stagiair", "stage", "werkstudent", "praktikum",
  "junior", "medior", "traineeship", "afstudeer",

  // wrong QA domain (pharma / food / medical device)
  "qa officer", "quality officer", "qhse",
  "gmp", "gxp", "iso 13485", "haccp", "pharmaceutical", "farmaceut",
  "clinical", "laborant", "laboratorium", "microbiolog",

  // manufacturing / physical quality
  "quality control", "qc engineer", "kwaliteitscontrole",
  "weld", "lasser", "cnc", "hvac", "werktuigbouw",
  "supplier quality", "incoming inspection", "calibration", "process engineer",

  // non-software
  "horeca", "catering",
],
  countries: ["nl", "gb", "de"], // Adzuna country codes
  remoteOnly: false,
  visaSponsorship: undefined,    // Arbeitnow: true / false / undefined(=any)
  location: {
    // In-person & hybrid roles are kept ONLY if the location matches one of these.
    onsiteCountries: [
      "netherlands", "nederland", "holland", "nl", "amsterdam", "rotterdam",
      "the hague", "den haag", "utrecht", "eindhoven", "groningen", "tilburg",
      "haarlem", "nijmegen", "almere", "breda", "arnhem", "amersfoort", "leiden", "delft",
    ],
    // Remote roles are kept worldwide EXCEPT when restricted to these lower-pay markets.
    remoteExclude: [
      "india", "pakistan", "bangladesh", "sri lanka", "philippines", "indonesia",
      "vietnam", "thailand", "malaysia", "china", "nepal", "brazil", "argentina",
      "colombia", "mexico", "peru", "chile", "venezuela", "ecuador", "nigeria",
      "kenya", "ghana", "egypt", "south africa", "morocco", "turkey", "türkiye",
      "ukraine", "latam", "latin america",
    ],
  },
  maxAgeDays: 30, // drop postings older than 30 days (set undefined for no limit)
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
// NB: Google's Custom Search JSON API is closed to new Cloud projects — a fresh
// project returns 403 "does not have the access" even with the API enabled and the
// key correctly scoped — so we stay on Brave. Its "search the entire web" mode is
// also deprecated, confirming the product is being wound down.
const searchProvider: SearchProvider = "brave";
// Harvesting known boards is free; only discovery spends search credits. Set
// JOB_RADAR_DISCOVER=false to run harvest-only on a given run (e.g. a manual
// dispatch you don't want to spend quota on).
const searchCfg = searchConfigFromEnv(searchProvider);
export const discovery = {
  ...searchCfg,
  enabled: searchCfg.enabled && process.env.JOB_RADAR_DISCOVER !== "false",
  // Only the first maxQueriesPerRun of the generated queries run each day, but the
  // window rotates (persisted offset in data/discovery-state.json) so the whole
  // lead-tier query list is covered over several runs instead of the tail never
  // running. 20/day (~600/mo) stays under Brave's ~$5/mo credit (≈1,000 queries) so
  // daily discovery isn't billed — Brave dropped its free tier in Feb 2026; see
  // docs/discovery-provider.md.
  maxQueriesPerRun: 20,
  // Extra location-targeted discovery: for each term, one broad query per ATS
  // domain (lead-tier groups OR'd + term) to surface companies hiring in that region.
  locationTerms: ["netherlands"],
};
// Companies that flood the feed (Jobgether cross-posts one role across dozens of
// countries) or post off-domain roles (Synsel Techniek = manufacturing quality).
// Their score is halved rather than excluded, so genuine hits still surface but sink.
export const demoteCompanies = ["Jobgether", "Synsel Techniek"];
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
