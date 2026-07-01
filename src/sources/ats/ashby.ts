import type { Board, Job } from "../../types.js";
import { getJson, isRemoteText, prettify } from "../../util/http.js";
import { hashId } from "../../util/id.js";

// https://developers.ashbyhq.com/docs/public-job-posting-api
interface AshbyJob {
  title: string;
  location?: string;
  isRemote?: boolean;
  department?: string;
  team?: string;
  employmentType?: string;
  publishedAt?: string;
  jobUrl: string;
  descriptionPlain?: string;
  compensation?: { compensationTierSummary?: string };
}

export async function fetchAshby(board: Board): Promise<Job[]> {
  const company = board.name ?? prettify(board.token);
  const url = `https://api.ashbyhq.com/posting-api/job-board/${board.token}?includeCompensation=true`;
  const { jobs = [] } = await getJson<{ jobs?: AshbyJob[] }>(url);
  return jobs.map((j) => {
    const location = j.location ?? "";
    const pay = j.compensation?.compensationTierSummary;
    return {
      id: hashId(["ashby", company, j.title, location]),
      source: "ashby",
      vendor: "ashby",
      title: j.title,
      company,
      location,
      remote: Boolean(j.isRemote) || isRemoteText(`${j.title} ${location}`),
      url: j.jobUrl,
      tags: [j.department, j.team, j.employmentType, pay].filter(Boolean) as string[],
      postedAt: j.publishedAt,
      description: (j.descriptionPlain ?? "").slice(0, 300),
    } satisfies Job;
  });
}
