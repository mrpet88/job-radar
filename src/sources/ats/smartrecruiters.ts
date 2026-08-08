import type { Board, Job } from "../../types.js";
import { getJson, isRemoteText, prettify, assertHost } from "../../util/http.js";
import { hashId } from "../../util/id.js";

// https://api.smartrecruiters.com/v1/companies/<token>/postings — public, no auth.
// NB: the company identifier is case-sensitive ("WAES", "Eurofins"), so the token
// is never lower-cased on the way in. boardKey() lower-cases for dedup only.
interface SrPosting {
  id: string;
  name: string;                 // the job title
  refNumber?: string;
  releasedDate?: string;        // ISO
  company?: { identifier?: string; name?: string };
  location?: {
    city?: string;
    region?: string;
    country?: string;
    remote?: boolean;
    fullLocation?: string;
  };
  department?: { label?: string };
  function?: { label?: string };
  industry?: { label?: string };
  typeOfEmployment?: { label?: string };
}

interface SrPage {
  totalFound?: number;
  content?: SrPosting[];
}

const PAGE = 100;      // API maximum
const MAX_PAGES = 5;   // 500 postings is far beyond any board we track

export async function fetchSmartRecruiters(board: Board): Promise<Job[]> {
  const base = `https://api.smartrecruiters.com/v1/companies/${board.token}/postings`;
  assertHost(base, "api.smartrecruiters.com");
  const postings: SrPosting[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const { content = [], totalFound = 0 } =
      await getJson<SrPage>(`${base}?limit=${PAGE}&offset=${page * PAGE}`);
    postings.push(...content);
    if (content.length < PAGE || postings.length >= totalFound) break;
  }

  return postings.map((p) => {
    const company = p.company?.name ?? board.name ?? prettify(board.token);
    const loc = p.location ?? {};
    const location =
      loc.fullLocation ?? [loc.city, loc.region, loc.country].filter(Boolean).join(", ");
    const identifier = p.company?.identifier ?? board.token;

    return {
      id: hashId(["smartrecruiters", company, p.name, location]),
      source: "smartrecruiters",
      vendor: "smartrecruiters",
      title: p.name,
      company,
      location,
      remote: Boolean(loc.remote) || isRemoteText(`${p.name} ${location}`),
      url: `https://jobs.smartrecruiters.com/${identifier}/${p.id}`,
      tags: [p.department?.label, p.function?.label, p.typeOfEmployment?.label, p.industry?.label]
        .filter(Boolean) as string[],
      postedAt: p.releasedDate,
      // The postings list carries no body text — a description needs a per-job
      // detail call, which isn't worth the request budget. Keyword matching runs
      // on title+tags anyway; only the exclude pass reads descriptions.
      description: undefined,
    } satisfies Job;
  });
}
