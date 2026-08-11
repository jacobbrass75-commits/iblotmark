#!/usr/bin/env node

import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { marked } from "marked";

const sourceDir = path.resolve(
  process.argv.find((arg) => arg.startsWith("--source="))?.slice("--source=".length)
    || "content-output/top-10-category-program-2026-08-05/drafts",
);
const outputDir = path.resolve(
  process.argv.find((arg) => arg.startsWith("--output="))?.slice("--output=".length)
    || "content-output/top-10-category-program-2026-08-05/shopify-previews",
);

marked.setOptions({ gfm: true, breaks: false });

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function parseDraft(markdown, filename) {
  const metaTitle = markdown.match(/^Meta Title:\s*(.+)$/m)?.[1]?.trim() || "";
  const metaDescription = markdown.match(/^Meta Description:\s*(.+)$/m)?.[1]?.trim() || "";
  const slug = markdown.match(/^Slug:\s*(.+)$/m)?.[1]?.trim() || filename.replace(/\.md$/, "");
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || metaTitle;
  const firstImage = markdown.match(/<img\s+[^>]*src="([^"]+)"/i)?.[1] || "";
  const bodyMarkdown = markdown
    .replace(/^Meta Title:.*\n?/m, "")
    .replace(/^Meta Description:.*\n?/m, "")
    .replace(/^Slug:.*\n?/m, "")
    .replace(/^#\s+.*\n?/m, "")
    .trim();
  return {
    filename,
    metaTitle,
    metaDescription,
    slug,
    title,
    firstImage,
    bodyHtml: marked.parse(bodyMarkdown),
  };
}

