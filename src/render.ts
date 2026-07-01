import type { Job } from "./types.js";

type EJob = Job & { isNew?: boolean };

const esc = (s: string) =>
  (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function salary(j: EJob): string {
  if (!j.salaryMin && !j.salaryMax) return "";
  const fmt = (n?: number) => (n ? Math.round(n).toLocaleString() : "?");
  return `${j.currency ?? ""} ${fmt(j.salaryMin)}–${fmt(j.salaryMax)}`;
}

export function renderHtml(jobs: EJob[]): string {
  const newCount = jobs.filter((j) => j.isNew).length;
  const rows = jobs.map((j) => `
    <article class="card${j.isNew ? " new" : ""}">
      <div class="top">
        <a class="title" href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.title)}</a>
        ${j.isNew ? '<span class="badge">NEW</span>' : ""}
      </div>
      <div class="meta">
        <strong>${esc(j.company)}</strong>
        <span>${esc(j.location || "—")}</span>
        ${j.remote ? '<span class="pill">remote</span>' : ""}
        <span class="src">${esc(j.source)}</span>
        ${salary(j) ? `<span class="sal">${esc(salary(j))}</span>` : ""}
      </div>
      ${j.description ? `<p class="desc">${esc(j.description)}…</p>` : ""}
      <div class="tags">${j.tags.slice(0, 6).map((t) => `<span>${esc(t)}</span>`).join("")}</div>
    </article>`).join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Job Radar</title>
<style>
  :root{--bg:#f6f7f9;--card:#ffffff;--bd:#e3e6ea;--tx:#1a1d23;--mut:#6b7280;--acc:#2563eb;--new:#16a34a}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);
    font:15px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  header{padding:24px 20px;border-bottom:1px solid var(--bd);position:sticky;top:0;background:var(--bg)}
  h1{margin:0;font-size:20px}.sub{color:var(--mut);font-size:13px;margin-top:4px}
  .wrap{max-width:860px;margin:0 auto;padding:20px}
  input{width:100%;padding:10px 12px;margin-bottom:16px;background:var(--card);
    border:1px solid var(--bd);border-radius:8px;color:var(--tx);font-size:14px}
  input:focus{outline:none;border-color:var(--acc);box-shadow:0 0 0 3px rgba(37,99,235,.12)}
  .card{background:var(--card);border:1px solid var(--bd);border-radius:12px;
    padding:16px;margin-bottom:12px;box-shadow:0 1px 2px rgba(16,24,40,.04)}
  .card.new{border-color:var(--new);box-shadow:0 0 0 1px var(--new)}
  .top{display:flex;align-items:center;gap:8px}
  .title{color:var(--acc);font-weight:600;text-decoration:none;font-size:16px}
  .title:hover{text-decoration:underline}
  .badge{background:var(--new);color:#fff;font-size:10px;font-weight:700;
    padding:2px 6px;border-radius:4px;letter-spacing:.04em}
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
  <div class="sub">${jobs.length} matched · ${newCount} new · generated ${new Date().toLocaleString()}</div>
</div></header>
<div class="wrap">
  <input id="q" placeholder="filter by title, company, location…" oninput="f()">
  <div id="list">${rows}</div>
</div>
<script>
  function f(){const q=document.getElementById('q').value.toLowerCase();
    for(const c of document.querySelectorAll('.card')){
      c.style.display=c.textContent.toLowerCase().includes(q)?'':'none';}}
</script>
</body></html>`;
}
