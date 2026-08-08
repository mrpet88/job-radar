// Minimal HTTP helpers — native fetch only, no deps (matches the repo convention).

const UA = "job-radar/1.0 (+https://github.com/) personal-job-tracker";

interface FetchOpts {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  retries?: number;
}

// Fetch JSON with a timeout and one retry on 429/5xx / network error.
export async function getJson<T>(url: string | URL, opts: FetchOpts = {}): Promise<T> {
  const { method = "GET", headers = {}, body, timeoutMs = 15000, retries = 1 } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        body,
        headers: { "user-agent": UA, accept: "application/json", ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
        if (attempt < retries) { await sleep(500 * (attempt + 1)); continue; }
        throw lastErr;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) { await sleep(500 * (attempt + 1)); continue; }
      throw lastErr;
    }
  }
  throw lastErr;
}

// Cap on a text response. Feeds are hand-sized, but one real Teamtailor board
// (anicuraglobal) returns ~9.5 MB, so "it'll be small" is not a safe assumption
// and an unbounded read is a memory hazard on a shared CI runner.
const MAX_TEXT_BYTES = 20 * 1024 * 1024;

// Fetch text (RSS/XML) with a timeout and one retry — getJson's contract, minus
// the JSON parse, plus a size guard. The default timeout is longer because these
// payloads are megabytes rather than kilobytes.
export async function getText(url: string | URL, opts: FetchOpts = {}): Promise<string> {
  const { method = "GET", headers = {}, body, timeoutMs = 30000, retries = 1 } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        body,
        headers: { "user-agent": UA, accept: "application/rss+xml, application/xml, text/xml, */*", ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
        if (attempt < retries) { await sleep(500 * (attempt + 1)); continue; }
        throw lastErr;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await readCapped(res, MAX_TEXT_BYTES);
    } catch (e) {
      lastErr = e;
      if (attempt < retries) { await sleep(500 * (attempt + 1)); continue; }
      throw lastErr;
    }
  }
  throw lastErr as Error;
}

// Read a body while counting bytes, aborting once the cap is passed. Streaming is
// the load-bearing check: content-length (when sent at all) describes the
// compressed payload, so only the decoded stream reveals the true size.
async function readCapped(res: Response, max: number): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max)
    throw new Error(`response too large: content-length ${declared} > ${max} bytes`);
  if (!res.body) return res.text();

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new Error(`response too large: exceeded ${max} bytes`);
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
}

// Defence-in-depth for URLs built by interpolating a board token: re-parse the
// finished URL and confirm it still points where we think it does. Tokens reach
// the registry from search-result URLs (attacker-influenced), so a token carrying
// "/", "@" or "." could otherwise redirect the request to another host — most
// dangerously on Recruitee, where the token sits in the host position.
export function assertHost(url: string, expected: string): void {
  let host: string;
  try { host = new URL(url).hostname.toLowerCase(); }
  catch { throw new Error(`unparseable URL for host ${expected}`); }
  // Hostnames are case-insensitive; URL already lower-cases the parsed side.
  if (host !== expected.toLowerCase()) throw new Error(`host mismatch: ${host} !== ${expected}`);
}

// Run `fn` over `items` with at most `n` in flight. Preserves input order.
export async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export const stripHtml = (s?: string): string =>
  (s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// "acme-corp" / "acme_corp" -> "Acme Corp". Fallback display name from a slug.
export const prettify = (slug: string): string =>
  slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export const isRemoteText = (s: string): boolean =>
  /\bremote\b|thuiswerk|homeoffice|work from home|anywhere/i.test(s);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
