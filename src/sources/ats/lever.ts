import type { Board, Job } from "../../types.js";
import { getJson, isRemoteText, prettify } from "../../util/http.js";
import { hashId } from "../../util/id.js";

// https://github.com/lever/postings-api
interface LeverJob {
  id: string;
  text: string;                  // title
  hostedUrl: string;
  createdAt?: number;            // ms epoch
  descriptionPlain?: string;
  workplaceType?: string;        // "remote" | "on-site" | "hybrid"
  categories?: { location?: string; team?: string; commitment?: string };
  salaryRange?: { min?: number; max?: number; currency?: string };
}

export async function fetchLever(board: Board): Promise<Job[]> {
  const company = board.name ?? prettify(board.token);
  const jobs = await getJson<LeverJob[]>(`https://api.lever.co/v0/postings/${board.token}?mode=json`);
  return jobs.map((j) => {
    const location = j.categories?.location ?? "";
    return {
      id: hashId(["lever", company, j.text, location]),
      source: "lever",
      vendor: "lever",
      title: j.text,
      company,
      location,
      remote: j.workplaceType === "remote" || isRemoteText(`${j.text} ${location}`),
      url: j.hostedUrl,
      salaryMin: j.salaryRange?.min,
      salaryMax: j.salaryRange?.max,
      currency: j.salaryRange?.currency,
      tags: [j.categories?.team, j.categories?.commitment].filter(Boolean) as string[],
      postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
      description: (j.descriptionPlain ?? "").slice(0, 300),
    } satisfies Job;
  });
}
