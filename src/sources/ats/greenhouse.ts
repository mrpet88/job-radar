import type { Board, Job } from "../../types.js";
import { getJson, stripHtml, isRemoteText, prettify } from "../../util/http.js";
import { hashId } from "../../util/id.js";

// https://developers.greenhouse.io/job-board.html
interface GhJob {
  id: number;
  title: string;
  updated_at?: string;
  absolute_url: string;
  location?: { name?: string };
  content?: string;              // HTML-escaped
  departments?: { name: string }[];
}

export async function fetchGreenhouse(board: Board): Promise<Job[]> {
  const base = `https://boards-api.greenhouse.io/v1/boards/${board.token}`;

  // Resolve a nice company name once (cheap, best-effort).
  let company = board.name ?? prettify(board.token);
  try {
    const meta = await getJson<{ name?: string }>(base);
    if (meta.name) company = meta.name;
  } catch { /* keep fallback */ }

  const { jobs = [] } = await getJson<{ jobs?: GhJob[] }>(`${base}/jobs?content=true`);
  return jobs.map((j) => {
    const location = j.location?.name ?? "";
    const desc = stripHtml(j.content?.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
    return {
      id: hashId(["greenhouse", company, j.title, location]),
      source: "greenhouse",
      vendor: "greenhouse",
      title: j.title,
      company,
      location,
      remote: isRemoteText(`${j.title} ${location}`),
      url: j.absolute_url,
      tags: (j.departments ?? []).map((d) => d.name).filter(Boolean),
      postedAt: j.updated_at,
      description: desc.slice(0, 300),
    } satisfies Job;
  });
}
