import type { Job } from "../types.js";
import { getJson, stripHtml } from "../util/http.js";
import { hashId } from "../util/id.js";

// https://jobicy.com/jobs-rss-feed → JSON API v2.
interface JyJob {
  id: number; url: string; jobTitle: string; companyName: string;
  jobGeo?: string; jobLevel?: string; jobType?: string[]; jobIndustry?: string[];
  annualSalaryMin?: number; annualSalaryMax?: number; salaryCurrency?: string;
  pubDate?: string; jobExcerpt?: string;
}

export async function fetchJobicy(): Promise<Job[]> {
  const { jobs = [] } = await getJson<{ jobs?: JyJob[] }>("https://jobicy.com/api/v2/remote-jobs?count=50");
  const out = jobs.map((j) => ({
    id: hashId(["jobicy", j.companyName, j.jobTitle, j.jobGeo ?? ""]),
    source: "jobicy",
    title: j.jobTitle,
    company: j.companyName,
    location: j.jobGeo ?? "",
    remote: true,
    url: j.url,
    salaryMin: j.annualSalaryMin || undefined,
    salaryMax: j.annualSalaryMax || undefined,
    currency: j.salaryCurrency,
    tags: [...(j.jobIndustry ?? []), ...(j.jobType ?? []), j.jobLevel].filter(Boolean) as string[],
    postedAt: j.pubDate,
    description: stripHtml(j.jobExcerpt).slice(0, 300),
  } satisfies Job));
  console.log(`[jobicy] fetched ${out.length} jobs`);
  return out;
}
