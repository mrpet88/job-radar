import fs from "node:fs/promises";
import type { Job } from "./types.js";
import { matchAny } from "./filter.js";

type EJob = Job & { isNew?: boolean };

const esc = (s: string) =>
  (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

// How many roles the email lists before it just links to the dashboard.
const MAX_ROWS = 20;

const TIER_COLOR: Record<string, string> = { lead: "#16a34a", adjacent: "#2563eb", ic: "#6b7280" };

function salary(j: EJob): string {
  if (!j.salaryMin && !j.salaryMax) return "";
  const fmt = (n?: number) => (n ? Math.round(n).toLocaleString() : "?");
  return `${j.currency ?? ""} ${fmt(j.salaryMin)}–${fmt(j.salaryMax)}`;
}

function row(j: EJob, nlTerms: string[]): string {
  const nl = matchAny((j.location || "").toLowerCase(), nlTerms);
  const tier = j.tier || "";
  const bits = [
    esc(j.location || "—"),
    j.remote ? "remote" : "",
    j.otherLocations ? `+${j.otherLocations} other locations` : "",
    j.languageRequirement ? esc(j.languageRequirement) : "",
    salary(j) ? esc(salary(j)) : "",
    esc(j.source),
  ].filter(Boolean).join(" · ");

  return `
  <tr><td style="padding:14px 0;border-bottom:1px solid #e3e6ea">
    <div style="font:600 15px/1.35 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
      ${tier ? `<span style="display:inline-block;margin-right:6px;padding:1px 7px;border-radius:10px;background:${TIER_COLOR[tier] ?? "#6b7280"};color:#fff;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em">${esc(tier)}</span>` : ""}
      <a href="${esc(j.url)}" style="color:#1a1d23;text-decoration:none">${esc(j.title)}</a>
      ${nl ? `<span style="margin-left:6px;font-size:11px;color:#ea580c;font-weight:700">NL</span>` : ""}
    </div>
    <div style="margin-top:3px;font:400 13px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b7280">
      <strong style="color:#1a1d23">${esc(j.company)}</strong> — ${bits}
    </div>
  </td></tr>`;
}

/**
 * Email body for one run: the new roles only, already ranked by score upstream.
 * Inline styles throughout — most mail clients strip <style> blocks.
 */
export function renderDigest(
  fresh: EJob[], nlTerms: string[], dashboardUrl?: string, forced = false,
): string {
  const shown = fresh.slice(0, MAX_ROWS);
  const generated = new Date().toLocaleString("en-GB", {
    timeZone: "Europe/Amsterdam",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });
  const tierCount = (t: string) => fresh.filter((j) => j.tier === t).length;
  const summary = ["lead", "adjacent", "ic"]
    .filter((t) => tierCount(t)).map((t) => `${tierCount(t)} ${t}`).join(" · ");

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f6f7f9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:24px 12px">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border:1px solid #e3e6ea;border-radius:10px;padding:22px 24px">
    <tr><td>
      <div style="font:700 18px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1d23">Job Radar — ${forced ? `top ${fresh.length} current ${fresh.length === 1 ? "role" : "roles"}` : `${fresh.length} new ${fresh.length === 1 ? "role" : "roles"}`}</div>
      ${forced ? `<div style="margin-top:6px;padding:6px 10px;border-radius:6px;background:#fff7ed;border:1px solid #fed7aa;font:400 12px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9a3412">Test send — these are the current top roles, not new finds.</div>` : ""}
      <div style="margin-top:4px;font:400 13px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b7280">${esc(summary)}${summary ? " · " : ""}${esc(generated)}</div>
    </td></tr>
    <tr><td>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${shown.map((j) => row(j, nlTerms)).join("")}</table>
    </td></tr>
    <tr><td style="padding-top:18px;font:400 13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b7280">
      ${fresh.length > shown.length ? `+${fresh.length - shown.length} more new ${fresh.length - shown.length === 1 ? "role" : "roles"} not listed. ` : ""}
      ${dashboardUrl ? `<a href="${esc(dashboardUrl)}" style="color:#2563eb">Open the full dashboard →</a>` : "Full list: data/index.html"}
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

export function digestSubject(fresh: EJob[], nlTerms: string[], forced = false): string {
  const lead = fresh.filter((j) => j.tier === "lead").length;
  const nl = fresh.filter((j) => matchAny((j.location || "").toLowerCase(), nlTerms)).length;
  const extra = [lead ? `${lead} lead` : "", nl ? `${nl} NL` : ""].filter(Boolean).join(", ");
  const top = fresh[0];
  const head = forced
    ? `[test] Job Radar: top ${fresh.length}${extra ? ` (${extra})` : ""}`
    : `Job Radar: ${fresh.length} new${extra ? ` (${extra})` : ""}`;
  return top ? `${head} — ${top.title} @ ${top.company}` : head;
}

/**
 * Write the digest for the CI mail step, and tell it whether to send.
 * No new roles → no file, no mail. The path is deliberately outside `data/`:
 * that directory is committed and published to Pages, and this is neither.
 */
export async function writeDigest(
  path: string, fresh: EJob[], nlTerms: string[], dashboardUrl?: string, forced = false,
): Promise<boolean> {
  await fs.rm(path, { force: true });          // never leave a stale digest behind
  const send = fresh.length > 0;
  if (send) await fs.writeFile(path, renderDigest(fresh, nlTerms, dashboardUrl, forced));

  // GitHub Actions step outputs (no-op locally).
  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    await fs.appendFile(out, `send=${send}\nsubject=${digestSubject(fresh, nlTerms, forced).replace(/\r?\n/g, " ")}\n`);
  }
  return send;
}
