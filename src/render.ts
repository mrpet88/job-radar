import type { Job } from "./types.js";
import { matchAny } from "./filter.js";

type EJob = Job & { isNew?: boolean };

const esc = (s: string) =>
  (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function salary(j: EJob): string {
  if (!j.salaryMin && !j.salaryMax) return "";
  const fmt = (n?: number) => (n ? Math.round(n).toLocaleString() : "?");
  return `${j.currency ?? ""} ${fmt(j.salaryMin)}–${fmt(j.salaryMax)}`;
}

export function renderHtml(jobs: EJob[], nlTerms: string[] = []): string {
  const newCount = jobs.filter((j) => j.isNew).length;
  const tierCount = (name: string) => jobs.filter((j) => j.tier === name).length;
  const tierSummary = ["lead", "adjacent", "ic"]
    .map((t) => `${tierCount(t)} ${t}`).join(" · ");
  // Always show Amsterdam local time (CI runners are UTC); auto-handles CEST/CET.
  const generated = new Date().toLocaleString("en-GB", {
    timeZone: "Europe/Amsterdam",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });

  const sources = [...new Set(jobs.map((j) => j.source))].sort();
  const srcOptions = sources.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("");

  const rows = jobs.map((j) => {
    const nl = matchAny((j.location || "").toLowerCase(), nlTerms);
    const tier = j.tier || "";
    return `
    <article class="card${j.isNew ? " new" : ""}" data-nl="${nl ? 1 : 0}" data-remote="${j.remote ? 1 : 0}" data-new="${j.isNew ? 1 : 0}" data-tier="${esc(tier)}" data-source="${esc(j.source)}">
      <div class="top">
        ${tier ? `<span class="tier ${esc(tier)}">${esc(tier)}</span>` : ""}
        <a class="title" href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.title)}</a>
        ${j.isNew ? '<span class="badge">NEW</span>' : ""}
      </div>
      <div class="meta">
        <strong>${esc(j.company)}</strong>
        <span>${esc(j.location || "—")}</span>
        ${j.otherLocations ? `<span class="pill locs">+${j.otherLocations} other locations</span>` : ""}
        ${j.remote ? '<span class="pill">remote</span>' : ""}
        ${j.languageRequirement ? `<span class="lang">${esc(j.languageRequirement)}</span>` : ""}
        <span class="src">${esc(j.source)}</span>
        ${salary(j) ? `<span class="sal">${esc(salary(j))}</span>` : ""}
      </div>
      ${j.description ? `<p class="desc">${esc(j.description)}…</p>` : ""}
      <div class="tags">${j.tags.slice(0, 6).map((t) => `<span>${esc(t)}</span>`).join("")}</div>
    </article>`;
  }).join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Job Radar</title>
<style>
  :root{--bg:#f6f7f9;--card:#ffffff;--bd:#e3e6ea;--tx:#1a1d23;--mut:#6b7280;--acc:#2563eb;--new:#16a34a}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);
    font:15px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  header{padding:24px 20px;border-bottom:1px solid var(--bd);position:sticky;top:0;background:var(--bg);z-index:5}
  h1{margin:0;font-size:20px}.sub{color:var(--mut);font-size:13px;margin-top:4px}
  .wrap{max-width:860px;margin:0 auto;padding:20px}
  input{width:100%;padding:10px 12px;background:var(--card);
    border:1px solid var(--bd);border-radius:8px;color:var(--tx);font-size:14px}
  input:focus{outline:none;border-color:var(--acc);box-shadow:0 0 0 3px rgba(37,99,235,.12)}
  .controls{margin-bottom:16px}
  .chips{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}
  .chip{background:var(--card);border:1px solid var(--bd);color:var(--tx);font-size:13px;
    padding:6px 12px;border-radius:20px;cursor:pointer}
  .chip.on{background:var(--acc);border-color:var(--acc);color:#fff}
  select{background:var(--card);border:1px solid var(--bd);color:var(--tx);font-size:13px;
    padding:6px 10px;border-radius:8px;cursor:pointer}
  .count{color:var(--mut);font-size:12px;margin-left:auto}
  .card{background:var(--card);border:1px solid var(--bd);border-radius:12px;
    padding:16px;margin-bottom:12px;box-shadow:0 1px 2px rgba(16,24,40,.04)}
  .card.new{border-color:var(--new);box-shadow:0 0 0 1px var(--new)}
  .top{display:flex;align-items:center;gap:8px}
  .title{color:var(--acc);font-weight:600;text-decoration:none;font-size:16px}
  .title:hover{text-decoration:underline}
  .badge{background:var(--new);color:#fff;font-size:10px;font-weight:700;
    padding:2px 6px;border-radius:4px;letter-spacing:.04em}
  .tier{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;
    padding:2px 7px;border-radius:4px;border:1px solid transparent;flex:none}
  .tier.lead{background:#dcfce7;color:#166534;border-color:#bbf7d0}
  .tier.adjacent{background:#fef3c7;color:#92400e;border-color:#fde68a}
  .tier.ic{background:#eef1f5;color:#6b7280;border-color:#e3e6ea}
  .lang{border:1px solid #fbcfe8;background:#fdf2f8;color:#9d174d;padding:1px 7px;
    border-radius:20px;font-size:11px}
  .pill.locs{border-color:#c7d2fe;background:#eef2ff;color:#3730a3}
  .meta{display:flex;flex-wrap:wrap;gap:10px;align-items:center;color:var(--mut);
    font-size:13px;margin-top:6px}
  .pill,.src,.sal{border:1px solid var(--bd);padding:1px 7px;border-radius:20px;font-size:11px}
  .sal{color:#15803d;border-color:#bbf7d0;background:#f0fdf4}
  .desc{color:var(--mut);font-size:13px;margin:10px 0 8px}
  .tags{display:flex;flex-wrap:wrap;gap:6px}
  .tags span{background:#eef1f5;font-size:11px;color:var(--mut);padding:2px 8px;border-radius:6px}
</style></head><body>
<header><div class="wrap" style="padding:0">
  <h1>Job Radar</h1>
  <div class="sub">${jobs.length} matched · ${tierSummary} · ${newCount} new · generated ${generated}</div>
</div></header>
<div class="wrap">
  <div class="controls">
    <input id="q" placeholder="search title, company, location…" oninput="af()">
    <div class="chips">
      <button class="chip" id="c-nl" onclick="tog(this)">Netherlands</button>
      <button class="chip" id="c-remote" onclick="tog(this)">Remote</button>
      <button class="chip" id="c-new" onclick="tog(this)">New</button>
      <select id="c-src" onchange="af()"><option value="">All sources</option>${srcOptions}</select>
      <span id="count" class="count"></span>
    </div>
  </div>
  <div id="list">${rows}</div>
</div>
<script>
  function tog(b){b.classList.toggle('on');af();}
  function af(){
    var q=document.getElementById('q').value.toLowerCase();
    var nl=document.getElementById('c-nl').classList.contains('on');
    var rm=document.getElementById('c-remote').classList.contains('on');
    var nw=document.getElementById('c-new').classList.contains('on');
    var src=document.getElementById('c-src').value;
    var n=0;
    document.querySelectorAll('.card').forEach(function(c){
      var show=true;
      if(q && c.textContent.toLowerCase().indexOf(q)<0) show=false;
      if(nl && c.dataset.nl!=='1') show=false;
      if(rm && c.dataset.remote!=='1') show=false;
      if(nw && c.dataset.new!=='1') show=false;
      if(src && c.dataset.source!==src) show=false;
      c.style.display=show?'':'none'; if(show)n++;
    });
    document.getElementById('count').textContent=n+' shown';
  }
  document.addEventListener('DOMContentLoaded',af);
</script>
</body></html>`;
}
