import type { Board, Job } from "../../types.js";
import { getJson, isRemoteText, prettify } from "../../util/http.js";
import { hashId } from "../../util/id.js";

// Workday "CxS" public feed: POST /wday/cxs/{tenant}/{site}/jobs
// Each tenant lives on its own data center (wd1/wd3/wd5…) and site (e.g. External).
interface WdPosting {
  title: string;
  externalPath: string;          // e.g. /job/Location/Title_R123
  locationsText?: string;
  postedOn?: string;             // human string, not ISO
}

const MAX_PAGES = 5;             // 20/page → up to 100 per board
const LIMIT = 20;

export async function fetchWorkday(board: Board): Promise<Job[]> {
  const dc = board.dc ?? "wd1";
  const site = board.site ?? "External";
  const company = board.name ?? prettify(board.token);
  const origin = `https://${board.token}.${dc}.myworkdayjobs.com`;
  const api = `${origin}/wday/cxs/${board.token}/${site}/jobs`;

  const out: Job[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * LIMIT;
    const data = await getJson<{ total?: number; jobPostings?: WdPosting[] }>(api, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: LIMIT, offset, searchText: "", appliedFacets: {} }),
    });
    const postings = data.jobPostings ?? [];
    if (!postings.length) break;
    for (const p of postings) {
      const location = p.locationsText ?? "";
      out.push({
        id: hashId(["workday", company, p.title, location]),
        source: "workday",
        vendor: "workday",
        title: p.title,
        company,
        location,
        remote: isRemoteText(`${p.title} ${location}`),
        url: `${origin}/${site}${p.externalPath}`,
        tags: [],
        description: undefined,
      });
    }
    if (offset + LIMIT >= (data.total ?? postings.length)) break;
  }
  return out;
}
