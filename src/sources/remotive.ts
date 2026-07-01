import type { Job } from "../types.js";
import { getJson, stripHtml } from "../util/http.js";
import { hashId } from "../util/id.js";

// https://remotive.com/api/remote-jobs (jobs delayed ~24h; personal use).
interface RmJob {
  id: number; url: string; title: string; company_name: string;
  category?: string; tags?: string[]; job_type?: string;
  candidate_required_location?: string; publication_date?: string; description?: string;
}

export async function fetchRemotive(): Promise<Job[]> {
  const { jobs = [] } = await getJson<{ jobs?: RmJob[] }>("https://remotive.com/api/remote-jobs");
  const out = jobs.map((j) => ({
    id: hashId(["remotive", j.company_name, j.title, j.candidate_required_location ?? ""]),
    source: "remotive",
    title: j.title,
    company: j.company_name,
    location: j.candidate_required_location ?? "",
    remote: true,
    url: j.url,
    tags: [...(j.tags ?? []), j.category, j.job_type].filter(Boolean) as string[],
    postedAt: j.publication_date,
    description: stripHtml(j.description).slice(0, 300),
  } satisfies Job));
  console.log(`[remotive] fetched ${out.length} jobs`);
  return out;
}
