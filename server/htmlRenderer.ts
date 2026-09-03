// HTML Renderer — Markdown to Shopify-ready HTML with SEO meta tags
// Converts blog pipeline markdown output into publishable HTML.

import { marked } from "marked";
import type { BlogPost } from "@shared/schema";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { products } from "@shared/schema";
import { buildProductUrl, type BrandVoiceInput } from "./brandVoice";
import { getCompanyContext, type CompanyContext } from "./companyContext";
import { signPublicPhotoToken } from "./publicPhotoTokens";

const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL || "http://localhost:5001").replace(/\/$/, "");
if (/scholarmark\.ai/i.test(PUBLIC_BASE_URL)) {
  console.warn("[blog] PUBLIC_BASE_URL still points at scholarmark.ai; Shopify blog images should use a brand-appropriate public domain.");
}

interface RendererOptions {
  companyId?: string | null;
  companyContext?: CompanyContext | null;
}

async function resolveRendererBrand(options?: RendererOptions): Promise<BrandVoiceInput | null> {
  if (options?.companyContext) {
    return options.companyContext.brandProfile;
  }
  if (options?.companyId) {
    try {
      const context = await getCompanyContext(options.companyId);
      return context.brandProfile;
    } catch {
      return null;
    }
  }
  return null;
}

function publicPhotoUrl(kind: "serve" | "thumb", rawPhotoRef: string, fallbackCompanyId: string | null): string {
  const normalized = rawPhotoRef.replace(/&amp;/g, "&");
  const [photoId, queryString = ""] = normalized.split("?");
  const params = new URLSearchParams(queryString);
  const companyId = fallbackCompanyId || params.get("companyId") || "";
  if (!companyId) return `${PUBLIC_BASE_URL}/api/public/blog/photos/${kind}/${encodeURIComponent(photoId)}`;

  params.set("companyId", companyId);
  params.set("token", signPublicPhotoToken(companyId, photoId, kind));
  return `${PUBLIC_BASE_URL}/api/public/blog/photos/${kind}/${encodeURIComponent(photoId)}?${params.toString()}`;
}

/**
 * Convert markdown to HTML using GitHub-flavored markdown. This preserves
 * tables, nested lists, inline formatting, links, images, and raw HTML blocks.
 */
export function markdownToHtml(markdown: string): string {
  return marked.parse(markdown || "", {
    async: false,
    gfm: true,
    breaks: false,
  }) as string;
}

/**
 * Escape HTML entities and apply inline formatting (bold, italic, links, code).
 */
function escapeAndFormat(text: string): string {
  // Don't double-escape
  let result = text
    .replace(/&(?!amp;|lt;|gt;|quot;)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Bold: **text** or __text__
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/__(.+?)__/g, "<strong>$1</strong>");

  // Italic: *text* or _text_
  result = result.replace(/\*(.+?)\*/g, "<em>$1</em>");
  result = result.replace(/_(.+?)_/g, "<em>$1</em>");

  // Inline code: `text`
  result = result.replace(/`(.+?)`/g, "<code>$1</code>");

  // Images MUST come before links — otherwise [alt](url) in ![alt](url) matches the link regex first
  result = result.replace(/!\[(.+?)\]\((.+?)\)/g, '<img src="$2" alt="$1" loading="lazy">');

  // Links: [text](url)
  result = result.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');

  return result;
}

interface FaqPair {
  question: string;
  answer: string;
}

function stripInlineMarkup(value: string): string {
  return plainText(value)
    .replace(/^Q:\s*/i, "")
    .replace(/^A:\s*/i, "")
    .trim();
}

function normalizeFaqQuestion(value: string): string {
  const question = stripInlineMarkup(value).replace(/\s*\?*$/, "");
  return question ? `${question}?` : "";
}

function normalizeFaqAnswer(value: string): string {
  return stripInlineMarkup(value)
    .replace(/\s+/g, " ")
    .trim();
}

function addFaqPair(pairs: FaqPair[], seen: Set<string>, question: string, answer: string): void {
  const normalizedQuestion = normalizeFaqQuestion(question);
  const normalizedAnswer = normalizeFaqAnswer(answer);
  if (!normalizedQuestion || !normalizedAnswer) return;

  const key = normalizedQuestion.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  pairs.push({ question: normalizedQuestion, answer: normalizedAnswer });
}

