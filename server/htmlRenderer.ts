// HTML Renderer — Markdown to Shopify-ready HTML with SEO meta tags
// Converts blog pipeline markdown output into publishable HTML.

import type { BlogPost } from "@shared/schema";

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
 * Generate the full Shopify-ready HTML for a blog post, including
 * SEO meta tags and structured data.
 */
export function renderShopifyHtml(post: BlogPost): string {
  const bodyHtml = markdownToHtml(post.markdown || "");

  const metaTitle = post.metaTitle || post.title;
  const metaDescription = post.metaDescription || "";

  // Shopify blog HTML — just the article body.
  // Meta tags are set separately in Shopify's blog post editor.
  const shopifyBody = `<!-- SEO Meta (set in Shopify) -->
<!-- Title: ${metaTitle} -->
<!-- Description: ${metaDescription} -->
<!-- Slug: ${post.slug} -->

${bodyHtml}`;

  return shopifyBody;
}

/**
 * Generate a complete standalone HTML page for preview.
 */
export function renderPreviewHtml(post: BlogPost): string {
  const bodyHtml = markdownToHtml(post.markdown || "");
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
