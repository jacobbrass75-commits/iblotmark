import type { BlogPost, Product } from "@shared/schema";

export const BLOG_INLINE_IMAGE_STYLE =
  "width:100%;max-width:800px;height:auto;margin:16px 0;border-radius:4px;";

const PRODUCT_URL_REGEX =
  /https?:\/\/(?:www\.)?iboltmounts\.com\/products\/([a-z0-9][a-z0-9-]*)/gi;
const PRODUCT_HANDLE_REGEX = /\bibolt(?:-[a-z0-9]+){2,}\b/gi;
const MARKDOWN_IMAGE_LINE_REGEX = /^\s*!\[[^\]]*]\([^)]+\)\s*$/i;
const RAW_IMAGE_LINE_REGEX = /^\s*<img\b[^>]*\/?>\s*$/i;
const H2_LINE_REGEX = /^##\s+(.+)$/;
const HTML_H2_SECTION_REGEX =
  /(<h2\b[^>]*>[\s\S]*?<\/h2>)([\s\S]*?)(?=<h2\b[^>]*>[\s\S]*?<\/h2>|$)/gi;
const SKIPPED_SECTION_HEADINGS = /\b(choosing the right|installation best practices|frequently asked questions)\b/i;
const TITLE_STOPWORDS = new Set([
  "ibolt",
  "the",
  "and",
  "for",
  "all",
  "tablet",
  "tablets",
  "mount",
  "mounts",
  "holder",
  "holders",
  "universal",
  "heavy",
  "duty",
  "great",
  "inch",
  "inches",
]);

type MentionableProduct = Pick<Product, "id" | "handle" | "title" | "url" | "imageUrl">;

export interface SectionPhotoMatch {
  heading: string;
  productHandle: string;
  imageUrl: string;
}

export interface MarkdownPhotoInjectionResult {
  markdown: string;
  inserted: number;
  matches: SectionPhotoMatch[];
}

