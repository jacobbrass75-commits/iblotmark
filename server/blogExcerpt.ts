import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { blogPosts, keywordClusters, keywords, type BlogPost, type Keyword } from "@shared/schema";
import { db } from "./db";
import { anthropicLimiter } from "./apiCache";

const MODEL = "claude-sonnet-4-20250514";
const DEFAULT_EXCERPT_MIN_CHARS = 220;
const DEFAULT_EXCERPT_MAX_CHARS = 420;

export interface ExcerptKeywordTargets {
  primaryKeyword?: string | null;
  secondaryKeywords?: string[];
}

export interface ExcerptInput extends ExcerptKeywordTargets {
  title: string;
  metaTitle?: string | null;
  metaDescription?: string | null;
  markdown?: string | null;
  html?: string | null;
}

function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return apiKey ? new Anthropic({ apiKey }) : null;
}

function stripMarkdown(value: string): string {
  return value
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/<img\b[^>]*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clampExcerpt(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= DEFAULT_EXCERPT_MAX_CHARS) {
    return normalized;
  }

  const clipped = normalized.slice(0, DEFAULT_EXCERPT_MAX_CHARS);
  const lastSentenceBreak = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("; "));
  const lastWordBreak = clipped.lastIndexOf(" ");
  const cutPoint = lastSentenceBreak >= DEFAULT_EXCERPT_MIN_CHARS
    ? lastSentenceBreak + 1
    : lastWordBreak >= DEFAULT_EXCERPT_MIN_CHARS
      ? lastWordBreak
      : DEFAULT_EXCERPT_MAX_CHARS;

  return `${clipped.slice(0, cutPoint).trim().replace(/[,:;]$/, "")}.`;
}

function buildFallbackExcerpt(input: ExcerptInput): string {
  const bodyText = stripMarkdown(input.markdown || input.html || "");
  const sentences = bodyText
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const primaryKeyword = input.primaryKeyword?.trim();
  const supportingKeywords = (input.secondaryKeywords || [])
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .slice(0, 2);

  const selectedSentences: string[] = [];

  if (sentences[0]) {
    selectedSentences.push(sentences[0]);
  }

  const keywordSentence = sentences.find((sentence) => {
    const haystack = sentence.toLowerCase();
    return !!(
      primaryKeyword && haystack.includes(primaryKeyword.toLowerCase())
    ) || supportingKeywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
  });
  if (keywordSentence && !selectedSentences.includes(keywordSentence)) {
    selectedSentences.push(keywordSentence);
  }

  if (sentences[1] && !selectedSentences.includes(sentences[1])) {
    selectedSentences.push(sentences[1]);
  }

  let excerpt = selectedSentences.join(" ");
  if (!excerpt) {
    const keywordPhrase = [primaryKeyword, ...supportingKeywords].filter(Boolean).join(", ");
    excerpt = keywordPhrase
      ? `${input.title} covers ${keywordPhrase} with practical iBOLT product recommendations for real-world mounting needs.`
      : `${input.title} covers practical iBOLT mounting solutions for real-world use cases.`;
  }

  if (primaryKeyword && !excerpt.toLowerCase().includes(primaryKeyword.toLowerCase())) {
    excerpt = `Find the right ${primaryKeyword} for work, travel, and commercial setups. ${excerpt}`;
  }

  return clampExcerpt(excerpt);
}

function extractJson(text: string): string {
  const cleaned = text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  return objectMatch ? objectMatch[0] : cleaned;
}

async function generateExcerptWithAi(input: ExcerptInput): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  const bodyText = stripMarkdown(input.markdown || input.html || "").slice(0, 5000);
  const primaryKeyword = input.primaryKeyword?.trim() || "";
  const secondaryKeywords = (input.secondaryKeywords || []).slice(0, 4);

  await anthropicLimiter.acquire();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 250,
    system: `You write Shopify blog excerpts for iBOLT Mounts.

Return valid JSON only:
{
  "excerpt": "2-3 sentence excerpt"
}

Rules:
- 2-3 sentences, plain text only, no markdown
- Target ${DEFAULT_EXCERPT_MIN_CHARS}-${DEFAULT_EXCERPT_MAX_CHARS} characters
- Naturally include the primary keyword when provided
- Weave in 1-2 supporting keywords only if they fit naturally
- Focus on search intent, practical use cases, and product relevance
- Make it suitable for Shopify summary_html and AI search summaries`,
    messages: [{
      role: "user",
      content: `Title: ${input.title}
Meta title: ${input.metaTitle || ""}
Meta description: ${input.metaDescription || ""}
Primary keyword: ${primaryKeyword}
Secondary keywords: ${secondaryKeywords.join(", ")}

Post content:
${bodyText}`,
    }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const parsed = JSON.parse(extractJson(text)) as { excerpt?: string };
  return parsed.excerpt ? clampExcerpt(parsed.excerpt) : null;
}

export async function resolveExcerptKeywords(post: Pick<BlogPost, "clusterId" | "title">): Promise<ExcerptKeywordTargets> {
  if (!post.clusterId) {
    return { primaryKeyword: post.title, secondaryKeywords: [] };
  }

  const [cluster] = await db
    .select()
    .from(keywordClusters)
    .where(eq(keywordClusters.id, post.clusterId))
    .limit(1);

  const clusterKeywords = await db
    .select()
    .from(keywords)
    .where(eq(keywords.clusterId, post.clusterId));

  const sortedKeywords = clusterKeywords
    .slice()
    .sort((a: Keyword, b: Keyword) => (b.volume || 0) - (a.volume || 0))
    .map((keyword) => keyword.keyword)
    .filter(Boolean);

  const primaryKeyword = cluster?.primaryKeyword || sortedKeywords[0] || post.title;
  const secondaryKeywords = sortedKeywords
    .filter((keyword) => keyword.toLowerCase() !== primaryKeyword.toLowerCase())
    .slice(0, 4);

  return { primaryKeyword, secondaryKeywords };
}

export async function generateExcerpt(input: ExcerptInput): Promise<string> {
  const aiExcerpt = await generateExcerptWithAi(input).catch(() => null);
  if (aiExcerpt) {
    return aiExcerpt;
  }
  return buildFallbackExcerpt(input);
}

export async function generateExcerptForPost(post: BlogPost): Promise<string> {
  const keywords = await resolveExcerptKeywords(post);
  return generateExcerpt({
    title: post.title,
    metaTitle: post.metaTitle,
    metaDescription: post.metaDescription,
    markdown: post.markdown,
    html: post.html,
    primaryKeyword: keywords.primaryKeyword,
    secondaryKeywords: keywords.secondaryKeywords,
  });
}

export async function ensureExcerptForPost(post: BlogPost): Promise<string> {
  if (post.excerpt?.trim()) {
    return post.excerpt.trim();
  }

  const excerpt = await generateExcerptForPost(post);
  await db
    .update(blogPosts)
    .set({
      excerpt,
      updatedAt: new Date(),
    })
    .where(eq(blogPosts.id, post.id));

  return excerpt;
}
