import type { Board, Job } from "../../types.js";
import { getText, stripHtml, isRemoteText, prettify, assertHost , type FetchOpts } from "../../util/http.js";
import { hashId } from "../../util/id.js";

// https://<slug>.teamtailor.com/jobs.rss — public RSS, no auth, no key.
// Teamtailor is Nordic-built and common across NL/EU mid-market employers, so it
// reaches boards the US-centric vendors miss.
//
// Parsed with regex rather than an XML library: the repo runs on zero runtime
// dependencies, and the feed shape is narrow and stable — flat <item> blocks with
// text-only children. Each field is read inside its own item block, so a stray
// tag elsewhere in the document can't bleed across postings.
const ITEM_RE = /<item\b[^>]*>([\s\S]*?)<\/item>/g;

// One field out of a block. Self-closing tags (<tt:role/>, common on these feeds)
// deliberately don't match and come back undefined.
function tag(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`));
  const v = m ? decodeXml(m[1]).trim() : "";
  return v || undefined;
}

// &amp; is unescaped LAST so that "&amp;lt;" survives as the literal "&lt;"
// instead of collapsing into "<" and inventing markup that was never there.
const unescape = (s: string): string =>
  s.replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d: string) => safeChar(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&amp;/g, "&");

const safeChar = (code: number): string =>
  Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";

const decodeXml = (s: string): string =>
  unescape(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));

export async function fetchTeamtailor(board: Board, opts?: FetchOpts): Promise<Job[]> {
  const url = `https://${board.token}.teamtailor.com/jobs.rss`;
  // The token is the host here, as on Recruitee — assert before the request.
  assertHost(url, `${board.token}.teamtailor.com`);
  return parseRss(await getText(url, opts), board.name ?? prettify(board.token));
}

// Kept separate from the fetch so the parse can be exercised on a fixture — live
// feeds happen not to use CDATA, but the format allows it.
export function parseRss(xml: string, fallbackName: string): Job[] {
  // The channel <title> (before the first <item>) is the employer's own name,
  // which beats a display name guessed from the slug.
  const head = xml.split("<item")[0];
  const company = tag(head, "title") ?? fallbackName;

  const out: Job[] = [];
  for (const m of xml.matchAll(ITEM_RE)) {
    const block = m[1];
    const title = tag(block, "title");
    const link = tag(block, "link");
    if (!title || !link) continue;

    // Location isn't optional in practice: locationOk() drops every non-remote
    // job whose location is blank, so without this the provider would surface
    // almost nothing. Only the first tt:location is used — the rest are extra
    // offices for the same posting.
    const locBlock = block.match(/<tt:locations>([\s\S]*?)<\/tt:locations>/)?.[1] ?? "";
    const location = [tag(locBlock, "tt:city"), tag(locBlock, "tt:country")]
      .filter(Boolean).join(", ");
    const remoteStatus = tag(block, "remoteStatus");
    const posted = Date.parse(tag(block, "pubDate") ?? "");   // RFC-822

    // Descriptions arrive as XML-escaped HTML, so they decode twice: once out of
    // XML into HTML, then again for entities that were nested inside that HTML.
    const description = unescape(stripHtml(tag(block, "description"))).slice(0, 300);

    out.push({
      id: hashId(["teamtailor", company, title, location]),
      source: "teamtailor",
      vendor: "teamtailor",
      title,
      company,
      location,
      remote: remoteStatus === "remote" || isRemoteText(`${title} ${location}`),
      url: link,
      // department and role are frequently the same string on these feeds.
      tags: [...new Set([tag(block, "tt:department"), tag(block, "tt:role"), remoteStatus]
        .filter(Boolean) as string[])],
      postedAt: Number.isNaN(posted) ? undefined : new Date(posted).toISOString(),
      description,
    } satisfies Job);
  }
  return out;
}