const themeCss = `
  @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&display=swap');
  :root { --orange:#f36f21; --ink:#1a1a1a; --muted:#676767; --paper:#ffffff; --wash:#f0f0f0; --line:#dedede; }
  * { box-sizing:border-box; }
  html { scroll-behavior:smooth; }
  body { margin:0; font-family:Barlow,Arial,sans-serif; color:var(--ink); background:var(--paper); }
  a { color:inherit; }
  .announcement { height:34px; display:flex; align-items:center; justify-content:center; gap:38px; padding:0 24px; background:var(--orange); color:#fff; font-size:12px; font-weight:800; letter-spacing:.06em; }
  .site-header { height:88px; display:grid; grid-template-columns:1fr auto 1fr; align-items:center; padding:0 52px; background:var(--wash); border-bottom:1px solid #ddd; position:sticky; top:0; z-index:5; }
  .nav { display:flex; gap:27px; font-size:13px; font-weight:800; letter-spacing:.035em; }
  .brand { font-size:27px; font-weight:800; letter-spacing:-.04em; text-decoration:none; }
  .header-actions { display:flex; justify-content:flex-end; gap:18px; font-size:13px; font-weight:700; }
  .preview-ribbon { background:#1a1a1a; color:#fff; text-align:center; padding:9px; font-size:12px; font-weight:700; letter-spacing:.08em; }
  .breadcrumbs { max-width:1160px; margin:0 auto; padding:24px 28px 0; color:#777; font-size:13px; }
  .article-header { max-width:980px; margin:0 auto; padding:54px 28px 38px; text-align:center; }
  .article-header .eyebrow { color:var(--orange); font-size:13px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; }
  .article-header h1 { margin:14px auto 18px; max-width:900px; font-size:52px; line-height:1.02; letter-spacing:-.035em; }
  .article-header .meta { color:var(--muted); font-size:14px; }
  .article-shell { max-width:1160px; margin:0 auto; padding:0 28px 96px; display:grid; grid-template-columns:minmax(0,780px) 270px; gap:78px; align-items:start; }
  .article-body { font-size:18px; line-height:1.7; min-width:0; }
  .article-body > p:first-child { font-size:22px; line-height:1.55; color:#333; }
  .article-body h2 { margin:58px 0 20px; font-size:34px; line-height:1.12; letter-spacing:-.025em; }
  .article-body h3 { margin:38px 0 8px; font-size:24px; line-height:1.2; }
  .article-body p { margin:0 0 20px; }
  .article-body a { text-decoration-color:var(--orange); text-decoration-thickness:2px; text-underline-offset:3px; }
  .article-body strong { font-weight:700; }
  .article-body table { display:table; width:100%; border-collapse:collapse; margin:22px 0 36px; font-size:14px; line-height:1.35; }
  .article-body th { background:#1a1a1a; color:#fff; text-align:left; padding:13px 11px; }
  .article-body td { border-bottom:1px solid var(--line); padding:12px 11px; vertical-align:top; }
  .article-body tr:nth-child(even) td { background:#fafafa; }
  .article-body img { display:block; max-width:560px; width:100%; max-height:520px; object-fit:contain; margin:28px auto 8px; border-radius:3px; background:#f8f8f8; }
  .article-body img + em, .article-body a + em { display:block; color:#777; text-align:center; font-size:14px; }
  .article-body blockquote { border-left:4px solid var(--orange); background:#f7f7f7; margin:32px 0; padding:20px 24px; }
  .side-card { position:sticky; top:148px; border:1px solid var(--line); background:#f7f7f7; padding:26px; }
  .side-card .label { color:var(--orange); font-size:12px; font-weight:800; letter-spacing:.1em; }
  .side-card h3 { font-size:24px; margin:10px 0; }
  .side-card p { color:#555; line-height:1.55; }
  .button { display:block; margin-top:18px; padding:14px 16px; background:var(--orange); color:#fff; text-align:center; text-decoration:none; font-weight:800; }
  footer { background:#1a1a1a; color:#fff; padding:58px 50px; }
  footer .footer-inner { max-width:1160px; margin:auto; display:flex; justify-content:space-between; gap:40px; }
  footer .footer-brand { font-size:28px; font-weight:800; }
  footer p { max-width:620px; color:#bbb; line-height:1.6; }
  .index-hero { background:var(--wash); padding:76px 28px 62px; text-align:center; }
  .index-hero .eyebrow { color:var(--orange); font-weight:800; letter-spacing:.12em; }
  .index-hero h1 { margin:12px 0 14px; font-size:56px; letter-spacing:-.04em; }
  .index-hero p { max-width:720px; margin:auto; font-size:19px; line-height:1.55; color:#555; }
  .grid { max-width:1240px; margin:0 auto; padding:58px 28px 92px; display:grid; grid-template-columns:repeat(3,1fr); gap:30px; }
  .card { border:1px solid var(--line); background:#fff; text-decoration:none; transition:transform .2s,border-color .2s; overflow:hidden; }
  .card:hover { transform:translateY(-3px); border-color:var(--orange); }
  .card-image { height:235px; background:#f7f7f7; display:flex; align-items:center; justify-content:center; padding:18px; }
  .card-image img { width:100%; height:100%; object-fit:contain; }
  .card-copy { padding:23px 24px 26px; }
  .card-copy .tag { color:var(--orange); font-size:11px; font-weight:800; letter-spacing:.1em; }
  .card-copy h2 { margin:8px 0 10px; font-size:24px; line-height:1.15; }
  .card-copy p { color:#666; line-height:1.5; margin:0; }
  @media (max-width:900px) {
    .site-header { height:68px; padding:0 18px; grid-template-columns:1fr auto; }
    .nav { display:none; }
    .brand { font-size:23px; }
    .header-actions { font-size:0; }
    .header-actions::after { content:'MENU'; font-size:12px; }
    .announcement { gap:10px; font-size:10px; overflow:hidden; white-space:nowrap; }
    .announcement span:nth-child(n+2) { display:none; }
    .article-header { padding-top:38px; }
    .article-header h1 { font-size:38px; }
    .article-shell { display:block; padding:0 20px 62px; }
    .article-body { font-size:17px; }
    .article-body > p:first-child { font-size:20px; }
    .article-body h2 { font-size:29px; margin-top:45px; }
    .article-body table { display:block; overflow-x:auto; white-space:nowrap; }
    .side-card { display:none; }
    .grid { grid-template-columns:1fr; padding:30px 18px 64px; }
    .index-hero { padding:48px 20px; }
    .index-hero h1 { font-size:39px; }
    footer { padding:42px 22px; }
    footer .footer-inner { display:block; }
  }
`;

