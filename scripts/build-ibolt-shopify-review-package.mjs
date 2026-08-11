import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceArgIndex = process.argv.indexOf("--source-dir");
const sourceArg = sourceArgIndex >= 0 ? process.argv[sourceArgIndex + 1] : null;
const sourceDir = sourceArg
  ? path.resolve(repoRoot, sourceArg)
  : path.join(repoRoot, "content-output", "ibolt-brand-story-series-2026-07-15");
if (!fs.existsSync(sourceDir)) throw new Error(`Source directory not found: ${sourceDir}`);
const outputDir = path.join(sourceDir, "shopify-review");
const bodyDir = path.join(outputDir, "body-html");
const previewDir = path.join(outputDir, "previews");

fs.mkdirSync(bodyDir, { recursive: true });
fs.mkdirSync(previewDir, { recursive: true });

const articleFiles = fs.readdirSync(sourceDir)
  .filter((file) => /^\d{2}-.*\.md$/.test(file))
  .sort();

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function plainText(value) {
  return String(value || "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#*_`>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function requiredMatch(markdown, pattern, label, file) {
  const match = markdown.match(pattern);
  if (!match?.[1]) throw new Error(`${file}: missing ${label}`);
  return match[1].trim();
}

function extractFaqPairs(markdown) {
  const section = markdown.split(/^## Frequently Asked Questions\s*$/m)[1] || "";
  const pairs = [];
  const pattern = /^###\s+(.+\?)\s*\n+([\s\S]*?)(?=^###\s+.+\?\s*$|$)/gm;
  let match;
  while ((match = pattern.exec(section)) !== null) {
    pairs.push({
      question: plainText(match[1]),
      answer: plainText(match[2]),
    });
  }
  return pairs;
}

function faqSchema(markdown) {
  const pairs = extractFaqPairs(markdown);
  if (pairs.length === 0) return "";
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: pairs.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
  return `<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>`;
}

function allLinks(markdown) {
  const links = [];
  for (const match of markdown.matchAll(/\[[^\]]+]\((https:\/\/[^)\s]+)\)/g)) links.push(match[1]);
  for (const match of markdown.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)) links.push(match[1]);
  return [...new Set(links)];
}

