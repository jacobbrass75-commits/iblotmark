// iBolt Research Agent Orchestrator
// Ruflo-inspired parallel agent system that populates context banks
// from Reddit, YouTube transcripts, and web sources.
//
// Each "agent" is a concurrent research task that:
// 1. Fetches raw content from a source (Reddit JSON, YouTube, web)
// 2. Sends it to Claude for context extraction
// 3. Stores extracted entries in the context_entries table

import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { eq } from "drizzle-orm";
import {
  contextEntries,
  researchJobs,
  industryVerticals,
  type InsertContextEntry,
  type IndustryVertical,
  type ResearchJob,
} from "@shared/schema";

function getAnthropicClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// --- Types ---

export interface AgentTask {
  verticalId: string;
  verticalName: string;
  verticalSlug: string;
  sourceType: "reddit" | "youtube" | "web";
  query: string;
}

export interface AgentResult {
  jobId: string;
  sourceType: string;
  query: string;
  entriesFound: number;
  status: "completed" | "failed";
  error?: string;
}

export interface OrchestratorProgress {
  totalAgents: number;
  completed: number;
  failed: number;
  inProgress: number;
  results: AgentResult[];
}

// --- Reddit Agent ---

const REDDIT_SUBREDDITS: Record<string, string[]> = {
  "fishing-boating": ["fishing", "kayakfishing", "boating", "bassfishing", "Fishfinder"],
  "forklifts-warehousing": ["warehouse", "forklift", "logistics", "supplychain"],
  "trucking-fleet": ["Truckers", "trucking", "FreightBrokers", "Trucking"],
  "offroading-jeep": ["Jeep", "4x4", "overlanding", "Wrangler", "offroad"],
  "restaurants-food-delivery": ["KitchenConfidential", "doordash_drivers", "UberEATS", "restaurateur"],
  "education-schools": ["Teachers", "edtech", "k12sysadmin", "education"],
  "content-creation-streaming": ["Twitch", "NewTubers", "videography", "streaming"],
  "agriculture-farming": ["farming", "agriculture", "tractors", "homestead"],
  "kitchen-home": ["Cooking", "HomeImprovement", "homeautomation", "SmartHome"],
  "road-trips-travel": ["roadtrip", "CarHacks", "uberdrivers", "GoRVing"],
  "mountain-biking-cycling": ["MTB", "cycling", "ebikes", "bikepacking"],
  "general-mounting": ["gadgets", "DIY", "CarAV", "techsupport"],
};

async function fetchReddit(subreddit: string, query: string): Promise<string[]> {
  const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&restrict_sr=1&sort=relevance&t=year&limit=25`;

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "iBoltResearchBot/1.0" },
    });

    if (!response.ok) {
      console.log(`[Reddit] ${subreddit} returned ${response.status}`);
      return [];
    }

    const data = await response.json() as any;
    const posts: string[] = [];

    for (const child of data?.data?.children || []) {
      const post = child?.data;
      if (!post) continue;

      let text = `Title: ${post.title}`;
      if (post.selftext) {
        text += `\nBody: ${post.selftext.slice(0, 1500)}`;
      }
      // Include top comments if available
      if (post.num_comments > 0) {
        text += `\n(${post.num_comments} comments, score: ${post.score})`;
      }
      posts.push(text);
    }

    return posts;
  } catch (err) {
    console.error(`[Reddit] Error fetching r/${subreddit}:`, err);
    return [];
  }
}

async function runRedditAgent(task: AgentTask): Promise<InsertContextEntry[]> {
  const subreddits = REDDIT_SUBREDDITS[task.verticalSlug] || ["gadgets", "DIY"];
  const allPosts: string[] = [];

  // Fetch from multiple subreddits in parallel
  const searchQueries = [
    task.query,
    `${task.query} mount`,
    `${task.query} holder`,
    `phone tablet mount ${task.verticalName.toLowerCase()}`,
  ];

  const fetches = subreddits.flatMap((sub) =>
    searchQueries.slice(0, 2).map((q) => fetchReddit(sub, q))
  );

  const results = await Promise.allSettled(fetches);
  for (const result of results) {
    if (result.status === "fulfilled") {
      allPosts.push(...result.value);
    }
  }

  if (allPosts.length === 0) return [];

  // Send to Claude for extraction
  return extractContextFromContent(
    task,
    "reddit",
    allPosts.slice(0, 30).join("\n\n---\n\n"),
  );
}

// --- YouTube Agent ---

async function fetchYouTubeSearch(query: string): Promise<Array<{ title: string; videoId: string; description: string }>> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.log("[YouTube] No YOUTUBE_API_KEY set, skipping YouTube research");
    return [];
  }

  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&maxResults=10&key=${apiKey}`;

  try {
    const response = await fetch(url);
    if (!response.ok) return [];
    const data = await response.json() as any;

    return (data.items || []).map((item: any) => ({
      title: item.snippet.title,
      videoId: item.id.videoId,
      description: item.snippet.description,
    }));
  } catch (err) {
    console.error("[YouTube] Search error:", err);
    return [];
  }
}

