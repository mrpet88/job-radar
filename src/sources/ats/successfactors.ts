import type { Board, Job } from "../../types.js";
import { getText, stripHtml, isRemoteText, assertHost, bodyFields, pool, type FetchOpts } from "../../util/http.js";
import { hashId } from "../../util/id.js";
import { unescape } from "../../util/xml.js";

// SAP SuccessFactors career sites ("Recruiting Marketing"). Big enterprises and
// public bodies run on it — EU agencies included (EMA: careers.ema.europa.eu) —
// and none of them show up on the startup-stack vendors.
//
// No API. Every tenant serves the same undocumented HTML fragment:
//   https://<host>/tile-search-results/?q=&startrow=<n>
// one <li class="job-tile job-id-N"> per posting, paged by row offset. Page size is
// per tenant (EMA 5, Capgemini 25), so the offset advances by what each page held.
//
// Tenants live on vanity domains, so unlike Greenhouse/Lever there's no shared host
// for discovery to search or for probing to guess — boards are seeded by hand in
// config.seedBoards, with `token` set to the host.
//
// What a tile shows is configured per tenant (EMA shows the deadline, not the
// location), so tiles are only trusted for title + URL. Location comes from the
// board config; date and body from the posting page, fetched only for titles that
// pass the keyword gate — a tenant like Capgemini lists thousands of roles.

const MAX_PAGES = 40;      // with 25-row pages, ~1,000 postings per board per run
const DETAIL_CONCURRENCY = 3;

interface Tile { id: string; title: string; path: string }

const TILE_RE = /<li class="job-tile job-id-(\d+)[\s\S]*?(?=<li class="job-tile |$)/g;
const TITLE_RE = /class="jobTitle-link[^"]*"[^>]*href="([^"]+)"[^>]*>\s*([^<]*?)\s*<\/a>/;

export function parseTiles(html: string): Tile[] {
  const out: Tile[] = [];
  for (const m of html.matchAll(TILE_RE)) {
    // A tile repeats its title link for the desktop/tablet/mobile layouts; the
    // first one is enough.
    const t = m[0].match(TITLE_RE);
    if (t) out.push({ id: m[1], path: unescape(t[1]), title: unescape(t[2]) });
  }
  return out;
}

// "Tue Oct 06 00:00:00 UTC 2026" — Java's Date.toString(), which Date.parse can't
// read reliably because the year comes last. Reorder it into something it can.
export function toIso(raw?: string): string | undefined {
  const m = raw?.trim().match(/^\w{3} (\w{3}) (\d{1,2}) (\d{2}:\d{2}:\d{2}) UTC (\d{4})$/);
  if (!m) return undefined;
  const t = Date.parse(`${m[2]} ${m[1]} ${m[4]} ${m[3]} UTC`);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

export function parseDetail(html: string): { postedAt?: string; body: string } {
  const posted = html.match(/itemprop="datePosted"[^>]*content="([^"]*)"/)?.[1];
  // The description span holds nested markup; it ends where its container div
  // does. Capped so a malformed page can't turn into a megabyte of "body".
  const start = html.indexOf('class="jobdescription"');
  let body = "";
  if (start >= 0) {
    const rest = html.slice(start, start + 100_000);
    const end = rest.search(/<\/span>\s*<\/div>/);
    body = unescape(stripHtml(rest.slice(rest.indexOf(">") + 1, end > 0 ? end : undefined)));
  }
  return { postedAt: toIso(posted), body };
}

export async function fetchSuccessFactors(
  board: Board, opts?: FetchOpts, titleGate?: (title: string) => boolean,
): Promise<Job[]> {
  const host = board.token.toLowerCase();
  // The token is the whole host, so refuse anything that isn't one before it goes
  // anywhere near a URL.
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) throw new Error(`bad successfactors host: ${board.token}`);

  const listUrl = (row: number) => {
    const u = new URL(`https://${host}/tile-search-results/`);
    u.searchParams.set("q", "");
    // Newest first, so if MAX_PAGES ever truncates a board it's the stale tail.
    u.searchParams.set("sortColumn", "referencedate");
    u.searchParams.set("sortDirection", "desc");
    if (board.locationSearch) u.searchParams.set("locationsearch", board.locationSearch);
    u.searchParams.set("startrow", String(row));
    return u.toString();
  };

  // Past the last page the endpoint doesn't return nothing — it serves page one
  // again. So stop on a page that brings no new ids, not only on an empty one.
  const tiles = new Map<string, Tile>();
  let row = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = listUrl(row);
    assertHost(url, host);
    const batch = parseTiles(await getText(url, opts));
    const fresh = batch.filter((t) => !tiles.has(t.id));
    if (!fresh.length) break;
    for (const t of fresh) tiles.set(t.id, t);
    row += batch.length;
    if (page === MAX_PAGES - 1) console.warn(`[successfactors] ${host}: stopped at ${MAX_PAGES} pages (${tiles.size} roles)`);
  }

  const company = board.name ?? host;
  const location = board.location ?? board.locationSearch ?? "";

  return pool([...tiles.values()], DETAIL_CONCURRENCY, async (t) => {
    const url = new URL(t.path, `https://${host}`).toString();
    assertHost(url, host);
    let detail: { postedAt?: string; body: string } = { body: "" };
    // Titles that can't pass the keyword filter are dropped downstream anyway, so
    // they never earn a request. A failed detail fetch keeps the role, bodiless —
    // losing a real posting is worse than judging one on its title.
    if (!titleGate || titleGate(t.title)) {
      try { detail = parseDetail(await getText(url, opts)); }
      catch (e) { console.warn(`[successfactors] ${host}: detail ${t.id} failed: ${(e as Error).message}`); }
    }
    return {
      id: hashId(["successfactors", company, t.title, location]),
      source: "successfactors",
      vendor: "successfactors",
      title: t.title,
      company,
      location,
      remote: isRemoteText(`${t.title} ${location}`),
      url,
      tags: [],
      postedAt: detail.postedAt,
      ...bodyFields(detail.body),
    } satisfies Job;
  });
}
