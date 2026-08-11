import Database from "better-sqlite3";

const DB_PATH = process.env.DATABASE_PATH || "./data/standalone-blog-writer.db";
process.env.BLOG_SEED_IBOLT_DEMO = "false";

interface BlogPostRow {
  id: string;
  company_id: string;
  title: string;
  slug: string;
  meta_title: string | null;
  meta_description: string | null;
  markdown: string | null;
  html: string | null;
  cluster_id: string | null;
  vertical_id: string | null;
  batch_id: string | null;
  status: string;
  word_count: number | null;
  brand_consistency: number | null;
  seo_optimization: number | null;
  natural_language: number | null;
  factual_accuracy: number | null;
  overall_score: number | null;
  verification_notes: string | null;
  generation_provider: string | null;
  generation_model: string | null;
  shopify_article_id: number | null;
  shopify_blog_id: number | null;
  shopify_synced_at: string | null;
  generated_at: number;
  updated_at: number;
}

function plainText(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*_`>]/g, " ")
    .replace(/^Q:\s*/i, "")
    .replace(/^A:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeQuestion(value: string): string {
  const question = plainText(value).replace(/\s*\?*$/, "");
  return question ? `${question}?` : "";
}

function normalizeAnswer(value: string): string {
  return plainText(value);
}

function extractFaqBounds(markdown: string): { start: number; end: number; heading: string; body: string } | null {
  const headingMatch = markdown.match(/^##\s+(Frequently Asked Questions|FAQs?|Common Questions)\s*$/im);
  if (headingMatch?.index !== undefined) {
    const start = headingMatch.index;
    const bodyStart = start + headingMatch[0].length;
    const tail = markdown.slice(bodyStart);
    const nextH2 = tail.search(/^##\s+/m);
    const end = nextH2 >= 0 ? bodyStart + nextH2 : markdown.length;
    return {
      start,
      end,
      heading: "## Frequently Asked Questions",
      body: markdown.slice(bodyStart, end),
    };
  }

  const htmlHeadingMatch = /<h2\b[^>]*>\s*(Frequently Asked Questions|FAQs?|Common Questions)\s*<\/h2>/i.exec(markdown);
  if (!htmlHeadingMatch || htmlHeadingMatch.index === undefined) return null;

  const start = htmlHeadingMatch.index;
  const bodyStart = start + htmlHeadingMatch[0].length;
  const tail = markdown.slice(bodyStart);
  const nextH2 = tail.search(/<h2\b/i);
  const end = nextH2 >= 0 ? bodyStart + nextH2 : markdown.length;
  return {
    start,
    end,
    heading: "## Frequently Asked Questions",
    body: markdown.slice(bodyStart, end),
  };
}

function addPair(pairs: Array<{ question: string; answer: string }>, seen: Set<string>, question: string, answer: string): void {
  const normalizedQuestion = normalizeQuestion(question);
  const normalizedAnswer = normalizeAnswer(answer);
  if (!normalizedQuestion || !normalizedAnswer) return;

  const key = normalizedQuestion.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  pairs.push({ question: normalizedQuestion, answer: normalizedAnswer });
}

function extractPairs(body: string): Array<{ question: string; answer: string }> {
  const pairs: Array<{ question: string; answer: string }> = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  const qaLabelRegex = /\*\*Q:\s*(.+?)\*\*\s*\n+\s*A:\s*([\s\S]*?)(?=\n\s*\*\*Q:|$)/gi;
  while ((match = qaLabelRegex.exec(body)) !== null) {
    addPair(pairs, seen, match[1], match[2]);
  }

  const h3Regex = /^###\s+(.+\?)\s*\n+([\s\S]*?)(?=^###\s+.+\?\s*$|$)/gm;
  while ((match = h3Regex.exec(body)) !== null) {
    addPair(pairs, seen, match[1], match[2]);
  }

  const boldQuestionRegex = /^\s*\*\*(?!Q:)(.+\?)\*\*\s*\n+([\s\S]*?)(?=^\s*\*\*(?!Q:).+\?\*\*\s*$|$)/gm;
  while ((match = boldQuestionRegex.exec(body)) !== null) {
    addPair(pairs, seen, match[1], match[2]);
  }

  const htmlH3Regex = /<h3\b[^>]*>([\s\S]*?\?)<\/h3>\s*([\s\S]*?)(?=<h3\b|<h2\b|<\/article>|$)/gi;
  while ((match = htmlH3Regex.exec(body)) !== null) {
    const paragraphMatches = Array.from(match[2].matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi));
    const answer = paragraphMatches.length > 0
      ? paragraphMatches.map((paragraph) => paragraph[1]).join(" ")
      : match[2];
    addPair(pairs, seen, match[1], answer);
  }

  const htmlDlRegex = /<dt\b[^>]*>([\s\S]*?\?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;
  while ((match = htmlDlRegex.exec(body)) !== null) {
    addPair(pairs, seen, match[1], match[2]);
  }

  const lines = body
    .split(/\n+/)
    .map((line) => plainText(line))
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    if (!/\?$/.test(lines[i])) continue;

    const answerLines: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (/\?$/.test(lines[j])) break;
      answerLines.push(lines[j]);
    }
    addPair(pairs, seen, lines[i], answerLines.join(" "));
  }

  return pairs;
}

function buildFaqSchema(pairs: Array<{ question: string; answer: string }>): string {
  return `\n<script type="application/ld+json">\n${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: pairs.map((pair) => ({
      "@type": "Question",
      name: pair.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: pair.answer,
      },
    })),
  }, null, 2)}\n</script>`;
}

function addFaqSchemaToExistingHtml(html: string): { html: string; count: number } {
  const bounds = extractFaqBounds(html);
  if (!bounds) return { html, count: 0 };

  const pairs = extractPairs(bounds.body);
  if (pairs.length === 0) return { html, count: 0 };

  return {
    html: `${html.trimEnd()}\n${buildFaqSchema(pairs)}`,
    count: pairs.length,
  };
}

function formatFaqMarkdown(markdown: string): { markdown: string; count: number } {
  const bounds = extractFaqBounds(markdown);
  if (!bounds) return { markdown, count: 0 };

  const pairs = extractPairs(bounds.body);
  if (pairs.length === 0) return { markdown, count: 0 };

  const formattedFaq = [
    bounds.heading,
    "",
    ...pairs.flatMap((pair) => [`### ${pair.question}`, "", pair.answer, ""]),
  ].join("\n").trimEnd();

  return {
    markdown: `${markdown.slice(0, bounds.start).trimEnd()}\n\n${formattedFaq}\n\n${markdown.slice(bounds.end).trimStart()}`.trim(),
    count: pairs.length,
  };
}

