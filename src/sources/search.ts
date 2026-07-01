import { getJson } from "../util/http.js";

export interface SearchHit { title: string; url: string; snippet?: string; }

export type SearchProvider = "brave" | "google";

export interface SearchConfig {
  enabled: boolean;
  provider: SearchProvider;
  braveKey?: string;
  googleKey?: string;
  googleCx?: string;              // Google Programmable Search engine id
}

// Read search config from env. Enabled only when the chosen provider has its key(s).
export function searchConfigFromEnv(provider: SearchProvider): SearchConfig {
  const braveKey = process.env.BRAVE_API_KEY;
  const googleKey = process.env.GOOGLE_API_KEY;
  const googleCx = process.env.GOOGLE_CSE_CX;
  const enabled =
    provider === "brave" ? Boolean(braveKey) : Boolean(googleKey && googleCx);
  return { enabled, provider, braveKey, googleKey, googleCx };
}

// One web search → up to ~20 hits. Never throws: returns [] on failure so a bad
// query can't sink the whole run.
export async function webSearch(query: string, cfg: SearchConfig): Promise<SearchHit[]> {
  try {
    return cfg.provider === "brave" ? await brave(query, cfg) : await google(query, cfg);
  } catch (e) {
    console.warn(`[search] "${query}" failed: ${(e as Error).message}`);
    return [];
  }
}

async function brave(query: string, cfg: SearchConfig): Promise<SearchHit[]> {
  const u = new URL("https://api.search.brave.com/res/v1/web/search");
  u.searchParams.set("q", query);
  u.searchParams.set("count", "20");
  const data = await getJson<{ web?: { results?: { title: string; url: string; description?: string }[] } }>(u, {
    headers: { "X-Subscription-Token": cfg.braveKey ?? "" },
  });
  return (data.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.description }));
}

async function google(query: string, cfg: SearchConfig): Promise<SearchHit[]> {
  const u = new URL("https://www.googleapis.com/customsearch/v1");
  u.searchParams.set("key", cfg.googleKey ?? "");
  u.searchParams.set("cx", cfg.googleCx ?? "");
  u.searchParams.set("q", query);
  u.searchParams.set("num", "10");
  const data = await getJson<{ items?: { title: string; link: string; snippet?: string }[] }>(u);
  return (data.items ?? []).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet }));
}
