/**
 * Builds the user guide PDF: signs in to a running WeTestCase, screenshots
 * each page with its parts numbered, and prints the words in content.mjs
 * around them.
 *
 * Point it at a copy with the demo data — the demo seed, then demo-data.ts —
 * never at real data: the screenshots are of whatever is there.
 *
 *   GUIDE_BASE_URL=http://localhost:3002 node scripts/user-guide/build.mjs
 *
 * Writes apps/web/public/user-guide.pdf (GUIDE_OUT to change it), which the
 * app offers under "Download user guide". CI/CD runs this on every push to
 * main (the user-guide job) and deploys the result, so a local run is only
 * needed to preview a change, or to refresh the copy kept in the repo. Needs Playwright's Chromium
 * (`npx playwright install chromium`).
 *
 * Options (environment): GUIDE_LOGIN / GUIDE_PASSWORD (default admin /
 * Password123!), GUIDE_PROJECT (the demo project's name), GUIDE_CASE (a
 * failed case's TC ID), GUIDE_BROWSER_ARGS (extra Chromium flags).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { ROLES, SECTIONS, SUBTITLE, TITLE } from "./content.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.GUIDE_BASE_URL ?? "http://localhost:3002").replace(/\/$/, "");
const LOGIN = process.env.GUIDE_LOGIN ?? "admin";
const PASSWORD = process.env.GUIDE_PASSWORD ?? "Password123!";
const PROJECT = process.env.GUIDE_PROJECT ?? "Weloan365 Mobile Banking";
const CASE = process.env.GUIDE_CASE ?? "TC-TRF-002";
const OUT = path.resolve(process.env.GUIDE_OUT ?? path.join(here, "../../apps/web/public/user-guide.pdf"));
/**
 * The same guide as a web page, beside the PDF: the app's preview shows it,
 * since a PDF inside a page depends on each browser's viewer (some phones
 * show only its first page).
 */
const OUT_HTML = OUT.replace(/\.pdf$/i, ".html");
/**
 * Pages are photographed in a window this tall (CSS px), not as a full-page
 * capture: some pages scroll inside a column, which a full-page capture
 * leaves blank. A section can ask for more with `height`.
 */
const SHOT_HEIGHT = 1000;

const browser = await chromium.launch({ args: (process.env.GUIDE_BROWSER_ARGS ?? "").split(/\s+(?=--)/).filter(Boolean) });
const context = await browser.newContext({
  viewport: { width: 1360, height: 860 },
  deviceScaleFactor: 1.5,
  timezoneId: process.env.GUIDE_TIMEZONE ?? "Asia/Phnom_Penh",
});
// No on-screen guides or toasts in the pictures.
await context.addInitScript(() => {
  const getItem = Storage.prototype.getItem;
  Storage.prototype.getItem = function (key) {
    return String(key).startsWith("wtc:tour:") ? "seen" : getItem.call(this, key);
  };
  document.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = "[data-sonner-toaster]{display:none!important} *{caret-color:transparent!important}";
    document.head.append(style);
  });
});
const page = await context.newPage();

async function settle() {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(700);
}

async function open(url) {
  await page.goto(BASE + url);
  await settle();
}