function toBlogPost(row: BlogPostRow) {
  return {
    id: row.id,
    companyId: row.company_id,
    title: row.title,
    slug: row.slug,
    metaTitle: row.meta_title,
    metaDescription: row.meta_description,
    markdown: row.markdown,
    html: row.html,
    clusterId: row.cluster_id,
    verticalId: row.vertical_id,
    batchId: row.batch_id,
    status: row.status,
    wordCount: row.word_count,
    brandConsistency: row.brand_consistency,
    seoOptimization: row.seo_optimization,
    naturalLanguage: row.natural_language,
    factualAccuracy: row.factual_accuracy,
    overallScore: row.overall_score,
    verificationNotes: row.verification_notes,
    generationProvider: row.generation_provider,
    generationModel: row.generation_model,
    shopifyArticleId: row.shopify_article_id,
    shopifyBlogId: row.shopify_blog_id,
    shopifySyncedAt: row.shopify_synced_at,
    generatedAt: new Date(row.generated_at),
    updatedAt: new Date(row.updated_at),
  };
}

const sqlite = new Database(DB_PATH);
const { renderShopifyHtml } = await import("../server/htmlRenderer");
const updateAll = process.argv.includes("--all");
const htmlOnly = process.argv.includes("--html-only");

const rows = sqlite
  .prepare(
    `
    SELECT *
    FROM blog_posts
    WHERE (markdown LIKE '%Frequently Asked Questions%' OR markdown LIKE '%FAQ%' OR html LIKE '%Frequently Asked Questions%' OR html LIKE '%FAQ%')
      AND (
        @updateAll = 1
        OR (
          COALESCE(html, '') NOT LIKE '%"@type": "FAQPage"%'
          AND COALESCE(html, '') NOT LIKE '%"@type":"FAQPage"%'
        )
      )
    ORDER BY generated_at DESC
  `,
  )
  .all({ updateAll: updateAll ? 1 : 0 }) as BlogPostRow[];

const update = sqlite.prepare(`
  UPDATE blog_posts
  SET markdown = @markdown,
      html = @html,
      word_count = @wordCount,
      updated_at = @updatedAt
  WHERE id = @id
`);

let updated = 0;
for (const row of rows) {
  const formatted = formatFaqMarkdown(row.markdown || "");
  const existingHtmlWithSchema = addFaqSchemaToExistingHtml(row.html || "");
  if ((htmlOnly || formatted.count === 0) && existingHtmlWithSchema.count === 0) {
    console.warn(`Skipped ${row.id}: no FAQ pairs found`);
    continue;
  }

  if (htmlOnly || formatted.count === 0) {
    update.run({
      id: row.id,
      markdown: row.markdown || "",
      html: existingHtmlWithSchema.html,
      wordCount: row.word_count || 0,
      updatedAt: Date.now(),
    });
    updated += 1;
    console.log(`Updated ${row.slug} (${existingHtmlWithSchema.count} FAQ pairs from existing HTML)`);
    continue;
  }

  const updatedAt = Date.now();
  const post = {
    ...toBlogPost(row),
    markdown: formatted.markdown,
    wordCount: formatted.markdown.split(/\s+/).filter(Boolean).length,
    updatedAt: new Date(updatedAt),
  };
  const html = await renderShopifyHtml(post);
  if (!html.includes('"@type": "FAQPage"')) {
    console.warn(`Skipped ${row.id}: rendered HTML did not include FAQPage`);
    continue;
  }

  update.run({
    id: row.id,
    markdown: formatted.markdown,
    html,
    wordCount: post.wordCount,
    updatedAt,
  });
  updated += 1;
  console.log(`Updated ${row.slug} (${formatted.count} FAQ pairs)`);
}

const targetDescription = updateAll
  ? "FAQ posts scanned"
  : htmlOnly
    ? "posts with FAQ content missing FAQPage schema using existing HTML"
    : "posts with FAQ content missing FAQPage schema";
console.log(`Formatted ${updated} of ${rows.length} ${targetDescription}.`);
