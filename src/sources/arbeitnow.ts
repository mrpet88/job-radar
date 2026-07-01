import type { Job } from "../types.js";
import { hashId } from "../util/id.js";

const BASE = "https://www.arbeitnow.com/api/job-board-api";

interface AnJob {
  slug: string; title: string; company_name: string; location: string;
  remote: boolean; url: string; tags?: string[]; job_types?: string[];
  created_at?: number; description?: string;
}

export async function fetchArbeitnow(opts: { maxPages?: number; visaSponsorship?: boolean }): Promise<Job[]> {
  const maxPages = opts.maxPages ?? 5;
  const out: Job[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const u = new URL(BASE);
    u.searchParams.set("page", String(page));
    if (opts.visaSponsorship !== undefined) u.searchParams.set("visa_sponsorship", String(opts.visaSponsorship));
    const res = await fetch(u);
    if (!res.ok) { console.warn(`[arbeitnow] page ${page} HTTP ${res.status}`); break; }
    const json = (await res.json()) as { data: AnJob[] };
    if (!json.data?.length) break;
    for (const j of json.data) {
      out.push({
        id: hashId(["arbeitnow", j.company_name, j.title, j.location]),
        source: "arbeitnow",
        title: j.title,
        company: j.company_name,
        location: j.location || "",
        remote: Boolean(j.remote),
        url: j.url,
        tags: [...(j.tags ?? []), ...(j.job_types ?? [])],
        postedAt: j.created_at ? new Date(j.created_at * 1000).toISOString() : undefined,
        description: (j.description ?? "").replace(/<[^>]+>/g, "").slice(0, 300),
      });
    }
  }
  console.log(`[arbeitnow] fetched ${out.length} jobs`);
  return out;
}
