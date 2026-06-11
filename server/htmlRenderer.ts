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
