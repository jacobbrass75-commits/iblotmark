import { BRAND_VOICE } from "./brandVoice";

export interface LintIssue {
  rule: string;
  severity: "error" | "warning";
  message: string;
  excerpt?: string;
}

export interface LintReport {
  errors: LintIssue[];
  warnings: LintIssue[];
  passed: boolean;
}

export interface LintContentInput {
  markdown: string;
  title?: string;
  metaTitle?: string;
  metaDescription?: string;
  primaryKeyword?: string;
  products: Array<{ title: string; handle: string; price: number | null }>;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value: string | null | undefined): string {
  return (value || "").trim();
}

function includesKeyword(value: string | null | undefined, keyword: string): boolean {
  return normalizeText(value).toLowerCase().includes(keyword.toLowerCase());
}

function wordCount(markdown: string): number {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*_>|-]/g, " ");
  return (text.match(/\b[A-Za-z0-9][A-Za-z0-9'-]*\b/g) || []).length;
}

function stripIgnoredBrandCasingAreas(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/[^\s)]+/gi, " ")
    .replace(/\biboltmounts\.com[^\s)]*/gi, " ")
    .replace(/\[[^\]]+\]\(([^)]+)\)/g, " ");
}

function extractProductHandles(markdown: string): string[] {
  const handles: string[] = [];
  const pattern = /https?:\/\/(?:www\.)?iboltmounts\.com\/products\/([a-z0-9][a-z0-9-]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    handles.push(match[1]);
  }
  return handles;
}

function priceToCents(value: number): number {
  return Math.round(value * 100);
}

function findPriceMismatches(markdown: string, products: LintContentInput["products"]): LintIssue[] {
  const issues: LintIssue[] = [];
  const lowerMarkdown = markdown.toLowerCase();

  for (const product of products) {
    if (product.price === null || product.price === undefined || !product.title) continue;
    const expected = priceToCents(Number(product.price));
    const title = product.title.toLowerCase();
    let index = lowerMarkdown.indexOf(title);
    while (index >= 0) {
      const start = Math.max(0, index - 120);
      const end = Math.min(markdown.length, index + product.title.length + 120);
      const window = markdown.slice(start, end);
      const pricePattern = /\$([0-9]+(?:\.[0-9]{1,2})?)/g;
      let match: RegExpExecArray | null;
      while ((match = pricePattern.exec(window)) !== null) {
        const actual = priceToCents(Number(match[1]));
        if (Number.isFinite(actual) && actual !== expected) {
          issues.push({
            rule: "price-mismatch",
            severity: "warning",
            message: `Price near "${product.title}" is $${match[1]}, but catalog price is $${Number(product.price).toFixed(2)}.`,
            excerpt: window.trim().slice(0, 180),
          });
        }
      }
      index = lowerMarkdown.indexOf(title, index + title.length);
    }
  }

  return issues;
}

