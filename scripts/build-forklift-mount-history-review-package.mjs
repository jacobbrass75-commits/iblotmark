#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const seriesDir = path.join(
  repoRoot,
  "content-output",
  "forklift-mount-history-series-2026-08-25",
);
const reviewDir = path.join(seriesDir, "shopify-review");
const bodyDir = path.join(reviewDir, "body-html");
const previewDir = path.join(reviewDir, "previews");

fs.mkdirSync(bodyDir, { recursive: true });
fs.mkdirSync(previewDir, { recursive: true });

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

function parseDraft(filename, raw) {
  const frontmatter = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontmatter) throw new Error(`${filename}: missing frontmatter`);

  const meta = {};
  for (const line of frontmatter[1].split("\n")) {
    const splitAt = line.indexOf(":");
    if (splitAt < 0) continue;
    meta[line.slice(0, splitAt).trim()] = line.slice(splitAt + 1).trim();
  }

  const required = [
    "title",
    "slug",
    "metaTitle",
    "metaDescription",
    "primaryKeyword",
    "heroAsset",
    "contentAction",
  ];
  for (const key of required) {
    if (!meta[key]) throw new Error(`${filename}: missing ${key}`);
  }
  if (meta.contentAction === "REFRESH" && !meta.targetUrl) {
    throw new Error(`${filename}: refresh drafts require targetUrl`);
  }

  return {
    filename,
    meta,
    markdown: raw.slice(frontmatter[0].length).trim(),
  };
}

function extractFaqPairs(markdown) {
  const faq = (markdown.split(/^## Frequently Asked Questions\s*$/m)[1] || "")
    .split(/<!--\s*FAQ END\s*-->/i)[0];
  const pairs = [];
  const pattern = /^\*\*Q:\s*(.+?\?)\*\*\s*\n+([\s\S]*?)(?=^\*\*Q:|^##\s+|$)/gm;
  let match;
  while ((match = pattern.exec(faq)) !== null) {
    pairs.push({
      question: plainText(match[1]),
      answer: plainText(match[2]),
    });
  }
  return pairs;
}

function renderFaqAccordion(pairs) {
  if (pairs.length === 0) return "";
  const rows = pairs.map((pair, index) => `<details class="ibolt-faq-row"${index === 0 ? " open" : ""}>
  <summary>
    <span>${escapeHtml(pair.question)}</span>
    <span class="ibolt-faq-toggle" aria-hidden="true"><span class="ibolt-faq-plus">+</span><span class="ibolt-faq-minus">−</span></span>
  </summary>
  <div class="ibolt-faq-answer"><p>${escapeHtml(pair.answer)}</p></div>
</details>`).join("\n");

  return `<style>
.ibolt-faq { margin: 38px 0; border-top: 1px solid #d8dee4; }
.ibolt-faq h2 { margin: 0; padding: 28px 0 12px; font-size: 28px; line-height: 1.2; }
.ibolt-faq-row { border-bottom: 1px solid #d8dee4; }
.ibolt-faq-row summary { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 22px 0; cursor: pointer; list-style: none; font-size: 20px; line-height: 1.35; font-weight: 650; }
.ibolt-faq-row summary::-webkit-details-marker { display: none; }
.ibolt-faq-toggle { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border: 2px solid currentColor; border-radius: 999px; font-size: 22px; line-height: 1; }
.ibolt-faq-row[open] .ibolt-faq-plus { display: none; }
.ibolt-faq-row:not([open]) .ibolt-faq-minus { display: none; }
.ibolt-faq-answer { max-width: 720px; padding: 0 54px 22px 0; }
.ibolt-faq-answer p { margin: 0; }
@media (max-width: 640px) { .ibolt-faq-row summary { font-size: 18px; padding: 18px 0; } .ibolt-faq-answer { padding-right: 0; } }
</style>
<section class="ibolt-faq" aria-label="Frequently Asked Questions">
  <h2>Frequently Asked Questions</h2>
${rows}
</section>`;
}

function applyFaqAccordion(bodyHtml, markdown) {
  const pairs = extractFaqPairs(markdown);
  if (pairs.length === 0) return bodyHtml;
  const heading = /<h2\b[^>]*>\s*Frequently Asked Questions\s*<\/h2>/i.exec(bodyHtml);
  if (!heading || heading.index === undefined) return bodyHtml;

  const start = heading.index;
  const bodyStart = start + heading[0].length;
  const afterHeading = bodyHtml.slice(bodyStart);
  const marker = /<!--\s*FAQ END\s*-->/i.exec(afterHeading);
  const nextH2Index = afterHeading.search(/<h2\b/i);
  let end;
  let remainderStart;
  if (marker?.index !== undefined) {
    end = bodyStart + marker.index;
    remainderStart = end + marker[0].length;
  } else if (nextH2Index >= 0) {
    end = bodyStart + nextH2Index;
    remainderStart = end;
  } else {
    end = bodyHtml.length;
    remainderStart = end;
  }

  return `${bodyHtml.slice(0, start).trimEnd()}\n\n${renderFaqAccordion(pairs)}\n\n${bodyHtml.slice(remainderStart).trimStart()}`;
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
  const urls = [];
  for (const match of markdown.matchAll(/\[[^\]]+]\((https:\/\/[^)\s]+)\)/g)) urls.push(match[1]);
  for (const match of markdown.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)) urls.push(match[1]);
  return [...new Set(urls)];
}