function shell({ title, body, description = "" }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="${escapeHtml(description)}">
  <title>${escapeHtml(title)}</title>
  <style>${themeCss}</style>
</head>
<body>
  <div class="announcement"><span>SHIPS WITHIN 24 BUSINESS HOURS</span><span>FREE SHIPPING ON ORDERS OVER $75</span><span>BUILD A CUSTOM MOUNT</span></div>
  <header class="site-header">
    <nav class="nav"><span>ALL MOUNTS</span><span>INDUSTRIES</span><span>DEVICES</span></nav>
    <a class="brand" href="index.html">iBOLT Mounts</a>
    <div class="header-actions"><span>SEARCH</span><span>ACCOUNT</span><span>CART</span></div>
  </header>
  <div class="preview-ribbon">LOCAL SHOPIFY PREVIEW · REVIEW ONLY · NOT PUBLISHED</div>
  ${body}
  <footer><div class="footer-inner"><div class="footer-brand">iBOLT Mounts</div><p>Heavy-duty modular mounting solutions for tablets, smartphones, cameras, ELD devices, warehouse scanners, marine electronics, and commercial operations.</p></div></footer>
</body>
</html>`;
}

function articlePage(article) {
  return shell({
    title: article.metaTitle,
    description: article.metaDescription,
    body: `
      <div class="breadcrumbs">Home / News / ${escapeHtml(article.title)}</div>
      <header class="article-header">
        <div class="eyebrow">Buying Guide</div>
        <h1>${escapeHtml(article.title)}</h1>
        <div class="meta">August 5, 2026 &nbsp;·&nbsp; iBOLT Mounts Editorial Team</div>
      </header>
      <main class="article-shell">
        <article class="article-body">${article.bodyHtml}</article>
        <aside class="side-card">
          <div class="label">NEED A SPECIFIC SETUP?</div>
          <h3>Build the right mount</h3>
          <p>Match the holder, arm, ball size, and base to your device and working environment.</p>
          <a class="button" href="https://iboltmounts.com/products/build-your-own-mount">BUILD A CUSTOM MOUNT</a>
        </aside>
      </main>`,
  });
}

function indexPage(articles) {
  const cards = articles.map((article) => `
    <a class="card" href="${encodeURIComponent(article.slug)}.html">
      <div class="card-image">${article.firstImage ? `<img src="${escapeHtml(article.firstImage)}" alt="">` : ""}</div>
      <div class="card-copy">
        <div class="tag">TOP 10 BUYING GUIDE</div>
        <h2>${escapeHtml(article.title)}</h2>
        <p>${escapeHtml(article.metaDescription)}</p>
      </div>
    </a>`).join("\n");
  return shell({
    title: "iBOLT Top 10 Draft Previews",
    description: "Local review previews for the iBOLT Top 10 category program.",
    body: `
      <section class="index-hero"><div class="eyebrow">DRAFT CONTENT SERIES</div><h1>Top 10 Mounting Guides</h1><p>Specification-based guides for commercial buyers. These local previews use current iBOLT product data and official catalog imagery.</p></section>
      <main class="grid">${cards}</main>`,
  });
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  const files = (await readdir(sourceDir)).filter((name) => /^top-10-.*\.md$/.test(name)).sort();
  const articles = [];
  for (const filename of files) {
    const markdown = await readFile(path.join(sourceDir, filename), "utf8");
    const article = parseDraft(markdown, filename);
    articles.push(article);
    await writeFile(path.join(outputDir, `${article.slug}.html`), articlePage(article), "utf8");
  }
  await writeFile(path.join(outputDir, "index.html"), indexPage(articles), "utf8");
  await writeFile(path.join(outputDir, "preview-manifest.json"), `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    mode: "local-review-only",
    published: false,
    sourceDir: path.relative(process.cwd(), sourceDir),
    articles: articles.map(({ slug, title, metaTitle, metaDescription, firstImage }) => ({ slug, title, metaTitle, metaDescription, firstImage })),
  }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputDir: path.relative(process.cwd(), outputDir), articleCount: articles.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
