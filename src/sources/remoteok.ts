import type { Job } from "../types.js";
import { getJson, stripHtml } from "../util/http.js";
import { hashId } from "../util/id.js";

// https://remoteok.com/api — array; the first element is a legal/metadata notice.
interface RoJob {
  id?: string; slug?: string; company?: string; position?: string;
  tags?: string[]; description?: string; location?: string; url?: string;
  date?: string; salary_min?: number; salary_max?: number;
}

export async function fetchRemoteOk(): Promise<Job[]> {
  const raw = await getJson<RoJob[]>("https://remoteok.com/api");
  const out = raw
    .filter((j) => j.position && j.company)
    .map((j) => ({
      id: hashId(["remoteok", j.company!, j.position!, j.location ?? ""]),
      source: "remoteok",
      title: j.position!,
      company: j.company!,
      location: j.location ?? "",
      remote: true,
      url: j.url ?? (j.slug ? `https://remoteok.com/remote-jobs/${j.slug}` : ""),
      salaryMin: j.salary_min || undefined,
      salaryMax: j.salary_max || undefined,
      currency: j.salary_min ? "USD" : undefined,
      tags: j.tags ?? [],
      postedAt: j.date,
      description: stripHtml(j.description).slice(0, 300),
    } satisfies Job));
  console.log(`[remoteok] fetched ${out.length} jobs`);
  return out;
}