function extractFaqSection(markdown: string): string {
  const headingMatch = markdown.match(/^##\s+(Frequently Asked Questions|FAQs?|Common Questions)\s*$/im);
  if (headingMatch?.index !== undefined) {
    const afterHeadingStart = headingMatch.index + headingMatch[0].length;
    const afterHeading = markdown.slice(afterHeadingStart);
    const nextH2 = afterHeading.search(/^##\s+/m);
    const faqEnd = afterHeading.search(/<!--\s*FAQ END\s*-->/i);
    const boundaries = [nextH2, faqEnd].filter((index) => index >= 0);
    const end = boundaries.length > 0 ? Math.min(...boundaries) : afterHeading.length;
    return afterHeading.slice(0, end);
  }

  const htmlHeadingMatch = /<h2\b[^>]*>\s*(Frequently Asked Questions|FAQs?|Common Questions)\s*<\/h2>/i.exec(markdown);
  if (!htmlHeadingMatch || htmlHeadingMatch.index === undefined) return "";

  const afterHeadingStart = htmlHeadingMatch.index + htmlHeadingMatch[0].length;
  const afterHeading = markdown.slice(afterHeadingStart);
  const nextH2 = afterHeading.search(/<h2\b/i);
  const faqEnd = afterHeading.search(/<!--\s*FAQ END\s*-->/i);
  const boundaries = [nextH2, faqEnd].filter((index) => index >= 0);
  const end = boundaries.length > 0 ? Math.min(...boundaries) : afterHeading.length;
  return afterHeading.slice(0, end);
}

function extractFaqPairsFromMarkdown(markdown: string): FaqPair[] {
  const faqSection = extractFaqSection(markdown);
  if (!faqSection) return [];

  const pairs: FaqPair[] = [];
  const seen = new Set<string>();

  const qaLabelRegex = /\*\*Q:\s*(.+?)\*\*\s*\n+\s*A:\s*([\s\S]*?)(?=\n\s*\*\*Q:|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = qaLabelRegex.exec(faqSection)) !== null) {
    addFaqPair(pairs, seen, match[1], match[2]);
  }

  const h3Regex = /^###\s+(.+\?)\s*\n+([\s\S]*?)(?=^###\s+.+\?\s*$|$)/gm;
  while ((match = h3Regex.exec(faqSection)) !== null) {
    addFaqPair(pairs, seen, match[1], match[2]);
  }

  const boldQuestionRegex = /^\s*\*\*(?!Q:)(.+\?)\*\*\s*\n+([\s\S]*?)(?=^\s*\*\*(?!Q:).+\?\*\*\s*$|$)/gm;
  while ((match = boldQuestionRegex.exec(faqSection)) !== null) {
    addFaqPair(pairs, seen, match[1], match[2]);
  }

  const htmlH3Regex = /<h3\b[^>]*>([\s\S]*?\?)<\/h3>\s*([\s\S]*?)(?=<h3\b|<h2\b|<\/article>|$)/gi;
  while ((match = htmlH3Regex.exec(faqSection)) !== null) {
    const paragraphMatches = Array.from(match[2].matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi));
    const answer = paragraphMatches.length > 0
      ? paragraphMatches.map((paragraph) => paragraph[1]).join(" ")
      : match[2];
    addFaqPair(pairs, seen, match[1], answer);
  }

  const htmlDlRegex = /<dt\b[^>]*>([\s\S]*?\?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;
  while ((match = htmlDlRegex.exec(faqSection)) !== null) {
    addFaqPair(pairs, seen, match[1], match[2]);
  }

  const lines = faqSection
    .split(/\n+/)
    .map((line) => stripInlineMarkup(line))
    .filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const question = lines[i];
    if (!/\?$/.test(question)) continue;

    const answerLines: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (/\?$/.test(lines[j])) break;
      answerLines.push(lines[j]);
    }
    addFaqPair(pairs, seen, question, answerLines.join(" "));
  }

  return pairs;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderFaqAccordion(pairs: FaqPair[]): string {
  if (pairs.length === 0) return "";

  const rows = pairs.map((pair, index) => {
    const open = index === 0 ? " open" : "";
    return `<details class="ibolt-faq-row"${open}>
  <summary>
    <span>${escapeHtml(pair.question)}</span>
    <span class="ibolt-faq-toggle" aria-hidden="true"><span class="ibolt-faq-plus">+</span><span class="ibolt-faq-minus">-</span></span>
  </summary>
  <div class="ibolt-faq-answer">
    <p>${escapeHtml(pair.answer)}</p>
  </div>
</details>`;
  }).join("\n");

  return `<style>
.ibolt-faq {
  margin: 36px 0;
  border-top: 1px solid #d9d9d9;
}
.ibolt-faq h2 {
  margin: 0;
  padding: 0 0 14px;
  font-size: 28px;
  line-height: 1.2;
}
.ibolt-faq-row {
  border-bottom: 1px solid #d9d9d9;
}
.ibolt-faq-row summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 26px 0;
  cursor: pointer;
  list-style: none;
  font-size: 24px;
  line-height: 1.25;
  font-weight: 500;
}
.ibolt-faq-row summary::-webkit-details-marker {
  display: none;
}
.ibolt-faq-toggle {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border: 2px solid currentColor;
  border-radius: 999px;
  font-size: 26px;
  line-height: 1;
  font-weight: 400;
}
.ibolt-faq-row[open] .ibolt-faq-plus {
  display: none;
}
.ibolt-faq-row:not([open]) .ibolt-faq-minus {
  display: none;
}
.ibolt-faq-answer {
  max-width: 760px;
  padding: 0 72px 28px 0;
}
.ibolt-faq-answer p {
  margin: 0;
}
@media (max-width: 640px) {
  .ibolt-faq-row summary {
    font-size: 20px;
    padding: 22px 0;
  }
  .ibolt-faq-answer {
    padding-right: 0;
  }
}
</style>
<section class="ibolt-faq" aria-label="Frequently Asked Questions">
  <h2>Frequently Asked Questions</h2>
${rows}
</section>`;
}