export interface HtmlPhotoInjectionResult {
  html: string;
  inserted: number;
  matches: SectionPhotoMatch[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[™®]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function buildSearchNeedles(product: MentionableProduct): string[] {
  const titleTokens = normalizeTokens(product.title || "").filter((token) => !TITLE_STOPWORDS.has(token));
  const handleTokens = normalizeTokens(product.handle).filter((token) => token !== "ibolt");
  const needles = new Set<string>();

  for (const size of [5, 4, 3]) {
    if (titleTokens.length >= size) {
      needles.add(titleTokens.slice(0, size).join(" "));
    }
    if (handleTokens.length >= size) {
      needles.add(handleTokens.slice(0, size).join(" "));
    }
  }

  return Array.from(needles);
}

function isImmediateImageLine(line: string | undefined): boolean {
  if (!line) return false;
  return MARKDOWN_IMAGE_LINE_REGEX.test(line) || RAW_IMAGE_LINE_REGEX.test(line);
}

export function buildResponsiveImageTag(imageUrl: string, altText: string): string {
  return `<img src="${escapeAttribute(imageUrl)}" alt="${escapeAttribute(altText)}" style="${BLOG_INLINE_IMAGE_STYLE}" />`;
}

function buildTitleCandidates(products: MentionableProduct[]): MentionableProduct[] {
  return products
    .filter((product) => product.imageUrl && product.title)
    .sort((a, b) => (b.title?.length || 0) - (a.title?.length || 0));
}

function updateBestMatch(
  bestMatch: { product: MentionableProduct; index: number } | null,
  candidate: { product: MentionableProduct; index: number }
): { product: MentionableProduct; index: number } {
  if (!bestMatch) return candidate;
  if (candidate.index < bestMatch.index) return candidate;
  if (candidate.index > bestMatch.index) return bestMatch;
  return (candidate.product.title?.length || 0) > (bestMatch.product.title?.length || 0)
    ? candidate
    : bestMatch;
}

export function findFirstMentionedProduct(
  sectionContent: string,
  products: MentionableProduct[]
): MentionableProduct | null {
  const productsWithImages = products.filter((product) => product.imageUrl && product.handle);
  if (productsWithImages.length === 0) return null;

  const byHandle = new Map(
    productsWithImages.map((product) => [product.handle.toLowerCase(), product] as const)
  );

  let bestMatch: { product: MentionableProduct; index: number } | null = null;

  for (const match of Array.from(sectionContent.matchAll(PRODUCT_URL_REGEX))) {
    const handle = match[1]?.toLowerCase();
    const product = handle ? byHandle.get(handle) : null;
    if (product && typeof match.index === "number") {
      bestMatch = updateBestMatch(bestMatch, { product, index: match.index });
    }
  }

  for (const match of Array.from(sectionContent.matchAll(PRODUCT_HANDLE_REGEX))) {
    const handle = match[0]?.toLowerCase();
    const product = handle ? byHandle.get(handle) : null;
    if (product && typeof match.index === "number") {
      bestMatch = updateBestMatch(bestMatch, { product, index: match.index });
    }
  }

  if (bestMatch) {
    return bestMatch.product;
  }

  const lowerContent = sectionContent.toLowerCase();
  for (const product of buildTitleCandidates(productsWithImages)) {
    const title = product.title?.toLowerCase();
    if (!title) continue;
    const index = lowerContent.indexOf(title);
    if (index >= 0) {
      bestMatch = updateBestMatch(bestMatch, { product, index });
    }
  }

  const normalizedContent = normalizeTokens(sectionContent).join(" ");
  for (const product of buildTitleCandidates(productsWithImages)) {
    for (const needle of buildSearchNeedles(product)) {
      const index = normalizedContent.indexOf(needle);
      if (index >= 0) {
        bestMatch = updateBestMatch(bestMatch, { product, index });
        break;
      }
    }
  }

  return bestMatch?.product ?? null;
}

export function injectProductImagesIntoMarkdown(
  markdown: string,
  products: MentionableProduct[]
): MarkdownPhotoInjectionResult {
  const lines = markdown.split(/\r?\n/);
  const matches: SectionPhotoMatch[] = [];
  let inserted = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const headingMatch = lines[index].match(H2_LINE_REGEX);
    if (!headingMatch) continue;

    const heading = normalizeWhitespace(headingMatch[1] || "");
    if (SKIPPED_SECTION_HEADINGS.test(heading)) {
      continue;
    }
    let sectionEnd = lines.length;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (H2_LINE_REGEX.test(lines[cursor])) {
        sectionEnd = cursor;
        break;
      }
    }

    const nextLine = lines[index + 1];
    if (isImmediateImageLine(nextLine)) {
      index = sectionEnd - 1;
      continue;
    }

    const sectionBody = lines.slice(index + 1, sectionEnd).join("\n");
    const product = findFirstMentionedProduct(`${heading}\n${sectionBody}`, products);
    if (!product?.imageUrl) {
      index = sectionEnd - 1;
      continue;
    }

    const imageTag = buildResponsiveImageTag(product.imageUrl, product.title || heading);
    const insertion = nextLine?.trim() === "" ? [imageTag] : [imageTag, ""];
    lines.splice(index + 1, 0, ...insertion);
    inserted += 1;
    matches.push({
      heading,
      productHandle: product.handle,
      imageUrl: product.imageUrl,
    });
    sectionEnd += insertion.length;
    index = sectionEnd - 1;
  }

  return {
    markdown: lines.join("\n"),
    inserted,
    matches,
  };
}

function stripHtmlTags(value: string): string {
  return normalizeWhitespace(
    value
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
  );
}

export function injectProductImagesIntoHtml(
  html: string,
  products: MentionableProduct[]
): HtmlPhotoInjectionResult {
  let inserted = 0;
  const matches: SectionPhotoMatch[] = [];

  const enrichedHtml = html.replace(
    HTML_H2_SECTION_REGEX,
    (fullMatch, headingHtml: string, sectionBody: string) => {
      const trimmedBody = sectionBody.trimStart();
      if (trimmedBody.startsWith("<img")) {
        return fullMatch;
      }

      const heading = stripHtmlTags(headingHtml);
      if (SKIPPED_SECTION_HEADINGS.test(heading)) {
        return fullMatch;
      }
      const sectionText = `${heading}\n${stripHtmlTags(sectionBody)}`;
      const product = findFirstMentionedProduct(sectionText, products);
      if (!product?.imageUrl) {
        return fullMatch;
      }

      inserted += 1;
      matches.push({
        heading,
        productHandle: product.handle,
        imageUrl: product.imageUrl,
      });
      return `${headingHtml}\n${buildResponsiveImageTag(product.imageUrl, product.title || heading)}${sectionBody}`;
    }
  );

  return {
    html: enrichedHtml,
    inserted,
    matches,
  };
}

export function getPhotoEnrichmentSource(
  post: Pick<BlogPost, "markdown" | "html">
): "markdown" | "html" | null {
  if (post.markdown?.trim()) return "markdown";
  if (post.html?.trim()) return "html";
  return null;
}
