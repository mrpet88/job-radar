import type { Job } from "../types.js";
import { getJson, stripHtml, isRemoteText, bodyFields } from "../util/http.js";
import { hashId } from "../util/id.js";

// https://api.reliefweb.int/v2/jobs — UN OCHA's job board for the UN, IGO and NGO
// world, a sector the company ATS vendors don't reach at all.
//
// Needs RELIEFWEB_APPNAME: since Nov 2025 the API only answers appnames ReliefWeb
// has approved by hand (request one at https://apidoc.reliefweb.int/parameters#appname).
// The public RSS feed is not a keyless alternative — it sits behind a bot filter
// that blocks scripted clients, and the API is the channel they provide for them.
//
// The docs name the fields but don't show the response shape, so multi-value fields
// (country, city, source) are read as either an array of objects or one object.

interface Named { name?: string }
type Multi = Named | Named[] | undefined;

interface RwFields {
  title?: string;
  url?: string;
  url_alias?: string;
  body?: string;                // markdown-ish plain text
  date?: { created?: string; closing?: string };
  country?: Multi;
  city?: Multi;
  source?: Multi;
}

interface RwResponse {
  totalCount?: number;
  count?: number;
  data?: { id: number | string; fields?: RwFields }[];
}

const LIMIT = 500;

const names = (m: Multi): string[] =>
  (Array.isArray(m) ? m : m ? [m] : []).map((x) => x?.name?.trim()).filter(Boolean) as string[];

export function parseReliefWeb(res: RwResponse): Job[] {
  const out: Job[] = [];
  for (const item of res.data ?? []) {
    const f = item.fields ?? {};
    const title = f.title?.trim();
    const url = f.url_alias ?? f.url ?? `https://reliefweb.int/job/${item.id}`;
    if (!title) continue;

    // City first when present ("The Hague, Netherlands") so the onsite check sees
    // the most specific place; a multi-country posting lists every country.
    // ReliefWeb files global and home-based roles under the country "World" —
    // spelled out as "Worldwide" so the location filter's remote check knows it.
    const location = [...names(f.city), ...names(f.country)]
      .map((n) => (n === "World" ? "Worldwide" : n)).join(", ");
    const company = names(f.source)[0] ?? "ReliefWeb";
    const posted = Date.parse(f.date?.created ?? "");

    out.push({
      id: hashId(["reliefweb", company, title, location]),
      source: "reliefweb",
      title,
      company,
      location,
      // Title only: humanitarian ads talk about "remote areas" constantly, so the
      // body would mark half the field postings as remote jobs.
      remote: isRemoteText(title) || /\bhome[- ]based\b/i.test(title),
      url,
      tags: [],
      postedAt: Number.isNaN(posted) ? undefined : new Date(posted).toISOString(),
      ...bodyFields(stripHtml(f.body)),
    } satisfies Job);
  }
  return out;
}

export async function fetchReliefWeb(opts: { appname: string; titleTerms: string[] }): Promise<Job[]> {
  const url = new URL("https://api.reliefweb.int/v2/jobs");
  url.searchParams.set("appname", opts.appname);
  const res = await getJson<RwResponse>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      // Title-only search: QA/test words in a body are boilerplate far more often
      // than they're the job. The location filter downstream does the rest.
      query: { value: opts.titleTerms.join(" OR "), fields: ["title"] },
      fields: { include: ["title", "url", "url_alias", "body", "date.created", "country.name", "city.name", "source.name"] },
      sort: ["date.created:desc"],
      limit: LIMIT,
    }),
  });
  const out = parseReliefWeb(res);
  if ((res.totalCount ?? 0) > out.length)
    console.warn(`[reliefweb] ${res.totalCount} matches, read the newest ${out.length}`);
  console.log(`[reliefweb] fetched ${out.length} jobs`);
  return out;
}
