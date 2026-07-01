import type { Job } from "../types.js";
import { hashId } from "../util/id.js";

interface AdzunaJob {
  id: string; title: string; location?: { display_name?: string };
  company?: { display_name?: string }; redirect_url: string;
  salary_min?: number; salary_max?: number; created?: string;
  description?: string; category?: { label?: string };
}

export async function fetchAdzuna(opts: {
  appId: string; appKey: string; countries: string[]; what: string; maxPages: number;
}): Promise<Job[]> {
  const out: Job[] = [];
  for (const country of opts.countries) {
    for (let page = 1; page <= opts.maxPages; page++) {
      const u = new URL(`https://api.adzuna.com/v1/api/jobs/${country}/search/${page}`);
      u.searchParams.set("app_id", opts.appId);
      u.searchParams.set("app_key", opts.appKey);
      u.searchParams.set("results_per_page", "50");
      if (opts.what) u.searchParams.set("what_or", opts.what); // OR across terms
      u.searchParams.set("content-type", "application/json");
      const res = await fetch(u);
      if (!res.ok) { console.warn(`[adzuna:${country}] page ${page} HTTP ${res.status}`); break; }
      const json = (await res.json()) as { results: AdzunaJob[] };
      if (!json.results?.length) break;
      for (const j of json.results) {
        const loc = j.location?.display_name ?? "";
        out.push({
          id: hashId(["adzuna", j.company?.display_name ?? "", j.title, loc]),
          source: "adzuna",
          title: j.title,
          company: j.company?.display_name ?? "Unknown",
          location: loc,
          remote: /remote|thuiswerk|homeoffice/i.test(`${j.title} ${loc} ${j.description ?? ""}`),
          url: j.redirect_url,
          salaryMin: j.salary_min,
          salaryMax: j.salary_max,
          currency: country === "gb" ? "GBP" : "EUR",
          tags: j.category?.label ? [j.category.label] : [],
          postedAt: j.created,
          description: (j.description ?? "").replace(/<[^>]+>/g, "").slice(0, 300),
        });
      }
    }
  }
  console.log(`[adzuna] fetched ${out.length} jobs`);
  return out;
}
