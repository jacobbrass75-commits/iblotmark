// HTML Renderer — Markdown to Shopify-ready HTML with SEO meta tags
// Converts blog pipeline markdown output into publishable HTML.

import type { BlogPost, Product } from "@shared/schema";
import { db } from "./db";
import { products } from "@shared/schema";

/**
 * Convert markdown to HTML. Simple but effective renderer that handles
 * the markdown patterns our pipeline outputs (headings, paragraphs,
 * bold, italic, links, lists, images).
 */
export function markdownToHtml(markdown: string): string {
  let html = markdown;

  // Escape HTML entities in content (but not our generated tags)
  // We'll do this per-line to preserve structure
  const lines = html.split("\n");
  const outputLines: string[] = [];
  let inList = false;
  let listType: "ul" | "ol" = "ul";

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Close list if we're no longer in one
    if (inList && !line.match(/^\s*[-*]\s/) && !line.match(/^\s*\d+\.\s/) && line.trim() !== "") {
      outputLines.push(listType === "ul" ? "</ul>" : "</ol>");
      inList = false;
    }

    // Headings
    if (line.match(/^#{1}\s/)) {
      line = `<h1>${escapeAndFormat(line.replace(/^#\s+/, ""))}</h1>`;
    } else if (line.match(/^#{2}\s/)) {
      line = `<h2>${escapeAndFormat(line.replace(/^##\s+/, ""))}</h2>`;
    } else if (line.match(/^#{3}\s/)) {
      line = `<h3>${escapeAndFormat(line.replace(/^###\s+/, ""))}</h3>`;
    } else if (line.match(/^#{4}\s/)) {
      line = `<h4>${escapeAndFormat(line.replace(/^####\s+/, ""))}</h4>`;

    // Unordered list
    } else if (line.match(/^\s*[-*]\s/)) {
      if (!inList) {
        outputLines.push("<ul>");
        inList = true;
        listType = "ul";
      }
      line = `<li>${escapeAndFormat(line.replace(/^\s*[-*]\s+/, ""))}</li>`;

    // Ordered list
    } else if (line.match(/^\s*\d+\.\s/)) {
      if (!inList) {
        outputLines.push("<ol>");
        inList = true;
        listType = "ol";
      }
      line = `<li>${escapeAndFormat(line.replace(/^\s*\d+\.\s+/, ""))}</li>`;

    // Horizontal rule
    } else if (line.match(/^---+$/)) {
      line = "<hr>";

    // Empty line (paragraph break)
    } else if (line.trim() === "") {
      line = "";

    // Regular paragraph
    } else {
      line = `<p>${escapeAndFormat(line)}</p>`;
    }

    outputLines.push(line);
  }

  // Close any open list
  if (inList) {
    outputLines.push(listType === "ul" ? "</ul>" : "</ol>");
  }

  // Clean up: merge adjacent paragraphs that are part of the same block,
  // remove empty lines between list items, etc.
  return outputLines
    .filter((line) => line !== "")
    .join("\n")
    .replace(/<\/p>\n<p>/g, "</p>\n<p>") // Keep paragraph breaks
    .replace(/<\/ul>\n<ul>/g, "\n") // Merge adjacent lists
    .replace(/<\/ol>\n<ol>/g, "\n");
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

  // Links: [text](url)
  result = result.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');

  // Images: ![alt](url)
  result = result.replace(/!\[(.+?)\]\((.+?)\)/g, '<img src="$2" alt="$1" loading="lazy">');

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
      question: match[1].trim() + "?",
      answer: match[2].trim(),
    });
  }

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

/**
 * Auto-link product mentions in HTML that aren't already wrapped in <a> tags.
 * Searches for known product titles and wraps them with links to iboltmounts.com.
 */
export async function autoLinkProducts(html: string): Promise<string> {
  const allProducts = await db.select().from(products);
  if (allProducts.length === 0) return html;

  let result = html;

  // Sort by title length descending so longer names match first
  const sorted = allProducts
    .filter((p) => p.title && p.handle)
    .sort((a, b) => (b.title?.length || 0) - (a.title?.length || 0));

  for (const product of sorted) {
    const title = product.title;
    const url = `https://iboltmounts.com/products/${product.handle}`;

    // Match product title that is NOT already inside an <a> tag
    // Use a regex that checks the title isn't preceded by "> or followed by </a>
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?<!<a[^>]*>)(?<!">)(${escaped})(?!</a>)`, "gi");

    result = result.replace(regex, (match) => {
      // Don't re-link if already inside an anchor
      return `<a href="${url}">${match}</a>`;
    });
  }

  return result;
}

/**
 * Generate the full Shopify-ready HTML for a blog post, including
 * SEO meta tags and structured data.
 */
export async function renderShopifyHtml(post: BlogPost): Promise<string> {
  let bodyHtml = markdownToHtml(post.markdown || "");
  bodyHtml = await autoLinkProducts(bodyHtml);

  const metaTitle = post.metaTitle || post.title;
  const metaDescription = post.metaDescription || "";

  // Extract FAQ schema from the HTML
  const faqSchema = extractFaqSchema(post.markdown || "");

  // Shopify blog HTML — article body + FAQ schema.
  // Meta tags are set separately in Shopify's blog post editor.
  const shopifyBody = `<!-- SEO Meta (set in Shopify) -->
<!-- Title: ${metaTitle} -->
<!-- Description: ${metaDescription} -->
<!-- Slug: ${post.slug} -->

${bodyHtml}
${faqSchema}`;

  return shopifyBody;
}

/**
 * Generate a complete standalone HTML page for preview.
 */
export async function renderPreviewHtml(post: BlogPost): Promise<string> {
  let bodyHtml = markdownToHtml(post.markdown || "");
  bodyHtml = await autoLinkProducts(bodyHtml);
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