function applyFaqAccordion(bodyHtml: string, markdown: string): string {
  const pairs = extractFaqPairsFromMarkdown(markdown);
  if (pairs.length === 0) return bodyHtml;

  const headingMatch = /<h2\b[^>]*>\s*(Frequently Asked Questions|FAQs?|Common Questions)\s*<\/h2>/i.exec(bodyHtml);
  if (!headingMatch || headingMatch.index === undefined) return bodyHtml;

  const start = headingMatch.index;
  const bodyStart = start + headingMatch[0].length;
  const afterHeading = bodyHtml.slice(bodyStart);
  const nextH2 = afterHeading.search(/<h2\b/i);
  const marker = /<!--\s*FAQ END\s*-->/i.exec(afterHeading);
  const end = marker?.index !== undefined
    ? bodyStart + marker.index
    : nextH2 >= 0
      ? bodyStart + nextH2
      : bodyHtml.length;
  const remainderStart = marker ? end + marker[0].length : end;

  return `${bodyHtml.slice(0, start).trimEnd()}\n\n${renderFaqAccordion(pairs)}\n\n${bodyHtml.slice(remainderStart).trimStart()}`;
}

/**
 * Extract FAQ questions and answers from markdown and generate JSON-LD schema.
 */
function extractFaqSchema(markdown: string): string {
  const qaPairs = extractFaqPairsFromMarkdown(markdown);

  if (qaPairs.length === 0) return "";

  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": qaPairs.map((qa) => ({
      "@type": "Question",
      "name": qa.question,
      "acceptedAnswer": {
        "@type": "Answer",
        "text": qa.answer,
      },
    })),
  };

  return `\n<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>`;
}

function articleUrl(post: BlogPost, companyContext?: CompanyContext | null): string {
  const baseUrl = (companyContext?.brandProfile.websiteUrl || "https://iboltmounts.com").replace(/\/$/, "");
  return `${baseUrl}/blogs/news/${post.slug}`;
}

function plainText(value: string | null | undefined): string {
  return (value || "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#*_`>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractH2Headings(markdown: string): string[] {
  const headings: string[] = [];
  const pattern = /^##\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    const heading = plainText(match[1]);
    if (!heading || /frequently asked questions|product options/i.test(heading)) continue;
    headings.push(heading);
  }
  return headings;
}

function firstImageUrl(markdown: string): string | undefined {
  const markdownImage = markdown.match(/!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/);
  if (markdownImage?.[1]) return markdownImage[1];

  const htmlImage = markdown.match(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i);
  return htmlImage?.[1];
}

interface LinkedItem {
  name: string;
  url: string;
  index: number;
}

function extractProductLinks(markdown: string): LinkedItem[] {
  const found: LinkedItem[] = [];
  const markdownLink = /\[([^\]]+)]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const htmlLink = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = markdownLink.exec(markdown)) !== null) {
    const name = plainText(match[1]);
    const url = match[2];
    if (name && /\/products\//i.test(url)) {
      found.push({ name, url, index: match.index });
    }
  }

  while ((match = htmlLink.exec(markdown)) !== null) {
    const name = plainText(match[2]);
    const url = match[1];
    if (name && /\/products\//i.test(url)) {
      found.push({ name, url, index: match.index });
    }
  }

  const seen = new Set<string>();
  return found
    .sort((a, b) => a.index - b.index)
    .filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
}

