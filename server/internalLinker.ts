import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { blogPosts, keywordClusters, keywords, type BlogPost } from "@shared/schema";

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "your", "you", "are", "how", "what",
  "best", "guide", "mount", "mounts", "mounting", "solution", "solutions", "a", "an", "to", "of", "in",
]);

const DEFAULT_BLOG_HANDLES: Record<string, string> = {
  "104843772196": "news",
  "110121517348": "fish-finder-mounts",
};

type Candidate = {
  post: BlogPost;
  primaryKeyword: string;
  score: number;
  url: string;
};

export interface LinkValidationResult {
  valid: boolean;
  added: number;
  reason?: string;
}

function parseBlogHandles(): Record<string, string> {
  const raw = process.env.SHOPIFY_BLOG_HANDLES;
  if (!raw) return DEFAULT_BLOG_HANDLES;
  try {
    return { ...DEFAULT_BLOG_HANDLES, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_BLOG_HANDLES;
  }
}

function blogHandleFor(post: BlogPost): string {
  if (!post.shopifyBlogId) return "news";
  return parseBlogHandles()[String(post.shopifyBlogId)] || "news";
}

function postUrl(post: BlogPost): string {
  return `https://iboltmounts.com/blogs/${blogHandleFor(post)}/${post.slug}`;
}

function tokens(value: string | null | undefined): Set<string> {
  return new Set((value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOPWORDS.has(token)));
}

function normalizeWithoutLinks(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function linkUrls(markdown: string): string[] {
  const urls: string[] = [];
  const pattern = /\[[^\]]+\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

function countByUrl(urls: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const url of urls) {
    counts.set(url, (counts.get(url) || 0) + 1);
  }
  return counts;
}

export function validateInternalLinkInsertion(
  originalMarkdown: string,
  revisedMarkdown: string,
  allowedUrls: string[],
): LinkValidationResult {
  if (normalizeWithoutLinks(originalMarkdown) !== normalizeWithoutLinks(revisedMarkdown)) {
    return { valid: false, added: 0, reason: "Revised markdown changed non-link text." };
  }

  const allowed = new Set(allowedUrls);
  const originalCounts = countByUrl(linkUrls(originalMarkdown));
  const revisedCounts = countByUrl(linkUrls(revisedMarkdown));
  let added = 0;

  for (const [url, count] of Array.from(revisedCounts.entries())) {
    const inserted = count - (originalCounts.get(url) || 0);
    if (inserted <= 0) continue;
    if (!allowed.has(url)) {
      return { valid: false, added: 0, reason: `Inserted URL is not an allowed candidate: ${url}` };
    }
    added += inserted;
  }

  return { valid: true, added };
}

async function generateText(systemPrompt: string, userPrompt: string): Promise<string> {
  if (process.env.ANTHROPIC_API_KEY) {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: process.env.BLOG_ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
      max_tokens: 8192,
      temperature: 0.1,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    return response.content
      .filter((item): item is Anthropic.TextBlock => item.type === "text")
      .map((item) => item.text)
      .join("\n")
      .trim();
  }

  if (process.env.OPENAI_API_KEY) {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.chat.completions.create({
      model: process.env.BLOG_OPENAI_MODEL || "gpt-4.1-mini",
      temperature: 0.1,
      max_tokens: 8192,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    return response.choices[0]?.message?.content?.trim() || "";
  }

  return "";
}

export async function addInternalLinks(postId: string): Promise<{ added: number; markdown: string }> {
  const [post] = await db.select().from(blogPosts).where(eq(blogPosts.id, postId)).limit(1);
  if (!post || !post.markdown) return { added: 0, markdown: post?.markdown || "" };

  const allPosts = await db.select().from(blogPosts).where(eq(blogPosts.companyId, post.companyId));
  const candidates = allPosts.filter((candidate) =>
    candidate.id !== post.id && ["review", "approved", "published"].includes(candidate.status)
  );
  if (candidates.length === 0) return { added: 0, markdown: post.markdown };

  const clusters = await db.select().from(keywordClusters).where(eq(keywordClusters.companyId, post.companyId));
  const keywordRows = await db.select().from(keywords).where(eq(keywords.companyId, post.companyId));
  const clusterById = new Map(clusters.map((cluster) => [cluster.id, cluster]));
  const keywordsByCluster = new Map<string, string[]>();
  for (const keyword of keywordRows) {
    if (!keyword.clusterId) continue;
    const list = keywordsByCluster.get(keyword.clusterId) || [];
    list.push(keyword.keyword);
    keywordsByCluster.set(keyword.clusterId, list);
  }

  const sourceCluster = post.clusterId ? clusterById.get(post.clusterId) : null;
  const sourceKeywords = new Set(post.clusterId ? keywordsByCluster.get(post.clusterId) || [] : []);
  const sourcePrimaryTokens = tokens(sourceCluster?.primaryKeyword || post.title);

  const scored: Candidate[] = candidates.map((candidate) => {
    const candidateCluster = candidate.clusterId ? clusterById.get(candidate.clusterId) : null;
    const candidateKeywords = candidate.clusterId ? keywordsByCluster.get(candidate.clusterId) || [] : [];
    let score = 0;
    if (post.verticalId && candidate.verticalId && post.verticalId === candidate.verticalId) score += 3;
    for (const keyword of candidateKeywords) {
      if (sourceKeywords.has(keyword)) score += 1;
    }
    const candidateTitleTokens = tokens(candidate.title);
    for (const token of Array.from(sourcePrimaryTokens)) {
      if (candidateTitleTokens.has(token)) score += 1;
    }
    return {
      post: candidate,
      primaryKeyword: candidateCluster?.primaryKeyword || candidate.title,
      score,
      url: postUrl(candidate),
    };
  }).filter((candidate) => candidate.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (scored.length === 0) return { added: 0, markdown: post.markdown };

  const candidateBlock = scored.map((candidate) => {
    const preview = (candidate.post.markdown || candidate.post.metaDescription || "").replace(/\s+/g, " ").slice(0, 150);
    return `- ${candidate.post.title}\n  URL: ${candidate.url}\n  Primary keyword: ${candidate.primaryKeyword}\n  Preview: ${preview}`;
  }).join("\n\n");

  const revised = await generateText(
    "You add contextual internal links to iBOLT blog markdown without changing any prose.",
    `Insert 2-4 contextual internal links to these related articles at natural anchor phrases. Do not add new sentences solely for linking unless necessary; never change any other text; return the complete markdown.\n\nCandidates:\n${candidateBlock}\n\nPost markdown:\n${post.markdown}`,
  );

  if (!revised) return { added: 0, markdown: post.markdown };

  const validation = validateInternalLinkInsertion(post.markdown, revised, scored.map((candidate) => candidate.url));
  if (!validation.valid || validation.added === 0) {
    return { added: 0, markdown: post.markdown };
  }

  await db
    .update(blogPosts)
    .set({ markdown: revised, updatedAt: new Date() })
    .where(and(eq(blogPosts.companyId, post.companyId), eq(blogPosts.id, post.id)));

  return { added: validation.added, markdown: revised };
}