function wordCount(markdown) {
  const text = markdown
    .replace(/<[^>]+>/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[#*_>|]/g, " ");
  return (text.match(/\b[A-Za-z0-9][A-Za-z0-9'-]*\b/g) || []).length;
}

const filenames = fs.readdirSync(seriesDir)
  .filter((filename) => /^0\d-.*\.md$/.test(filename))
  .sort();
if (filenames.length !== 3) throw new Error(`Expected 3 article drafts, found ${filenames.length}`);

const articles = filenames.map((filename) => {
  const draft = parseDraft(filename, fs.readFileSync(path.join(seriesDir, filename), "utf8"));
  const heroFilename = path.basename(draft.meta.heroAsset);
  const previewMarkdown = draft.markdown.replace(
    new RegExp(`src=["']${draft.meta.heroAsset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "g"),
    `src="../../assets/${heroFilename}"`,
  );
  const shopifyMarkdown = draft.markdown.replace(
    new RegExp(`src=["']${draft.meta.heroAsset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "g"),
    `src="__UPLOAD_TO_SHOPIFY_CDN__/${heroFilename}"`,
  );

  const renderedPreviewBody = applyFaqAccordion(
    marked.parse(previewMarkdown, { gfm: true, breaks: false }),
    draft.markdown,
  );
  const renderedShopifyBody = applyFaqAccordion(
    marked.parse(shopifyMarkdown, { gfm: true, breaks: false }),
    draft.markdown,
  );
  const schema = faqSchema(draft.markdown);
  const heroNote = `<!-- HERO UPLOAD REQUIRED: ${draft.meta.heroAsset} -->`;
  const bodyHtml = `<!-- Shopify SEO fields -->
<!-- Meta title: ${draft.meta.metaTitle} -->
<!-- Meta description: ${draft.meta.metaDescription} -->
<!-- Handle: ${draft.meta.slug} -->
<!-- Content action: ${draft.meta.contentAction} -->
${draft.meta.targetUrl ? `<!-- Refresh target: ${draft.meta.targetUrl} -->\n` : ""}${heroNote}

${renderedShopifyBody}
${schema}
`;

  const bodyFilename = `${draft.meta.slug}.shopify.html`;
  const previewFilename = `${draft.meta.slug}.preview.html`;
  fs.writeFileSync(path.join(bodyDir, bodyFilename), bodyHtml);
  fs.writeFileSync(path.join(previewDir, previewFilename), `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(draft.meta.metaTitle)}</title>
  <meta name="description" content="${escapeHtml(draft.meta.metaDescription)}">
  <style>
    body { max-width: 820px; margin: 0 auto; padding: 28px 20px 80px; font: 17px/1.68 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #17202a; }
    h1 { font-size: clamp(2rem, 6vw, 3rem); line-height: 1.08; margin: 28px 0 18px; }
    h2 { font-size: 1.65rem; line-height: 1.2; margin-top: 2.4rem; }
    a { color: #b33b19; }
    img { display: block; max-width: 100%; height: auto; margin-inline: auto; }
    table { width: 100%; border-collapse: collapse; display: block; overflow-x: auto; }
    th, td { border: 1px solid #d8dee4; padding: 9px; text-align: left; vertical-align: top; }
    .review-meta { background: #f3f5f7; border-radius: 12px; padding: 16px 18px; font-size: 14px; }
    .review-meta p { margin: 4px 0; }
  </style>
</head>
<body>
  <aside class="review-meta">
    <p><strong>Review status:</strong> ${escapeHtml(draft.meta.contentAction)}. Not published.</p>
    ${draft.meta.targetUrl ? `<p><strong>Refresh target:</strong> <a href="${escapeHtml(draft.meta.targetUrl)}">${escapeHtml(draft.meta.targetUrl)}</a></p>` : ""}
    ${draft.meta.consolidationCandidateUrl ? `<p><strong>Consolidation candidate:</strong> <a href="${escapeHtml(draft.meta.consolidationCandidateUrl)}">${escapeHtml(draft.meta.consolidationCandidateUrl)}</a></p>` : ""}
    <p><strong>Meta title:</strong> ${escapeHtml(draft.meta.metaTitle)}</p>
    <p><strong>Meta description:</strong> ${escapeHtml(draft.meta.metaDescription)}</p>
    <p><strong>Handle:</strong> ${escapeHtml(draft.meta.slug)}</p>
  </aside>
  <h1>${escapeHtml(draft.meta.title)}</h1>
  ${renderedPreviewBody}
  ${schema}
</body>
</html>
`);

  const links = allLinks(draft.markdown);
  return {
    sourceMarkdown: `../${filename}`,
    title: draft.meta.title,
    handle: draft.meta.slug,
    contentAction: draft.meta.contentAction,
    targetUrl: draft.meta.targetUrl || null,
    consolidationCandidateUrl: draft.meta.consolidationCandidateUrl || null,
    metaTitle: draft.meta.metaTitle,
    metaDescription: draft.meta.metaDescription,
    primaryKeyword: draft.meta.primaryKeyword,
    heroAsset: `../${draft.meta.heroAsset}`,
    heroUploadPending: true,
    wordCount: wordCount(draft.markdown),
    faqCount: extractFaqPairs(draft.markdown).length,
    productImageCount: (draft.markdown.match(/cdn\.shopify\.com/g) || []).length,
    productLinks: links.filter((url) => url.includes("iboltmounts.com/products/")),
    internalLinks: links.filter((url) => url.includes("iboltmounts.com/blogs/") || url.includes("iboltmounts.com/pages/")),
    bodyHtml: `body-html/${bodyFilename}`,
    preview: `previews/${previewFilename}`,
    published: false,
  };
});

const manifest = {
  generatedAt: new Date().toISOString(),
  publicationStatus: "review_only_not_published",
  publicationPlan: "one new article, two in-place refreshes, one duplicate-comparison consolidation decision pending Search Console review",
  heroUploadRequired: true,
  articles,
};
fs.writeFileSync(path.join(reviewDir, "review-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const rows = articles.map((article, index) =>
  `| ${index + 1} | ${article.contentAction} | [${article.title}](${article.preview}) | [Shopify HTML](${article.bodyHtml}) | ${article.wordCount} | ${article.faqCount} | ${article.productImageCount} |`,
).join("\n");

fs.writeFileSync(path.join(reviewDir, "SHOPIFY_REVIEW.md"), `# Shopify Review Package

Status: Review only. Nothing has been uploaded to or published on Shopify.

The source Markdown contains local generated hero images plus official iBOLT product images. The Shopify body files replace each local hero with an explicit \`__UPLOAD_TO_SHOPIFY_CDN__\` placeholder. Upload the approved hero, replace the placeholder, and recheck the final HTML before creating or updating a Shopify draft.

| # | Action | Preview | Shopify body | Words | FAQs | Product images |
|---:|---|---|---|---:|---:|---:|
${rows}

## Publication controls

- Article 1 is the only planned new URL.
- Article 2 refreshes the existing broad forklift guide in place.
- Article 3 refreshes the yearless comparison page. Do not redirect the older comparison until Search Console, backlinks, and conversions are reviewed.
- Recheck current product prices and availability before Shopify work.
- Nothing in this package authorizes a live publish.
`);

console.log(JSON.stringify(manifest, null, 2));