function buildItemListSchema(post: BlogPost, url: string): Record<string, unknown> | null {
  const markdown = post.markdown || "";
  const listicleIntent = /^(best|top)\b/i.test(post.title || "") || /^(best|top)\b/i.test(post.metaTitle || "");
  if (!listicleIntent) return null;
  const productLinks = extractProductLinks(markdown).slice(0, 20);
  if (productLinks.length === 0) return null;

  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": post.title,
    "itemListElement": productLinks.map((link, index) => ({
      "@type": "ListItem",
      "position": index + 1,
      "name": link.name,
      "url": link.url,
    })),
  };
}

export function buildStructuredDataScripts(post: BlogPost, companyContext?: CompanyContext | null): string {
  const url = articleUrl(post, companyContext);
  const brandName = companyContext?.brandProfile.displayName || companyContext?.company.name || "iBOLT Mounts";
  const brandUrl = (companyContext?.brandProfile.websiteUrl || "https://iboltmounts.com").replace(/\/$/, "");
  const imageUrl = firstImageUrl(post.markdown || "");
  const schemas: Array<Record<string, unknown> | null> = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      "headline": post.title,
      "description": post.metaDescription || plainText(post.markdown).slice(0, 155),
      "mainEntityOfPage": {
        "@type": "WebPage",
        "@id": url,
      },
      "author": {
        "@type": "Organization",
        "name": brandName,
        "url": brandUrl,
      },
      "publisher": {
        "@type": "Organization",
        "name": brandName,
        "url": brandUrl,
      },
      "image": imageUrl,
      "datePublished": post.generatedAt ? new Date(post.generatedAt).toISOString() : undefined,
      "dateModified": post.updatedAt ? new Date(post.updatedAt).toISOString() : undefined,
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        {
          "@type": "ListItem",
          "position": 1,
          "name": "Home",
          "item": brandUrl,
        },
        {
          "@type": "ListItem",
          "position": 2,
          "name": "Blog",
          "item": `${brandUrl}/blogs/news`,
        },
        {
          "@type": "ListItem",
          "position": 3,
          "name": post.title,
          "item": url,
        },
      ],
    },
    buildItemListSchema(post, url),
  ];

  return schemas
    .filter((schema): schema is Record<string, unknown> => Boolean(schema))
    .map((schema) => `\n<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>`)
    .join("");
}

/**
 * Auto-link product mentions in HTML that aren't already wrapped in <a> tags.
 * Searches for known company product titles and wraps them with configured product links.
 */
export async function autoLinkProducts(html: string, options?: RendererOptions): Promise<string> {
  const brandProfile = await resolveRendererBrand(options);
  const allProducts = options?.companyId
    ? await db.select().from(products).where(eq(products.companyId, options.companyId))
    : await db.select().from(products);
  if (allProducts.length === 0) return html;

  const segments = html.split(/(<[^>]+>)/g);

  // Sort by title length descending so longer names match first
  const sorted = allProducts
    .filter((p) => p.title && p.handle)
    .sort((a, b) => (b.title?.length || 0) - (a.title?.length || 0));

  let anchorDepth = 0;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment) continue;

    if (segment.startsWith("<")) {
      if (/^<a\b/i.test(segment)) {
        anchorDepth += 1;
      } else if (/^<\/a>/i.test(segment)) {
        anchorDepth = Math.max(0, anchorDepth - 1);
      }
      continue;
    }

    if (anchorDepth > 0) {
      continue;
    }

    let updated = segment;
    for (const product of sorted) {
      const title = product.title;
      const url = product.url || buildProductUrl(product.handle, brandProfile);
      const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`\\b(${escaped})\\b`, "gi");
      updated = updated.replace(regex, (match) => `<a href="${url}">${match}</a>`);
    }

    segments[i] = updated;
  }

  return segments.join("");
}

/**
 * Generate the full Shopify-ready HTML for a blog post, including
 * SEO meta tags and structured data.
 */