const articles = articleFiles.map((file) => {
  const markdown = fs.readFileSync(path.join(sourceDir, file), "utf8");
  const actionValue = requiredMatch(markdown, /\*\*Content Action:\*\*\s*(.+)/, "Content Action", file);
  const action = actionValue.startsWith("REFRESH ") ? "REFRESH" : actionValue;
  const targetUrl = action === "REFRESH" ? actionValue.replace(/^REFRESH\s+/, "") : null;
  const title = requiredMatch(markdown, /^#\s+(.+)$/m, "title", file);
  const metaTitle = requiredMatch(markdown, /\*\*Meta Title:\*\*\s*(.+)/, "Meta Title", file);
  const metaDescription = requiredMatch(markdown, /\*\*Meta Description:\*\*\s*(.+)/, "Meta Description", file);
  const slug = requiredMatch(markdown, /\*\*Slug:\*\*\s*(\S+)/, "Slug", file);
  const articleUrl = targetUrl || `https://iboltmounts.com/blogs/news/${slug}`;

  const bodyStart = markdown.search(/^#\s+/m);
  const bodyMarkdown = markdown.slice(bodyStart).replace(/^#\s+.+\n+/, "");
  const renderedBody = marked.parse(bodyMarkdown, { gfm: true, breaks: false });
  const schema = faqSchema(bodyMarkdown);
  const bodyHtml = `<!-- Shopify SEO fields -->\n<!-- Meta title: ${metaTitle} -->\n<!-- Meta description: ${metaDescription} -->\n<!-- Handle: ${slug} -->\n\n${renderedBody}\n${schema}\n`;

  const stem = file.replace(/\.md$/, "");
  const bodyFile = `${stem}.shopify.html`;
  const previewFile = `${stem}.preview.html`;
  fs.writeFileSync(path.join(bodyDir, bodyFile), bodyHtml);
  fs.writeFileSync(path.join(previewDir, previewFile), `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(metaTitle)}</title>
  <meta name="description" content="${escapeHtml(metaDescription)}">
  <style>
    body { max-width: 780px; margin: 0 auto; padding: 28px 20px 80px; font: 17px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #17202a; }
    h1 { font-size: clamp(2rem, 6vw, 3rem); line-height: 1.08; margin: 28px 0 18px; }
    h2 { font-size: 1.65rem; line-height: 1.2; margin-top: 2.4rem; }
    h3 { font-size: 1.18rem; margin-top: 1.7rem; }
    a { color: #b33b19; }
    img { display: block; max-width: 100%; height: auto; margin-inline: auto; }
    .review-meta { background: #f3f5f7; border-radius: 12px; padding: 16px 18px; font-size: 14px; }
    .review-meta p { margin: 4px 0; }
  </style>
</head>
<body>
  <aside class="review-meta">
    <p><strong>Review status:</strong> ${escapeHtml(action)}. Not published.</p>
    <p><strong>Meta title:</strong> ${escapeHtml(metaTitle)}</p>
    <p><strong>Meta description:</strong> ${escapeHtml(metaDescription)}</p>
    <p><strong>Handle:</strong> ${escapeHtml(slug)}</p>
  </aside>
  <h1>${escapeHtml(title)}</h1>
  ${renderedBody}
  ${schema}
</body>
</html>
`);

  const links = allLinks(bodyMarkdown);
  return {
    sequence: Number(file.slice(0, 2)),
    action,
    target_url: targetUrl,
    planned_url: articleUrl,
    title,
    handle: slug,
    meta_title: metaTitle,
    meta_description: metaDescription,
    published: false,
    source_markdown_file: `../${file}`,
    shopify_body_html_file: `body-html/${bodyFile}`,
    preview_file: `previews/${previewFile}`,
    body_html: bodyHtml,
    faq_count: extractFaqPairs(bodyMarkdown).length,
    image_count: (bodyMarkdown.match(/<img\b/g) || []).length,
    links,
    internal_blog_links: links.filter((url) => url.includes("iboltmounts.com/blogs/")),
    product_links: links.filter((url) => url.includes("iboltmounts.com/products/")),
    collection_links: links.filter((url) => url.includes("iboltmounts.com/collections/")),
  };
});

for (const article of articles) {
  article.incoming_series_links = articles
    .filter((source) => source.sequence !== article.sequence && source.links.includes(article.planned_url))
    .map((source) => ({ sequence: source.sequence, title: source.title }));
}

const manifest = {
  generated_at: new Date().toISOString(),
  publication_status: "review_only_not_published",
  publication_order: {
    first_create_new_articles: articles.filter((article) => article.action === "NEW").map((article) => article.sequence),
    then_update_existing_articles: articles.filter((article) => article.action === "REFRESH").map((article) => article.sequence),
  },
  articles,
};

fs.writeFileSync(path.join(outputDir, "shopify-review-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const newArticles = articles.filter((article) => article.action === "NEW");
const refreshArticles = articles.filter((article) => article.action === "REFRESH");
const tableRows = (items) => items.map((article) =>
  `| ${article.sequence} | [${article.title}](${article.preview_file}) | [Shopify HTML](${article.shopify_body_html_file}) | ${article.internal_blog_links.length} | ${article.incoming_series_links.length} |`
).join("\n");

const reviewMarkdown = `# Shopify Review Package

Status: Review only. Nothing has been published to Shopify.

The Shopify body files omit the H1 because Shopify themes normally render the article title separately. Each file preserves product image blocks and includes FAQ JSON-LD. SEO titles and descriptions are listed in comments at the top and in \`shopify-review-manifest.json\`.

## Publish in this order

1. Create the ${newArticles.length} new articles below as unpublished Shopify drafts, preserving their handles.
2. Preview and approve the ${newArticles.length} new URLs.
3. Update the ${refreshArticles.length} existing articles below in place. Do not create duplicate articles for the refreshes.
4. Recheck the planned cross-links, then schedule or publish.

This order matters because the refresh articles contain incoming links to the new handles.

## ${newArticles.length} new articles

| # | Review preview | Copy-ready body | Outgoing blog links | Incoming series links |
|---:|---|---|---:|---:|
${tableRows(newArticles)}

## ${refreshArticles.length} existing articles to refresh

| # | Review preview | Copy-ready body | Outgoing blog links | Incoming series links |
|---:|---|---|---:|---:|
${tableRows(refreshArticles)}

## Package files

- \`shopify-review-manifest.json\`: all fields and complete body HTML, with \`published: false\` for every article.
- \`body-html/\`: copy-ready Shopify article bodies.
- \`previews/\`: standalone local review pages.
- \`BACKLINK_AUDIT.md\`: internal-link coverage and publication-order notes.
`;
fs.writeFileSync(path.join(outputDir, "SHOPIFY_REVIEW.md"), reviewMarkdown);

const backlinkRows = articles.map((article) =>
  `| ${article.sequence} | ${article.action} | ${article.internal_blog_links.length} | ${article.incoming_series_links.length} | ${article.product_links.length} | ${article.collection_links.length} |`
).join("\n");
const totalBlogLinks = articles.reduce((sum, article) => sum + article.internal_blog_links.length, 0);
const totalProductLinks = articles.reduce((sum, article) => sum + article.product_links.length, 0);
const backlinkMarkdown = `# Internal Backlink Audit

This audit covers internal iBOLT links. It does not claim external backlinks from third-party sites.

After the backlink pass, every new article should have at least one incoming link from another article in this ${articles.length}-piece package. Planned new URLs will return 404 until the new Shopify drafts are created, which is why new articles must be created before the refreshes are applied.

| # | Action | Outgoing blog links | Incoming series links | Product links | Collection links |
|---:|---|---:|---:|---:|---:|
${backlinkRows}

Totals: ${totalBlogLinks} article-to-article links and ${totalProductLinks} product links across the series.

## Terminology

- Internal link: a link between two pages on iboltmounts.com.
- Internal backlink: an incoming link to one article from another iBOLT article.
- External backlink: a link to iBOLT from another website. This package cannot create external backlinks by itself.
`;
fs.writeFileSync(path.join(outputDir, "BACKLINK_AUDIT.md"), backlinkMarkdown);

const reviewCards = articles.map((article) => `
  <article class="card">
    <div class="eyebrow"><span class="badge">${escapeHtml(article.action)}</span> Article ${article.sequence}</div>
    <h2>${escapeHtml(article.title)}</h2>
    <p>${escapeHtml(article.meta_description)}</p>
    <dl>
      <div><dt>Handle</dt><dd>${escapeHtml(article.handle)}</dd></div>
      <div><dt>FAQs</dt><dd>${article.faq_count}</dd></div>
      <div><dt>Images</dt><dd>${article.image_count}</dd></div>
      <div><dt>Incoming links</dt><dd>${article.incoming_series_links.length}</dd></div>
    </dl>
    <div class="actions">
      <a class="primary" href="${escapeHtml(article.preview_file)}">Open visual preview</a>
      <a href="${escapeHtml(article.shopify_body_html_file)}">Open Shopify HTML</a>
    </div>
  </article>`).join("\n");

fs.writeFileSync(path.join(outputDir, "review-index.html"), `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>iBOLT Shopify Article Review</title>
  <style>
    :root { color-scheme: light; --ink:#17202a; --muted:#667085; --accent:#b33b19; --line:#e5e7eb; --panel:#fff; --wash:#f5f6f7; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--wash); color:var(--ink); font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    main { width:min(100% - 28px, 920px); margin:0 auto; padding:34px 0 72px; }
    header { margin-bottom:24px; }
    h1 { margin:0 0 8px; font-size:clamp(2rem,8vw,3.5rem); line-height:1.02; }
    h2 { margin:10px 0 8px; font-size:1.35rem; line-height:1.2; }
    p { margin:0; }
    .status { color:var(--muted); }
    .grid { display:grid; gap:16px; }
    .card { min-width:0; padding:20px; border:1px solid var(--line); border-radius:16px; background:var(--panel); box-shadow:0 8px 24px rgba(16,24,40,.05); }
    .eyebrow { color:var(--muted); font-size:.78rem; font-weight:700; letter-spacing:.06em; text-transform:uppercase; }
    .badge { display:inline-block; margin-right:8px; padding:3px 8px; border-radius:999px; background:#fff0eb; color:var(--accent); }
    dl { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin:18px 0; }
    dl div { min-width:0; }
    dt { color:var(--muted); font-size:.75rem; text-transform:uppercase; }
    dd { overflow-wrap:anywhere; margin:2px 0 0; }
    .actions { display:flex; flex-wrap:wrap; gap:10px; }
    a { display:inline-block; color:var(--accent); font-weight:700; text-decoration:none; }
    a.primary { padding:10px 13px; border-radius:10px; background:var(--accent); color:#fff; }
    .actions a:not(.primary) { padding:10px 3px; }
    @media (min-width:760px) { .grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Shopify article review</h1>
      <p class="status">${articles.length} articles. Review only. Nothing in this package has been uploaded or published.</p>
    </header>
    <section class="grid">${reviewCards}
    </section>
  </main>
</body>
</html>
`);

console.log(`Built Shopify review package for ${articles.length} articles at ${outputDir}`);
