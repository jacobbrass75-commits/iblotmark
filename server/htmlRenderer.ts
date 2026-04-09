// HTML Renderer â€” Markdown to Shopify-ready HTML with SEO meta tags
// Converts blog pipeline markdown output into publishable HTML.

import type { BlogPost } from "@shared/schema";
import { db } from "./db";
import { products } from "@shared/schema";
import { BLOG_INLINE_IMAGE_STYLE } from "./blogPhotoSupport";

/**
 * Convert markdown to HTML. Simple but effective renderer that handles
 * the markdown patterns our pipeline outputs (headings, paragraphs,
 * bold, italic, links, lists, and images).
 */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.split("\n");
  const outputLines: string[] = [];
  let inList = false;
  let listType: "ul" | "ol" = "ul";

  for (const sourceLine of lines) {
    let line = sourceLine;
    const trimmedLine = line.trim();

    if (
      inList &&
      !line.match(/^\s*[-*]\s/) &&
      !line.match(/^\s*\d+\.\s/) &&
      trimmedLine !== ""
    ) {
      outputLines.push(listType === "ul" ? "</ul>" : "</ol>");
      inList = false;
    }

    if (line.match(/^#{1}\s/)) {
      line = `<h1>${escapeAndFormat(line.replace(/^#\s+/, ""))}</h1>`;
    } else if (line.match(/^#{2}\s/)) {
      line = `<h2>${escapeAndFormat(line.replace(/^##\s+/, ""))}</h2>`;
    } else if (line.match(/^#{3}\s/)) {
      line = `<h3>${escapeAndFormat(line.replace(/^###\s+/, ""))}</h3>`;
    } else if (line.match(/^#{4}\s/)) {
      line = `<h4>${escapeAndFormat(line.replace(/^####\s+/, ""))}</h4>`;
    } else if (line.match(/^\s*[-*]\s/)) {
      if (!inList) {
        outputLines.push("<ul>");
        inList = true;
        listType = "ul";
      }
      line = `<li>${escapeAndFormat(line.replace(/^\s*[-*]\s+/, ""))}</li>`;
    } else if (line.match(/^\s*\d+\.\s/)) {
      if (!inList) {
        outputLines.push("<ol>");
        inList = true;
        listType = "ol";
      }
      line = `<li>${escapeAndFormat(line.replace(/^\s*\d+\.\s+/, ""))}</li>`;
    } else if (line.match(/^---+$/)) {
      line = "<hr>";
    } else if (trimmedLine.match(/^<img\b[^>]*\/?>$/i)) {
      line = trimmedLine;
    } else if (trimmedLine === "") {
      line = "";
    } else {
      line = `<p>${escapeAndFormat(line)}</p>`;
    }

    outputLines.push(line);
  }

  if (inList) {
    outputLines.push(listType === "ul" ? "</ul>" : "</ol>");
  }

  return outputLines
    .filter((line) => line !== "")
    .join("\n")
    .replace(/<\/ul>\n<ul>/g, "\n")
    .replace(/<\/ol>\n<ol>/g, "\n");
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Escape HTML entities and apply inline formatting (bold, italic, links, code).
 */
function escapeAndFormat(text: string): string {
  const rawImages: string[] = [];
  const withPlaceholders = text.replace(/<img\b[^>]*\/?>/gi, (match) => {
    const token = `__IBOLT_RAW_IMG_${rawImages.length}__`;
    rawImages.push(match);
    return token;
  });

  let result = withPlaceholders
    .replace(/&(?!amp;|lt;|gt;|quot;)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  result = result.replace(
    /!\[([^\]]*)\]\((.+?)\)/g,
    (_match, altText: string, url: string) =>
      `<img src="${escapeAttribute(url)}" alt="${escapeAttribute(altText)}" style="${BLOG_INLINE_IMAGE_STYLE}" />`
  );
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/__(.+?)__/g, "<strong>$1</strong>");
  result = result.replace(/\*(.+?)\*/g, "<em>$1</em>");
  result = result.replace(/_(.+?)_/g, "<em>$1</em>");
  result = result.replace(/`(.+?)`/g, "<code>$1</code>");
  result = result.replace(
    /\[(.+?)\]\((.+?)\)/g,
    (_match, label: string, url: string) =>
      `<a href="${escapeAttribute(url)}">${label}</a>`
  );
  result = result.replace(/__IBOLT_RAW_IMG_(\d+)__/g, (_match, index: string) => {
    return rawImages[Number(index)] || "";
  });

  return result;
}

/**
 * Extract FAQ questions and answers from markdown and generate JSON-LD schema.
 */
function extractFaqSchema(markdown: string): string {
  const faqSection = markdown.match(/## Frequently Asked Questions[\s\S]*$/i);
  if (!faqSection) return "";

  const qaPairs: Array<{ question: string; answer: string }> = [];
  const qaRegex = /\*\*Q:\s*(.+?)\?\*\*\s*\n+A:\s*(.+?)(?=\n\n\*\*Q:|\n##|$)/gi;
  let match;

  while ((match = qaRegex.exec(faqSection[0])) !== null) {
    qaPairs.push({
      question: `${match[1].trim()}?`,
      answer: match[2].trim(),
    });
  }

  if (qaPairs.length === 0) return "";

  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: qaPairs.map((qa) => ({
      "@type": "Question",
      name: qa.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: qa.answer,
      },
    })),
  };

  return `\n<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>`;
}

/**
 * Auto-link product mentions in HTML that aren't already wrapped in <a> tags.
 * Searches for known product titles and wraps them with links to iboltmounts.com.
 */
export async function autoLinkProducts(html: string): Promise<string> {
  const allProducts = await db.select().from(products);
  if (allProducts.length === 0) return html;

  let result = html;
  const sorted = allProducts
    .filter((product) => product.title && product.handle)
    .sort((a, b) => (b.title?.length || 0) - (a.title?.length || 0));

  for (const product of sorted) {
    const title = product.title;
    const url = `https://iboltmounts.com/products/${product.handle}`;
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?<!<a[^>]*>)(?<!">)(${escaped})(?!</a>)`, "gi");

    result = result.replace(regex, (match) => `<a href="${url}">${match}</a>`);
  }

  return result;
}

export async function renderMarkdownBodyHtml(markdown: string): Promise<string> {
  let bodyHtml = markdownToHtml(markdown);
  bodyHtml = await autoLinkProducts(bodyHtml);
  return bodyHtml;
}

function buildShopifyBody(
  post: Pick<BlogPost, "title" | "metaTitle" | "metaDescription" | "slug" | "markdown">,
  bodyHtml: string
): string {
  const metaTitle = post.metaTitle || post.title;
  const metaDescription = post.metaDescription || "";
  const faqSchema = extractFaqSchema(post.markdown || "");

  return `<!-- SEO Meta (set in Shopify) -->
<!-- Title: ${metaTitle} -->
<!-- Description: ${metaDescription} -->
<!-- Slug: ${post.slug} -->

${bodyHtml}
${faqSchema}`;
}

/**
 * Generate the full Shopify-ready HTML for a blog post, including
 * SEO meta tags and structured data.
 */
export async function renderShopifyHtml(
  post: BlogPost,
  options?: { preferStoredHtml?: boolean }
): Promise<string> {
  if (options?.preferStoredHtml && post.html?.trim()) {
    return post.html;
  }

  if (!post.markdown?.trim() && post.html?.trim()) {
    return post.html;
  }

  const bodyHtml = await renderMarkdownBodyHtml(post.markdown || "");
  return buildShopifyBody(post, bodyHtml);
}

/**
 * Generate a complete standalone HTML page for preview.
 */
export async function renderPreviewHtml(post: BlogPost): Promise<string> {
  const bodyHtml = post.markdown?.trim()
    ? await renderMarkdownBodyHtml(post.markdown)
    : post.html?.trim() || "";
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
    img { max-width: 100%; height: auto; margin: 16px 0; }
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