export async function renderShopifyHtml(post: BlogPost, companyContext?: CompanyContext | null): Promise<string> {
  let bodyHtml = markdownToHtml(post.markdown || "");
  bodyHtml = applyFaqAccordion(bodyHtml, post.markdown || "");
  bodyHtml = await autoLinkProducts(bodyHtml, { companyId: post.companyId, companyContext });

  // Convert local photo URLs to signed public URLs so images work on Shopify without exposing the full asset bank.
  bodyHtml = bodyHtml.replace(
    /src="\/api\/(?:blog|public\/blog)\/photos\/(serve|thumb)\/([^"]+)"/g,
    (_match, kind: "serve" | "thumb", rawPhotoRef: string) => `src="${publicPhotoUrl(kind, rawPhotoRef, post.companyId || null)}"`,
  );

  const metaTitle = post.metaTitle || post.title;
  const metaDescription = post.metaDescription || "";

  // Extract FAQ schema from the HTML
  const faqSchema = extractFaqSchema(post.markdown || "");
  const structuredData = buildStructuredDataScripts(post, companyContext);

  // Shopify blog HTML — article body + structured data.
  // Meta tags are set separately in Shopify's blog post editor.
  const shopifyBody = `<!-- SEO Meta (set in Shopify) -->
<!-- Title: ${metaTitle} -->
<!-- Description: ${metaDescription} -->
<!-- Slug: ${post.slug} -->

${bodyHtml}
${structuredData}
${faqSchema}`;

  return shopifyBody;
}

/**
 * Generate a complete standalone HTML page for preview.
 */
export async function renderPreviewHtml(post: BlogPost, companyContext?: CompanyContext | null): Promise<string> {
  let bodyHtml = markdownToHtml(post.markdown || "");
  bodyHtml = applyFaqAccordion(bodyHtml, post.markdown || "");
  bodyHtml = await autoLinkProducts(bodyHtml, { companyId: post.companyId, companyContext });
  const metaTitle = post.metaTitle || post.title;
  const metaDescription = post.metaDescription || "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${metaTitle}</title>
  <meta name="description" content="${metaDescription}">
  <meta property="og:title" content="${metaTitle}">
  <meta property="og:description" content="${metaDescription}">
  <meta property="og:type" content="article">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem;
      line-height: 1.7;
      color: #1a1a1a;
    }
    h1 { font-size: 2rem; margin-bottom: 0.5rem; }
    h2 { font-size: 1.5rem; margin-top: 2rem; color: #2c3e50; }
    h3 { font-size: 1.25rem; margin-top: 1.5rem; }
    p { margin: 1rem 0; }
    a { color: #e8491d; text-decoration: none; }
    a:hover { text-decoration: underline; }
    ul, ol { padding-left: 1.5rem; }
    li { margin: 0.5rem 0; }
    strong { font-weight: 600; }
    .meta { color: #666; font-size: 0.9rem; margin-bottom: 2rem; border-bottom: 1px solid #eee; padding-bottom: 1rem; }
    .scores { background: #f8f9fa; padding: 1rem; border-radius: 8px; margin-top: 2rem; font-size: 0.9rem; }
    .scores h3 { margin-top: 0; }
    .score-bar { display: flex; align-items: center; margin: 0.3rem 0; }
    .score-label { width: 160px; }
    .score-value { font-weight: 600; width: 40px; }
    .score-fill { height: 8px; border-radius: 4px; background: #e8491d; }
  </style>
</head>
<body>
  <article>
    <div class="meta">
      <strong>Meta Title:</strong> ${metaTitle}<br>
      <strong>Meta Description:</strong> ${metaDescription}<br>
      <strong>Slug:</strong> /${post.slug}<br>
      <strong>Word Count:</strong> ${post.wordCount || 0}
    </div>
    ${bodyHtml}
  </article>
  ${post.overallScore ? `
  <div class="scores">
    <h3>Verification Scores</h3>
    <div class="score-bar"><span class="score-label">Brand Consistency</span><span class="score-value">${post.brandConsistency}</span><div style="width:${post.brandConsistency}%;max-width:200px" class="score-fill"></div></div>
    <div class="score-bar"><span class="score-label">SEO Optimization</span><span class="score-value">${post.seoOptimization}</span><div style="width:${post.seoOptimization}%;max-width:200px" class="score-fill"></div></div>
    <div class="score-bar"><span class="score-label">Natural Language</span><span class="score-value">${post.naturalLanguage}</span><div style="width:${post.naturalLanguage}%;max-width:200px" class="score-fill"></div></div>
    <div class="score-bar"><span class="score-label">Factual Accuracy</span><span class="score-value">${post.factualAccuracy}</span><div style="width:${post.factualAccuracy}%;max-width:200px" class="score-fill"></div></div>
    <div class="score-bar"><span class="score-label"><strong>Overall</strong></span><span class="score-value"><strong>${post.overallScore}</strong></span><div style="width:${post.overallScore}%;max-width:200px" class="score-fill"></div></div>
  </div>` : ""}
</body>
</html>`;
}