async function fetchYouTubeTranscript(videoId: string): Promise<string> {
  // Use the youtube-transcript package if available, otherwise fall back to description
  try {
    const { YoutubeTranscript } = await import("youtube-transcript");
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
    return transcript.map((t: any) => t.text).join(" ");
  } catch {
    // Package not available or transcript not accessible
    return "";
  }
}

async function runYouTubeAgent(task: AgentTask): Promise<InsertContextEntry[]> {
  const searchQueries = [
    `${task.verticalName} mount phone tablet`,
    `best ${task.query} mount setup`,
    `${task.verticalName.toLowerCase()} device mounting review`,
  ];

  const allContent: string[] = [];

  for (const query of searchQueries) {
    const videos = await fetchYouTubeSearch(query);

    // Fetch transcripts in parallel (up to 5)
    const transcriptPromises = videos.slice(0, 5).map(async (video) => {
      const transcript = await fetchYouTubeTranscript(video.videoId);
      if (transcript) {
        return `Video: "${video.title}"\nTranscript: ${transcript.slice(0, 3000)}`;
      }
      return `Video: "${video.title}"\nDescription: ${video.description}`;
    });

    const transcripts = await Promise.allSettled(transcriptPromises);
    for (const result of transcripts) {
      if (result.status === "fulfilled") {
        allContent.push(result.value);
      }
    }
  }

  if (allContent.length === 0) return [];

  return extractContextFromContent(
    task,
    "youtube",
    allContent.slice(0, 15).join("\n\n---\n\n"),
  );
}

// --- Web Agent ---

async function fetchWebPage(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; iBoltResearchBot/1.0)" },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return "";

    const html = await response.text();
    // Strip HTML tags for a rough text extraction
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return text.slice(0, 5000);
  } catch {
    return "";
  }
}

const WEB_SOURCES: Record<string, string[]> = {
  "fishing-boating": [
    "https://www.bassmaster.com/gear/",
    "https://www.sportfishingmag.com/gear/",
  ],
  "trucking-fleet": [
    "https://www.truckinginfo.com/",
    "https://www.overdriveonline.com/",
  ],
  "offroading-jeep": [
    "https://www.jlwranglerforums.com/forum/",
    "https://expeditionportal.com/forum/",
  ],
  "forklifts-warehousing": [
    "https://www.mmh.com/",
    "https://www.logisticsmgmt.com/",
  ],
  "content-creation-streaming": [
    "https://www.tubefilter.com/",
  ],
  "agriculture-farming": [
    "https://www.agweb.com/",
    "https://www.precisionag.com/",
  ],
};

async function runWebAgent(task: AgentTask): Promise<InsertContextEntry[]> {
  const sources = WEB_SOURCES[task.verticalSlug] || [];
  const allContent: string[] = [];

  const webFetches = sources.map((url) => fetchWebPage(url));
  const results = await Promise.allSettled(webFetches);

  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      allContent.push(result.value);
    }
  }

  if (allContent.length === 0) return [];

  return extractContextFromContent(
    task,
    "web",
    allContent.join("\n\n---\n\n"),
  );
}

// --- Claude Context Extraction ---