function findMissingAltIssues(markdown: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const imageTags = markdown.match(/<img\b[^>]*>/gi) || [];
  for (const tag of imageTags) {
    const alt = tag.match(/\balt\s*=\s*(["'])(.*?)\1/i);
    if (!alt || alt[2].trim().length === 0) {
      issues.push({
        rule: "missing-alt",
        severity: "error",
        message: "Image tags must include non-empty alt text.",
        excerpt: tag,
      });
    }
  }
  return issues;
}

function findFaqQuestionCount(markdown: string): number {
  const faqMatch = markdown.match(/^##\s+Frequently Asked Questions\s*$/im);
  if (!faqMatch || faqMatch.index === undefined) return 0;
  const faqBody = markdown.slice(faqMatch.index);
  const nextSection = faqBody.slice(faqMatch[0].length).search(/^##\s+/m);
  const boundedFaq = nextSection >= 0
    ? faqBody.slice(0, faqMatch[0].length + nextSection)
    : faqBody;
  return (boundedFaq.match(/\*\*Q:/g) || []).length;
}

export function lintContent(input: LintContentInput): LintReport {
  const markdown = input.markdown || "";
  const errors: LintIssue[] = [];
  const warnings: LintIssue[] = [];
  const add = (issue: LintIssue) => {
    if (issue.severity === "error") errors.push(issue);
    else warnings.push(issue);
  };

  for (const phrase of BRAND_VOICE.bannedPhrases) {
    const pattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(phrase)}(?![A-Za-z0-9])`, "i");
    const match = markdown.match(pattern);
    if (match) {
      add({
        rule: "banned-phrase",
        severity: "error",
        message: `Banned phrase found: "${phrase}".`,
        excerpt: match[0],
      });
    }
  }

  const dashMatch = markdown.match(/[—–]/);
  if (dashMatch) {
    add({
      rule: "dash",
      severity: "error",
      message: "Use hyphens or commas instead of em dashes or en dashes.",
      excerpt: dashMatch[0],
    });
  }

  const count = wordCount(markdown);
  const minWords = Math.floor(BRAND_VOICE.targetWordCount.min * 0.9);
  const maxWords = Math.ceil(BRAND_VOICE.targetWordCount.max * 1.1);
  if (count < minWords || count > maxWords) {
    add({
      rule: "word-count",
      severity: "error",
      message: `Word count ${count} is outside the allowed ${minWords}-${maxWords} range.`,
    });
  }

  const metaTitle = normalizeText(input.metaTitle);
  if (!metaTitle || metaTitle.length > 60) {
    add({
      rule: "meta-title-length",
      severity: "error",
      message: "Meta title is required and must be 60 characters or fewer.",
      excerpt: metaTitle,
    });
  }

  const metaDescription = normalizeText(input.metaDescription);
  if (!metaDescription || metaDescription.length > 155) {
    add({
      rule: "meta-description-length",
      severity: "error",
      message: "Meta description is required and must be 155 characters or fewer.",
      excerpt: metaDescription,
    });
  }

  const primaryKeyword = normalizeText(input.primaryKeyword);
  if (primaryKeyword) {
    if (!includesKeyword(input.title, primaryKeyword)) {
      add({
        rule: "keyword-in-title",
        severity: "error",
        message: `Primary keyword "${primaryKeyword}" must appear in the title.`,
        excerpt: input.title,
      });
    }
    if (!includesKeyword(input.metaTitle, primaryKeyword) || !includesKeyword(input.metaDescription, primaryKeyword)) {
      add({
        rule: "keyword-in-meta",
        severity: "warning",
        message: `Primary keyword "${primaryKeyword}" should appear in both meta title and meta description.`,
      });
    }
  }

  const h1Match = markdown.match(/^#\s+.+$/m);
  if (h1Match) {
    add({
      rule: "h1-in-body",
      severity: "error",
      message: "Body markdown must not contain an H1; Shopify renders the article title as H1.",
      excerpt: h1Match[0],
    });
  }

  const h2Count = (markdown.match(/^##\s+.+$/gm) || []).length;
  if (h2Count < 3) {
    add({
      rule: "min-sections",
      severity: "warning",
      message: "Use at least three H2 sections.",
    });
  }

  const knownHandles = new Set(input.products.map((product) => product.handle).filter(Boolean));
  for (const handle of extractProductHandles(markdown)) {
    if (!knownHandles.has(handle)) {
      add({
        rule: "dead-product-link",
        severity: "error",
        message: `Product link points to unknown handle "${handle}".`,
        excerpt: handle,
      });
    }
  }

  for (const issue of findPriceMismatches(markdown, input.products)) {
    add(issue);
  }

  for (const issue of findMissingAltIssues(markdown)) {
    add(issue);
  }

  const faqQuestionCount = findFaqQuestionCount(markdown);
  if (faqQuestionCount < 3) {
    add({
      rule: "faq-section",
      severity: "warning",
      message: "Add a Frequently Asked Questions section with at least three **Q: entries.",
    });
  }

  const casingText = stripIgnoredBrandCasingAreas(markdown);
  const badCasing = casingText.match(/(?<![A-Za-z0-9])(?:ibolt|Ibolt|IBOLT)(?![A-Za-z0-9])/);
  if (badCasing) {
    add({
      rule: "brand-casing",
      severity: "error",
      message: "Use the correct brand casing: iBOLT.",
      excerpt: badCasing[0],
    });
  }

  return {
    errors,
    warnings,
    passed: errors.length === 0,
  };
}
