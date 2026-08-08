import type { Board, Job } from "../../types.js";
import { getJson, isRemoteText, stripHtml, prettify, assertHost } from "../../util/http.js";
import { hashId } from "../../util/id.js";

// https://apply.workable.com/api/v1/widget/accounts/<token>?details=true
// Public widget endpoint, no auth. `details=true` is what returns description
// and the locations array; without it the payload is titles only.
interface WorkableJob {
  title: string;
  shortcode?: string;
  employment_type?: string;
  telecommuting?: boolean;     // Workable's name for remote
  department?: string;
  function?: string;
  url?: string;
  shortlink?: string;
  published_on?: string;       // "2026-07-20"
  created_at?: string;
  country?: string;
  city?: string;
  state?: string;
  description?: string;        // HTML
}

export async function fetchWorkable(board: Board): Promise<Job[]> {
  const url = `https://apply.workable.com/api/v1/widget/accounts/${board.token}?details=true`;
  assertHost(url, "apply.workable.com");
  const res = await getJson<{ name?: string; jobs?: WorkableJob[] }>(url);
  const company = res.name ?? board.name ?? prettify(board.token);

  return (res.jobs ?? []).map((j) => {
    const location = [j.city, j.state, j.country].filter(Boolean).join(", ");
    return {
      id: hashId(["workable", company, j.title, location]),
      source: "workable",
      vendor: "workable",
      title: j.title,
      company,
      location,
      remote: Boolean(j.telecommuting) || isRemoteText(`${j.title} ${location}`),
      url: j.url ?? j.shortlink ?? `https://apply.workable.com/${board.token}/`,
      tags: [j.department, j.function, j.employment_type].filter(Boolean) as string[],
      postedAt: j.published_on ?? j.created_at,
      description: stripHtml(j.description).slice(0, 300),
    } satisfies Job;
  });
}
