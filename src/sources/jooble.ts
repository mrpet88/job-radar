import type { Job } from "../types.js";
import { getJson, stripHtml, isRemoteText } from "../util/http.js";
import { hashId } from "../util/id.js";

// https://jooble.org/api/about — POST to /api/{KEY}, key-gated.
interface JbJob {
  title: string; location?: string; snippet?: string; salary?: string;
  source?: string; link: string; company?: string; updated?: string;
}

export async function fetchJooble(opts: { apiKey: string; keywords: string; location?: string }): Promise<Job[]> {
  const { jobs = [] } = await getJson<{ jobs?: JbJob[] }>(`https://jooble.org/api/${opts.apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ keywords: opts.keywords, location: opts.location ?? "" }),
  });
  const out = jobs.map((j) => {
    const company = j.company || j.source || "Unknown";
    const location = j.location ?? "";
    return {
      id: hashId(["jooble", company, j.title, location]),
      source: "jooble",
      title: j.title,
      company,
      location,
      remote: isRemoteText(`${j.title} ${location}`),
      url: j.link,
      tags: [],
      postedAt: j.updated,
      description: stripHtml(j.snippet).slice(0, 300),
    } satisfies Job;
  });
  console.log(`[jooble] fetched ${out.length} jobs`);
  return out;
}
