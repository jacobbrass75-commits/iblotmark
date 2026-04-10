// Competitor Blog Scraper — Fetch, analyze, filter, and queue competitor posts
// Scrapes RAM Mount and Arkon blogs, filters for iBolt-relevant topics,
// creates keyword clusters, and queues blog generation.

import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { eq } from "drizzle-orm";
import {
  keywordClusters,
  keywords,
  industryVerticals,
  products,
} from "@shared/schema";
import { writingQueue } from "./writingQueue";

function getClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

export interface CompetitorPost {
  url: string;
  title: string;
  content: string;
  isRelevant: boolean;
  relevanceReason: string;
  suggestedTitle: string;
  suggestedKeywords: string[];
  suggestedVertical: string;
  matchingProducts: string[];
}

/**
 * Fetch a competitor blog post and extract its content.
 */
async function fetchBlogContent(url: string): Promise<{ title: string; content: string }> {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; iBoltResearchBot/1.0)" },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);

  const html = await response.text();

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const title = h1Match?.[1] || titleMatch?.[1] || url.split("/").pop()?.replace(/-/g, " ") || "Unknown";

  // Extract body text (strip HTML)
  const bodyMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
    || html.match(/<div[^>]*class="[^"]*article[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    || html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);

  const bodyHtml = bodyMatch?.[1] || html;
  const text = bodyHtml
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

  return { title: title.trim(), content: text.slice(0, 8000) };
}

/**
 * Analyze a competitor post for iBolt relevance.
 */
async function analyzeCompetitorPost(
  title: string,
  content: string,
  url: string,
  productTitles: string[],
  verticalNames: string[],
): Promise<CompetitorPost> {
  const client = getClient();

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    messages: [{
      role: "user",
      content: `Analyze this competitor blog post for iBolt Mounts (device mounting solutions company).

Competitor URL: ${url}
Title: ${title}
Content excerpt: ${content.slice(0, 4000)}

iBolt's product categories include: ${productTitles.slice(0, 30).join(", ")}
iBolt's industry verticals: ${verticalNames.join(", ")}

Determine:
1. Is this topic relevant to iBolt's product offerings? (phone mounts, tablet mounts, device holders, AMPS mounts, etc.)
2. If yes, what iBolt-specific angle should we take to outrank this post?
3. What keywords should we target?

Return JSON:
{
  "isRelevant": true/false,
  "relevanceReason": "why this is or isn't relevant to iBolt",
  "suggestedTitle": "iBolt-specific blog post title that would outrank this",
  "suggestedKeywords": ["keyword1", "keyword2", ...],
  "suggestedVertical": "best-matching-vertical-slug",
  "matchingProducts": ["product types from iBolt that compete here"]
}`,
    }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Failed to parse analysis");

  const analysis = JSON.parse(jsonMatch[0]);

  return {
    url,
    title,
    content: content.slice(0, 500),
    ...analysis,
  };
}

/**
 * Process a batch of competitor URLs: fetch, analyze, filter, create clusters, queue generation.
 */
export async function processCompetitorUrls(
  urls: string[],
  onProgress?: (msg: string) => void,
): Promise<{
  total: number;
  relevant: number;
  queued: number;
  skipped: number;
  results: CompetitorPost[];
}> {
  const log = onProgress || ((msg: string) => console.log(`[Competitor] ${msg}`));

  // Load reference data
  const allProducts = await db.select().from(products);
  const productTitles = allProducts.map((p) => p.title);
  const verticals = await db.select().from(industryVerticals);
  const verticalNames = verticals.map((v) => `${v.name} (${v.slug})`);

  const results: CompetitorPost[] = [];
  let relevant = 0;
  let queued = 0;
  let skipped = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i].trim();
    if (!url) continue;

    log(`Processing ${i + 1}/${urls.length}: ${url}`);

    try {
      // Fetch content
      const { title, content } = await fetchBlogContent(url);
      log(`  Fetched: "${title}" (${content.length} chars)`);

      // Analyze relevance
      const analysis = await analyzeCompetitorPost(title, content, url, productTitles, verticalNames);
      results.push(analysis);

      if (!analysis.isRelevant) {
        log(`  Skipped: ${analysis.relevanceReason}`);
        skipped++;
        continue;
      }

      relevant++;
      log(`  Relevant: ${analysis.suggestedTitle}`);

      // Create keyword cluster for this post
      const vertical = verticals.find((v) => v.slug === analysis.suggestedVertical);

      const [cluster] = await db.insert(keywordClusters).values({
        name: analysis.suggestedTitle,
        primaryKeyword: analysis.suggestedKeywords[0] || analysis.suggestedTitle,
        verticalId: vertical?.id || null,
        totalVolume: 0,
        avgDifficulty: 0,
        priority: 100, // High priority for competitor outranking
        status: "pending",
      }).returning();

      // Add keywords
      for (const kw of analysis.suggestedKeywords) {
        await db.insert(keywords).values({
          keyword: kw,
          volume: 0,
          difficulty: 0,
          status: "clustered",
          clusterId: cluster.id,
        });
      }

      // Queue for generation
      writingQueue.addJob(cluster.id, `Outrank: ${analysis.suggestedTitle}`);
      queued++;
      log(`  Queued for generation: "${analysis.suggestedTitle}"`);
    } catch (err: any) {
      log(`  Error: ${err.message}`);
      results.push({
        url,
        title: "Error",
        content: "",
        isRelevant: false,
        relevanceReason: `Error: ${err.message}`,
        suggestedTitle: "",
        suggestedKeywords: [],
        suggestedVertical: "",
        matchingProducts: [],
      });
      skipped++;
    }
  }

  log(`Done: ${relevant} relevant, ${queued} queued, ${skipped} skipped out of ${urls.length}`);

  return { total: urls.length, relevant, queued, skipped, results };
}

/**
 * Get competitor blog URLs from known sitemaps.
 */
export async function fetchCompetitorSitemap(domain: string): Promise<string[]> {
  const sitemapUrls = [
    `https://${domain}/sitemap_blogs_1.xml`,
    `https://${domain}/sitemap.xml`,
  ];

  for (const sitemapUrl of sitemapUrls) {
    try {
      const response = await fetch(sitemapUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; iBoltResearchBot/1.0)" },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) continue;

      const xml = await response.text();
      const urls = Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g))
        .map((m) => m[1])
        .filter((url) => url.includes("/blogs/"));

      if (urls.length > 0) return urls;
    } catch {
      continue;
    }
  }

  return [];
}
