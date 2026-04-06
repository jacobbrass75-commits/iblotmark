#!/usr/bin/env node

/**
 * iBolt Blog Generator — stdio MCP server for Claude Code
 *
 * Exposes the blog generation pipeline, keyword management, product catalog,
 * industry context banks, and Shopify publishing as MCP tools.
 *
 * Usage:
 *   node ibolt-stdio.mjs
 *
 * Requires the main app running on localhost:5001 (npm run dev in the repo root).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BACKEND = process.env.IBOLT_BACKEND_URL ?? "http://127.0.0.1:5001";

// ── HTTP helpers ──

async function api(method, path, body) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BACKEND}${path}`, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

async function apiSSE(method, path, body, timeoutMs = 300_000) {
  const res = await fetch(`${BACKEND}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  // Buffer the full SSE stream and return combined text
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let plainText = "";
  const documents = [];
  let activeDoc = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
      if (!raw.trim()) continue;
      const dataLines = raw.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trimStart());
      if (!dataLines.length) continue;
      const payloadText = dataLines.join("\n");
      if (payloadText === "[DONE]") break;
      let payload;
      try { payload = JSON.parse(payloadText); } catch { continue; }
      if (!payload?.type) continue;
      if (payload.type === "text") { plainText += payload.text ?? ""; continue; }
      if (payload.type === "document_start") {
        if (activeDoc) documents.push(activeDoc);
        activeDoc = { title: payload.title ?? "Draft", content: "" };
        continue;
      }
      if (payload.type === "document_text") {
        if (!activeDoc) activeDoc = { title: "Draft", content: "" };
        activeDoc.content += payload.text ?? "";
        continue;
      }
      if (payload.type === "document_end") {
        if (activeDoc) { documents.push(activeDoc); activeDoc = null; }
        continue;
      }
      if (payload.type === "done") {
        if (activeDoc) { documents.push(activeDoc); activeDoc = null; }
        break;
      }
      if (payload.type === "error") throw new Error(payload.error ?? "SSE stream error");
      // progress / phase events — accumulate as text
      if (payload.type === "progress" || payload.type === "phase") {
        plainText += `[${payload.type}] ${payload.message ?? payload.phase ?? ""}\n`;
      }
    }
  }
  if (activeDoc) documents.push(activeDoc);
  return { text: plainText.trim(), documents };
}

function qs(params) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  }
  const q = s.toString();
  return q ? `?${q}` : "";
}

function ok(data) {
  return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}
function err(msg) {
  return { isError: true, content: [{ type: "text", text: msg }] };
}

// ── MCP Server ──

const server = new McpServer({
  name: "ibolt-generator",
  version: "1.0.0",
});

// ═══════════════════════════════════════
//  BLOG POSTS
// ═══════════════════════════════════════

server.tool(
  "list_blog_posts",
  "List generated blog posts, optionally filtered by status (draft/approved/published)",
  { status: z.string().optional().describe("Filter: draft, approved, or published") },
  async ({ status }) => {
    try {
      const data = await api("GET", `/api/blog/posts${qs({ status })}`);
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "get_blog_post",
  "Get a single blog post by ID, including full markdown content and verification scores",
  { id: z.string().describe("Blog post ID") },
  async ({ id }) => {
    try {
      const data = await api("GET", `/api/blog/posts/${encodeURIComponent(id)}`);
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "get_blog_post_html",
  "Get the Shopify-ready HTML for a blog post, with SEO meta tags and FAQ schema",
  { id: z.string().describe("Blog post ID") },
  async ({ id }) => {
    try {
      const data = await api("GET", `/api/blog/posts/${encodeURIComponent(id)}/html`);
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "update_blog_post",
  "Update a blog post (content, title, status, meta description, etc.)",
  {
    id: z.string().describe("Blog post ID"),
    title: z.string().optional().describe("New title"),
    content: z.string().optional().describe("New markdown content"),
    status: z.string().optional().describe("New status: draft, approved, published"),
    metaTitle: z.string().optional().describe("SEO meta title"),
    metaDescription: z.string().optional().describe("SEO meta description"),
  },
  async ({ id, ...updates }) => {
    try {
      const body = {};
      for (const [k, v] of Object.entries(updates)) { if (v !== undefined) body[k] = v; }
      const data = await api("PATCH", `/api/blog/posts/${encodeURIComponent(id)}`, body);
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "generate_blog_post",
  "Generate a new blog post from a keyword cluster using the 4-phase pipeline (Planner → Writer → Stitcher → Verifier). This takes 1-3 minutes.",
  {
    clusterId: z.string().describe("Keyword cluster ID to generate from"),
    verticalId: z.string().optional().describe("Override industry vertical ID"),
  },
  async ({ clusterId, verticalId }) => {
    try {
      const body = { clusterId };
      if (verticalId) body.verticalId = verticalId;
      const result = await apiSSE("POST", "/api/blog/generate", body, 600_000);
      const parts = [];
      if (result.text) parts.push(result.text);
      for (const doc of result.documents) {
        parts.push(`--- ${doc.title} ---\n${doc.content}`);
      }
      return ok(parts.join("\n\n") || "Generation complete (no content returned)");
    } catch (e) { return err(e.message); }
  }
);

// ═══════════════════════════════════════
//  KEYWORDS
// ═══════════════════════════════════════

server.tool(
  "list_keywords",
  "List imported keywords with volume, difficulty, CPC, and opportunity scores",
  { status: z.string().optional().describe("Filter: unclustered, clustered, used, all") },
  async ({ status }) => {
    try {
      const data = await api("GET", `/api/blog/keywords${qs({ status })}`);
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "list_keyword_clusters",
  "List keyword clusters — groups of related keywords for comprehensive blog posts",
  {},
  async () => {
    try {
      const data = await api("GET", "/api/blog/keywords/clusters");
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "import_keywords",
  "Import keywords from a CSV file on disk (Ubersuggest format)",
  { filePath: z.string().describe("Absolute path to the CSV file") },
  async ({ filePath }) => {
    try {
      const data = await api("POST", "/api/blog/keywords/import-file", { filePath });
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "cluster_keywords",
  "Run AI clustering on unclustered keywords to group them into blog post topics",
  {},
  async () => {
    try {
      const result = await apiSSE("POST", "/api/blog/keywords/cluster", {}, 300_000);
      return ok(result.text || "Clustering complete");
    } catch (e) { return err(e.message); }
  }
);

// ═══════════════════════════════════════
//  INDUSTRY VERTICALS & CONTEXT
// ═══════════════════════════════════════

server.tool(
  "list_verticals",
  "List the 12 industry verticals (Trucking, Fishing, Farming, etc.) with entry counts",
  {},
  async () => {
    try {
      const data = await api("GET", "/api/blog/context/verticals");
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "get_context_entries",
  "Get context bank entries for a specific industry vertical — terminology, pain points, use cases",
  { verticalId: z.string().describe("Industry vertical ID") },
  async ({ verticalId }) => {
    try {
      const data = await api("GET", `/api/blog/context/entries/${encodeURIComponent(verticalId)}`);
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "add_context_entry",
  "Add a manual context entry to an industry vertical's knowledge bank",
  {
    verticalId: z.string().describe("Industry vertical ID"),
    content: z.string().describe("The context content (terminology, pain point, use case, etc.)"),
    sourceType: z.string().optional().describe("Source type: manual, reddit, youtube, web (default: manual)"),
  },
  async ({ verticalId, content, sourceType }) => {
    try {
      const data = await api("POST", "/api/blog/context/entries", {
        verticalId,
        content,
        sourceType: sourceType ?? "manual",
      });
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "run_research",
  "Launch research agents (Reddit, YouTube, web) to populate context banks. Takes several minutes.",
  {
    verticalId: z.string().optional().describe("Specific vertical ID, or omit for all verticals"),
    sources: z.array(z.string()).optional().describe("Sources to use: reddit, youtube, web (default: all)"),
  },
  async ({ verticalId, sources }) => {
    try {
      let path, body;
      if (verticalId) {
        path = `/api/blog/context/research/vertical/${encodeURIComponent(verticalId)}`;
        body = sources ? { sources } : {};
      } else {
        path = "/api/blog/context/research/run";
        body = sources ? { sources } : {};
      }
      const result = await apiSSE("POST", path, body, 600_000);
      return ok(result.text || "Research complete");
    } catch (e) { return err(e.message); }
  }
);

// ═══════════════════════════════════════
//  PRODUCTS
// ═══════════════════════════════════════

server.tool(
  "list_products",
  "List iBolt products from the scraped catalog, optionally filtered by vertical",
  { verticalId: z.string().optional().describe("Filter by industry vertical ID") },
  async ({ verticalId }) => {
    try {
      const data = await api("GET", `/api/blog/products${qs({ verticalId })}`);
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "scrape_products",
  "Scrape the latest product catalog from iboltmounts.com/products.json",
  {},
  async () => {
    try {
      const data = await api("POST", "/api/blog/products/scrape");
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

// ═══════════════════════════════════════
//  GENERATION QUEUE
// ═══════════════════════════════════════

server.tool(
  "get_queue",
  "Get the current blog generation queue — pending, active, completed, and failed jobs",
  {},
  async () => {
    try {
      const data = await api("GET", "/api/blog/queue");
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "add_to_queue",
  "Add a keyword cluster to the blog generation queue",
  {
    clusterId: z.string().describe("Keyword cluster ID"),
    verticalId: z.string().optional().describe("Override vertical ID"),
    priority: z.number().optional().describe("Priority (lower = higher priority, default 5)"),
  },
  async ({ clusterId, verticalId, priority }) => {
    try {
      const body = { clusterId };
      if (verticalId) body.verticalId = verticalId;
      if (priority !== undefined) body.priority = priority;
      const data = await api("POST", "/api/blog/queue/add", body);
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "add_batch_to_queue",
  "Add multiple keyword clusters to the generation queue at once",
  {
    clusterIds: z.array(z.string()).describe("Array of keyword cluster IDs"),
  },
  async ({ clusterIds }) => {
    try {
      const data = await api("POST", "/api/blog/queue/add-batch", { clusterIds });
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

// ═══════════════════════════════════════
//  SHOPIFY PUBLISHING
// ═══════════════════════════════════════

server.tool(
  "publish_to_shopify",
  "Publish a blog post to Shopify as a draft article",
  { id: z.string().describe("Blog post ID to publish") },
  async ({ id }) => {
    try {
      const data = await api("POST", `/api/blog/shopify/publish/${encodeURIComponent(id)}`);
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "shopify_status",
  "Check Shopify connection status and configuration",
  {},
  async () => {
    try {
      const data = await api("GET", "/api/blog/shopify/status");
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "list_shopify_articles",
  "List existing blog articles on the Shopify store",
  {},
  async () => {
    try {
      const data = await api("GET", "/api/blog/shopify/articles");
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

// ═══════════════════════════════════════
//  SCHEDULER
// ═══════════════════════════════════════

server.tool(
  "scheduler_status",
  "Get the autonomous scheduler status — running state, last run times, configuration",
  {},
  async () => {
    try {
      const data = await api("GET", "/api/blog/scheduler/status");
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "start_scheduler",
  "Start the autonomous scheduler (auto research, product sync, blog generation)",
  {},
  async () => {
    try {
      const data = await api("POST", "/api/blog/scheduler/start");
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "stop_scheduler",
  "Stop the autonomous scheduler",
  {},
  async () => {
    try {
      const data = await api("POST", "/api/blog/scheduler/stop");
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "trigger_scheduler_action",
  "Manually trigger a specific scheduler action",
  {
    action: z.enum(["research", "products", "generate", "photos", "chunks"])
      .describe("Which action to trigger"),
  },
  async ({ action }) => {
    try {
      const data = await api("POST", `/api/blog/scheduler/trigger/${action}`);
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

// ═══════════════════════════════════════
//  COMPETITOR ANALYSIS
// ═══════════════════════════════════════

server.tool(
  "analyze_competitor",
  "Analyze competitor blog URLs to understand their SEO strategy and auto-queue matching topics",
  {
    urls: z.array(z.string()).describe("Array of competitor blog post URLs to analyze"),
  },
  async ({ urls }) => {
    try {
      const result = await apiSSE("POST", "/api/blog/competitor/analyze", { urls }, 300_000);
      return ok(result.text || "Analysis complete");
    } catch (e) { return err(e.message); }
  }
);

// ── Start ──

const transport = new StdioServerTransport();
await server.connect(transport);
