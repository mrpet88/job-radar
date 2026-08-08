import type { Board, Job } from "../../types.js";
import { getJson, isRemoteText, stripHtml, prettify, assertHost , type FetchOpts } from "../../util/http.js";
import { hashId } from "../../util/id.js";

// https://<token>.recruitee.com/api/offers/ — public, no auth.
// Recruitee is Amsterdam-built and dominant among NL SMEs, so it surfaces Dutch
// boards that never appear on the US-centric ATS vendors.
interface RecruiteeOffer {
  title: string;
  slug?: string;
  city?: string;
  country_code?: string;
  state_name?: string;
  location?: string;          // pre-joined "Rijswijk, Zuid-Holland, Netherlands"
  careers_url?: string;
  company_name?: string;
  department?: string | null;
  employment_type_code?: string;
  category_code?: string;     // e.g. "biotech_pharma", "software_development"
  remote?: boolean;
  hybrid?: boolean;
  published_at?: string;      // "2026-07-13 13:47:38 UTC" — not ISO
  created_at?: string;
  description?: string;       // HTML
  requirements?: string;      // HTML
  tags?: string[];
}

// Recruitee stamps dates as "YYYY-MM-DD HH:MM:SS UTC", which Date.parse handles
// inconsistently across engines. Normalise to ISO before it reaches isFresh(),
// otherwise every offer looks undated and silently bypasses the age filter.
function toIso(raw?: string): string | undefined {
  if (!raw) return undefined;
  const iso = raw.trim().replace(" ", "T").replace(/\s*UTC$/i, "Z");
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

export async function fetchRecruitee(board: Board, opts?: FetchOpts): Promise<Job[]> {
  const url = `https://${board.token}.recruitee.com/api/offers/`;
  // The token IS the host here, so the host assertion matters most on this vendor.
  assertHost(url, `${board.token}.recruitee.com`);
  const { offers = [] } = await getJson<{ offers?: RecruiteeOffer[] }>(url, opts);

  return offers.map((o) => {
    const company = o.company_name ?? board.name ?? prettify(board.token);
    const location =
      o.location ??
      [o.city, o.state_name, o.country_code].filter(Boolean).join(", ");
    const jobUrl =
      o.careers_url ?? `https://${board.token}.recruitee.com/o/${o.slug ?? ""}`;

    return {
      id: hashId(["recruitee", company, o.title, location]),
      source: "recruitee",
      vendor: "recruitee",
      title: o.title,
      company,
      location,
      // `hybrid` roles are on-site part of the week, so they stay non-remote and
      // fall under the onsiteCountries check like any other in-person posting.
      remote: Boolean(o.remote) || isRemoteText(`${o.title} ${location}`),
      url: jobUrl,
      // category_code is carried into tags on purpose: excludes scan tags, so a
      // pharma/lab QA role at a biotech CRO can be filtered on the vendor's own
      // classification instead of hoping a banned word shows up in the snippet.
      tags: [
        o.department ?? undefined,
        o.employment_type_code,
        o.category_code,
        ...(o.tags ?? []),
      ].filter(Boolean) as string[],
      postedAt: toIso(o.published_at ?? o.created_at),
      description: stripHtml(`${o.description ?? ""} ${o.requirements ?? ""}`).slice(0, 300),
    } satisfies Job;
  });
}
