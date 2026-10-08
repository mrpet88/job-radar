// Regex-level XML/HTML helpers, shared by the RSS and scraped-HTML sources.
//
// No XML library on purpose: the repo runs on zero runtime dependencies, and every
// feed we read is narrow and stable — flat blocks with text-only children.

// RSS <item> blocks. Each field is then read inside its own item block, so a stray
// tag elsewhere in the document can't bleed across postings. (matchAll copies the
// regex, so sharing one /g instance across callers is safe.)
export const ITEM_RE = /<item\b[^>]*>([\s\S]*?)<\/item>/g;

// One field out of a block. Self-closing tags (<tt:role/>, common on Teamtailor
// feeds) deliberately don't match and come back undefined.
export function tag(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`));
  const v = m ? decodeXml(m[1]).trim() : "";
  return v || undefined;
}

// &amp; is unescaped LAST so that "&amp;lt;" survives as the literal "&lt;"
// instead of collapsing into "<" and inventing markup that was never there.
export const unescape = (s: string): string =>
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

export const decodeXml = (s: string): string =>
  unescape(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