async function extractContextFromContent(
  task: AgentTask,
  sourceType: "reddit" | "youtube" | "web",
  rawContent: string,
): Promise<InsertContextEntry[]> {
  const client = getAnthropicClient();

  const sourceLabel = {
    reddit: "Reddit posts and comments",
    youtube: "YouTube videos and transcripts",
    web: "industry websites and forums",
  }[sourceType];

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are a research analyst for iBolt Mounts, extracting industry context from ${sourceLabel}.

Industry Vertical: ${task.verticalName}
Research Query: ${task.query}

Raw content from ${sourceLabel}:
---
${rawContent.slice(0, 12000)}
---

Extract valuable context entries for our content knowledge bank. Focus on:
1. **user_language** — How real people talk about these problems (exact phrases, slang, complaints)
2. **pain_point** — Specific frustrations with device mounting in this industry
3. **use_case** — Real-world scenarios where people need mounting solutions
4. **terminology** — Industry-specific terms and jargon used naturally
5. **trend** — Emerging patterns, new technologies, or shifting behaviors
6. **competitor** — Mentions of competing products or solutions (RAM Mount, ProClip, etc.)

Return JSON array. Each entry should be a self-contained insight that helps us write authentic blog content:
[
  {
    "category": "user_language|pain_point|use_case|terminology|trend|competitor",
    "content": "Specific, detailed insight written as a reference note. Include direct quotes when available.",
    "confidence": 0.0-1.0
  }
]

Rules:
- Only include genuinely useful, specific insights — no generic filler
- Prefer entries with real user quotes or specific details
- Confidence should reflect how reliable/representative the insight is
- Aim for 5-15 high-quality entries per source batch
- Content should be written so a blog writer can use it directly as context`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  const extracted = JSON.parse(jsonMatch[0]) as Array<{
    category: string;
    content: string;
    confidence: number;
  }>;

  return extracted.map((e) => ({
    verticalId: task.verticalId,
    category: e.category,
    content: e.content,
    sourceType,
    confidence: Math.max(0, Math.min(1, e.confidence)),
    isVerified: false, // All research findings need human review
  }));
}

// --- Orchestrator ---

/**
 * The Agent Orchestrator — runs multiple research agents in parallel
 * across all verticals and source types.
 *
 * Inspired by Ruflo's swarm coordination:
 * - Each "agent" is a research task targeting one vertical + one source
 * - Agents run concurrently with configurable parallelism
 * - Results are streamed back via progress callback
 * - All findings stored in context_entries with isVerified=false
 */
export class ResearchOrchestrator {
  private concurrency: number;
  private onProgress?: (progress: OrchestratorProgress) => void;

  constructor(options: { concurrency?: number; onProgress?: (p: OrchestratorProgress) => void }) {
    this.concurrency = options.concurrency || 5;
    this.onProgress = options.onProgress;
  }

  /**
   * Run research agents for specific verticals and source types.
   * If verticalIds is empty, runs for ALL verticals.
   */
  async runResearch(options: {
    verticalIds?: string[];
    sourceTypes?: Array<"reddit" | "youtube" | "web">;
    customQueries?: string[];
  }): Promise<OrchestratorProgress> {
    const sourceTypes = options.sourceTypes || ["reddit", "youtube", "web"];

    // Get target verticals
    let verticals: IndustryVertical[];
    if (options.verticalIds && options.verticalIds.length > 0) {
      verticals = [];
      for (const id of options.verticalIds) {
        const [v] = await db.select().from(industryVerticals).where(eq(industryVerticals.id, id)).limit(1);
        if (v) verticals.push(v);
      }
    } else {
      verticals = await db.select().from(industryVerticals);
    }

    // Build agent tasks
    const tasks: AgentTask[] = [];
    for (const vertical of verticals) {
      for (const sourceType of sourceTypes) {
        const queries = options.customQueries || [
          vertical.name.toLowerCase(),
          `${vertical.name.toLowerCase()} mount`,
          `${vertical.name.toLowerCase()} phone holder`,
        ];

        for (const query of queries.slice(0, 2)) {
          tasks.push({
            verticalId: vertical.id,
            verticalName: vertical.name,
            verticalSlug: vertical.slug,
            sourceType,
            query,
          });
        }
      }
    }

    console.log(`[Research] Starting ${tasks.length} agent tasks across ${verticals.length} verticals`);

    const progress: OrchestratorProgress = {
      totalAgents: tasks.length,
      completed: 0,
      failed: 0,
      inProgress: 0,
      results: [],
    };

    // Process in batches with controlled concurrency
    const batches: AgentTask[][] = [];
    for (let i = 0; i < tasks.length; i += this.concurrency) {
      batches.push(tasks.slice(i, i + this.concurrency));
    }

    for (const batch of batches) {
      progress.inProgress = batch.length;
      this.onProgress?.(progress);

      const batchResults = await Promise.allSettled(
        batch.map((task) => this.runSingleAgent(task))
      );

      for (let i = 0; i < batchResults.length; i++) {
        const result = batchResults[i];
        const task = batch[i];

        if (result.status === "fulfilled") {
          progress.completed++;
          progress.results.push(result.value);
        } else {
          progress.failed++;
          progress.results.push({
            jobId: "",
            sourceType: task.sourceType,
            query: task.query,
            entriesFound: 0,
            status: "failed",
            error: result.reason?.message || "Unknown error",
          });
        }
      }

      progress.inProgress = 0;
      this.onProgress?.(progress);
    }

    console.log(`[Research] Complete: ${progress.completed} succeeded, ${progress.failed} failed, ${progress.results.reduce((s, r) => s + r.entriesFound, 0)} entries found`);

    return progress;
  }

  private async runSingleAgent(task: AgentTask): Promise<AgentResult> {
    // Create research job record
    const [job] = await db
      .insert(researchJobs)
      .values({
        verticalId: task.verticalId,
        sourceType: task.sourceType,
        query: task.query,
        status: "running",
        startedAt: new Date(),
      })
      .returning();

    try {
      let entries: InsertContextEntry[];

      switch (task.sourceType) {
        case "reddit":
          entries = await runRedditAgent(task);
          break;
        case "youtube":
          entries = await runYouTubeAgent(task);
          break;
        case "web":
          entries = await runWebAgent(task);
          break;
        default:
          entries = [];
      }

      // Store entries
      if (entries.length > 0) {
        await db.insert(contextEntries).values(entries);
      }

      // Update job status
      await db
        .update(researchJobs)
        .set({
          status: "completed",
          entriesFound: entries.length,
          completedAt: new Date(),
        })
        .where(eq(researchJobs.id, job.id));

      console.log(`[Research] ${task.sourceType}/${task.verticalSlug}: ${entries.length} entries from "${task.query}"`);

      return {
        jobId: job.id,
        sourceType: task.sourceType,
        query: task.query,
        entriesFound: entries.length,
        status: "completed",
      };
    } catch (error: any) {
      await db
        .update(researchJobs)
        .set({
          status: "failed",
          error: error.message,
          completedAt: new Date(),
        })
        .where(eq(researchJobs.id, job.id));

      throw error;
    }
  }
}

/**
 * Quick-launch: run research for all verticals with Reddit (no API key needed).
 */
export async function runFullRedditResearch(
  onProgress?: (p: OrchestratorProgress) => void,
): Promise<OrchestratorProgress> {
  const orchestrator = new ResearchOrchestrator({
    concurrency: 3, // Reddit rate limits — keep it modest
    onProgress,
  });

  return orchestrator.runResearch({ sourceTypes: ["reddit"] });
}

/**
 * Quick-launch: run research for a single vertical across all sources.
 */
export async function runVerticalResearch(
  verticalId: string,
  onProgress?: (p: OrchestratorProgress) => void,
): Promise<OrchestratorProgress> {
  const orchestrator = new ResearchOrchestrator({
    concurrency: 5,
    onProgress,
  });

  return orchestrator.runResearch({ verticalIds: [verticalId] });
}

/**
 * Get research job history.
 */
export async function getResearchJobs(verticalId?: string): Promise<ResearchJob[]> {
  if (verticalId) {
    return db.select().from(researchJobs).where(eq(researchJobs.verticalId, verticalId));
  }
  return db.select().from(researchJobs);
}