/** Numbers each callout's part of the page; returns the callouts that are there. */
async function annotate(callouts) {
  return page.evaluate((targets) => {
    document.getElementById("guide-marks")?.remove();
    const layer = document.createElement("div");
    layer.id = "guide-marks";
    Object.assign(layer.style, {
      position: "absolute", left: "0", top: "0", width: `${document.documentElement.scrollWidth}px`,
      height: `${document.documentElement.scrollHeight}px`, pointerEvents: "none", zIndex: "2147483647",
    });
    const found = [];
    for (const target of targets) {
      const element = [...document.querySelectorAll(`[data-tour="${target}"]`)].find((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (!element) continue;
      found.push(target);
      const r = element.getBoundingClientRect();
      const top = r.top + window.scrollY;
      const left = r.left + window.scrollX;
      const box = document.createElement("div");
      Object.assign(box.style, {
        position: "absolute", left: `${left - 4}px`, top: `${top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px`,
        border: "2.5px solid #f97316", borderRadius: "10px", boxShadow: "0 0 0 3px rgba(249,115,22,.18)",
      });
      const badge = document.createElement("div");
      badge.textContent = String(found.length);
      Object.assign(badge.style, {
        position: "absolute", left: `${Math.max(2, left - 14)}px`, top: `${Math.max(2, top - 14)}px`, width: "26px", height: "26px",
        borderRadius: "999px", background: "#f97316", color: "white", font: "700 14px/26px system-ui, sans-serif",
        textAlign: "center", boxShadow: "0 1px 4px rgba(0,0,0,.35)", border: "2px solid white",
      });
      layer.append(box, badge);
    }
    document.body.append(layer);
    return found;
  }, callouts.map((callout) => callout.target));
}

async function screenshot(locator) {
  // Nothing focused: a focused field shows a ring and selected text.
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  const buffer = locator
    ? await locator.screenshot({ type: "jpeg", quality: 80 })
    : await page.screenshot({ type: "jpeg", quality: 80 });
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

// ---- Pictures -------------------------------------------------------------

const shots = {};
const extra = {};

for (const section of SECTIONS.filter((s) => s.signedOut)) {
  await page.setViewportSize({ width: 1360, height: section.height ?? 860 });
  await open(section.path);
  shots[section.id] = { image: await screenshot(), callouts: [] };
}

await open("/login");
await page.fill("#login", LOGIN);
await page.fill("#password", PASSWORD);
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL((url) => !url.pathname.endsWith("/login"));
await settle();

await open("/projects");
const projectHref = await page.locator(`a:has-text("${PROJECT}")`).first().getAttribute("href");
if (!projectHref) throw new Error(`Project "${PROJECT}" not found — is the demo data there?`);
const project = projectHref.match(/\/projects\/[^/?#]+/)[0];
await open(`${project}/test-cases?search=${encodeURIComponent(CASE)}`);
const caseHref = await page.locator(`a[href*="${project}/test-cases/"]:has-text("${CASE}")`).first().getAttribute("href")
  ?? await page.locator(`a[href^="${project}/test-cases/c"]`).first().getAttribute("href");
const fill = (url) => url.replace("{project}", project).replace("{case}", caseHref);

for (const section of SECTIONS.filter((s) => !s.signedOut)) {
  await page.setViewportSize({ width: 1360, height: section.height ?? SHOT_HEIGHT });
  await open(fill(section.path));
  const found = section.callouts ? await annotate(section.callouts) : [];
  shots[section.id] = {
    image: section.shot === "profile" ? null : await screenshot(),
    callouts: (section.callouts ?? []).filter((callout) => found.includes(callout.target)),
  };
  console.log(`  ${section.title}: ${found.length}/${section.callouts?.length ?? 0} parts`);
}

// The dialogs and forms the tasks talk about.
await page.setViewportSize({ width: 1360, height: 1000 });
await open(`${project}/test-cases`);
await page.getByRole("button", { name: "New test case" }).click();
await page.getByRole("dialog").waitFor();
await page.waitForTimeout(500);
extra["new-case"] = await screenshot(page.getByRole("dialog"));
await page.keyboard.press("Escape");

await open(caseHref);
const record = page.getByRole("button", { name: "Record result" });
if (await record.count()) {
  await record.click();
  await page.locator("#actualResult").waitFor();
  await page.waitForTimeout(500);
  extra.record = await screenshot(page.locator("#execution-panel"));
}

await open("/dashboard");
await page.getByLabel("Account menu").click();
await page.getByRole("menu").waitFor();
await page.waitForTimeout(400);
extra.menu = await screenshot(page.getByRole("menu"));
await page.getByRole("menuitem", { name: "Profile" }).click();
await page.getByRole("dialog").waitFor();
await page.waitForTimeout(500);
extra.profile = await screenshot(page.getByRole("dialog"));

// ---- Document ---------------------------------------------------------------

const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (text) =>
  escape(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`(.+?)`/g, "<code>$1</code>");
const figure = (src, caption, narrow = false) =>
  src ? `<figure class="${narrow ? "narrow" : ""}"><img src="${src}" alt="">${caption ? `<figcaption>${inline(caption)}</figcaption>` : ""}</figure>` : "";

const sectionsHtml = SECTIONS.map((section, index) => {
  const shot = shots[section.id];
  const pictures =
    section.shot === "profile"
      ? `<div class="pair">${figure(extra.menu, "The account menu", true)}${figure(extra.profile, "Profile", true)}</div>`
      : figure(shot.image);
  const callouts = shot.callouts.length
    ? `<ol class="callouts">${shot.callouts
        .map((c, i) => `<li><span class="badge">${i + 1}</span><div><strong>${inline(c.label)}</strong> — ${inline(c.text)}</div></li>`)
        .join("")}</ol>`
    : "";
  const bullets = section.bullets ? `<ul class="bullets">${section.bullets.map((b) => `<li>${inline(b)}</li>`).join("")}</ul>` : "";
  const tasks = (section.tasks ?? [])
    .map(
      (task) => `<div class="task"><h3>${inline(task.title)}</h3>${
        task.shot && extra[task.shot] ? figure(extra[task.shot], null, true) : ""
      }<ol>${task.steps.map((step) => `<li>${inline(step)}</li>`).join("")}</ol></div>`,
    )
    .join("");
  const tips = section.tips?.length
    ? `<div class="tips"><strong>Good to know</strong><ul>${section.tips.map((t) => `<li>${inline(t)}</li>`).join("")}</ul></div>`
    : "";
  return `<section id="${section.id}"><p class="kicker">${index + 1}</p><h2>${inline(section.title)}</h2><p class="intro">${inline(
    section.intro,
  )}</p>${pictures}${callouts}${bullets}${tasks}${tips}</section>`;
}).join("");

const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const html = `<!doctype html><html><head><meta charset="utf-8"><title>${TITLE} — ${SUBTITLE}</title><style>
  @page { size: A4; margin: 16mm 15mm 18mm; }
  * { box-sizing: border-box; }
  body { font: 10.5pt/1.55 -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #0f172a; margin: 0; }
  .cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; }
  .cover .mark { width: 54px; height: 54px; border-radius: 14px; background: #1e293b; color: white; font: 700 26px/54px system-ui; text-align: center; }
  .cover h1 { font-size: 34pt; margin: 22px 0 0; letter-spacing: -0.02em; }
  .cover .sub { font-size: 18pt; color: #475569; margin: 4px 0 26px; }
  .cover .meta { color: #64748b; }
  .contents { page-break-before: always; }
  .contents ol { padding-left: 1.2em; columns: 2; column-gap: 2em; }
  .contents li { margin: 3px 0; }
  .contents a { color: inherit; text-decoration: none; }
  h2 { font-size: 20pt; margin: 0 0 6px; letter-spacing: -0.01em; }
  h3 { font-size: 12pt; margin: 18px 0 6px; }
  .kicker { margin: 0; color: #f97316; font-weight: 700; font-size: 11pt; }
  section { page-break-before: always; }
  .intro { color: #334155; font-size: 11pt; margin: 0 0 12px; }
  figure { margin: 10px 0 12px; }
  figure img { width: 100%; border: 1px solid #e2e8f0; border-radius: 8px; display: block; }
  figure.narrow img { width: auto; max-width: 100%; max-height: 120mm; }
  figcaption { color: #64748b; font-size: 9pt; margin-top: 4px; }
  .pair { display: flex; gap: 12px; align-items: flex-start; }
  .pair figure { flex: 0 1 auto; }
  .callouts { list-style: none; padding: 0; margin: 8px 0 4px; }
  .callouts li { display: flex; gap: 10px; align-items: flex-start; margin: 6px 0; page-break-inside: avoid; }
  .badge { flex: 0 0 22px; height: 22px; border-radius: 999px; background: #f97316; color: white; font-weight: 700; font-size: 10pt; line-height: 22px; text-align: center; }
  .task { page-break-inside: avoid; }
  .task ol { padding-left: 1.3em; margin: 6px 0; }
  .task li, .bullets li { margin: 3px 0; }
  .tips { background: #f1f5f9; border-radius: 8px; padding: 10px 14px; margin-top: 14px; page-break-inside: avoid; }
  .tips ul { margin: 4px 0 0; padding-left: 1.2em; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; }
  td, th { border-bottom: 1px solid #e2e8f0; padding: 7px 8px; text-align: left; vertical-align: top; }
  th { color: #475569; font-weight: 600; }
  code { font: 9.5pt ui-monospace, Menlo, monospace; background: #f1f5f9; padding: 1px 4px; border-radius: 4px; }
  /* On screen (the in-app preview): white pages on grey, like a book. */
  @media screen {
    html { background: #e2e8f0; }
    body { padding: 24px 12px; }
    .cover, .contents, section {
      background: white; max-width: 210mm; margin: 0 auto 20px; padding: 16mm 15mm; border-radius: 6px;
      box-shadow: 0 1px 3px rgba(15, 23, 42, .12), 0 8px 24px rgba(15, 23, 42, .06);
    }
    .cover { height: auto; min-height: 240mm; }
    @media (max-width: 640px) {
      body { padding: 12px 8px; }
      .cover, .contents, section { padding: 22px 16px; }
      .cover { min-height: 0; padding-top: 72px; padding-bottom: 72px; }
      .contents ol { columns: 1; }
      .pair { flex-direction: column; }
    }
  }
</style></head><body>
<div class="cover"><div class="mark">✓</div><h1>${TITLE}</h1><p class="sub">${SUBTITLE}</p>
<p class="meta">How to plan, run and track test cases — page by page.<br>${today}</p></div>
<div class="contents"><h2>Contents</h2><ol>${SECTIONS.map((s) => `<li><a href="#${s.id}">${inline(s.title)}</a></li>`).join("")}</ol>
<h3>Who does what</h3><table><tr><th>Role</th><th>What they do</th></tr>${ROLES.map((r) => `<tr><td><strong>${r.role}</strong></td><td>${inline(r.can)}</td></tr>`).join("")}</table>
<h3>Reading the pictures</h3><p>The numbered marks <span class="badge" style="display:inline-block;width:22px">1</span> on each screenshot match the list under it. You may not see every part: some are only for certain roles, and some appear only when there is something to show.</p></div>
${sectionsHtml}
</body></html>`;

const pdfPage = await context.newPage();
await pdfPage.setContent(html, { waitUntil: "load" });
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT_HTML, html);
await writeFile(
  OUT,
  await pdfPage.pdf({
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: `<div style="width:100%;font:8pt system-ui;color:#94a3b8;padding:0 15mm;display:flex;justify-content:space-between"><span>${TITLE} — ${SUBTITLE}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    margin: { top: "16mm", bottom: "18mm", left: "15mm", right: "15mm" },
  }),
);
console.log(`Wrote ${path.relative(process.cwd(), OUT)} and ${path.basename(OUT_HTML)}`);
await browser.close();
