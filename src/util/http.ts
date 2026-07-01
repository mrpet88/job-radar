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
