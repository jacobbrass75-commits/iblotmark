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
    const error = new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    error.status = res.status;
    error.body = text;
    throw error;
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

function isMissingApiRouteError(error) {
  return error?.status === 404
    && typeof error?.body === "string"
    && error.body.includes("API route not found");
}

async function apiWithRouteFallback(method, paths, body) {
  let lastError;
  for (const path of paths) {
    try {
      return await api(method, path, body);
    } catch (error) {
      lastError = error;
      if (!isMissingApiRouteError(error)) throw error;
    }
  }
  throw lastError;
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
      if (payload.type === "started" || payload.type === "progress" || payload.type === "phase" || payload.type === "completed") {
        plainText += `[${payload.type}] ${payload.message ?? payload.phase ?? ""}\n`;
        if (payload.type === "completed" && payload.summary) {
          plainText += `${JSON.stringify(payload.summary, null, 2)}\n`;
        }
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

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function bodyWithOptions(input) {
  const { options, ...fields } = input ?? {};
  if (options !== undefined && !isPlainObject(options)) {
    throw new Error("options must be a JSON object when provided");
  }
  const body = options ? { ...options } : {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null && value !== "") body[key] = value;
  }
  return body;
}

function serviceOpsPath(path) {
  return `/api/blog/service-ops${path}`;
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

server.tool(
  "lint_content",
  "Run the deterministic brand/SEO linter on blog markdown. Returns errors and warnings. Use before publishing anything.",
  {
    markdown: z.string().describe("Blog post markdown to lint"),
    title: z.string().optional().describe("Article title"),
    metaTitle: z.string().optional().describe("SEO meta title"),
    metaDescription: z.string().optional().describe("SEO meta description"),
    primaryKeyword: z.string().optional().describe("Primary target keyword"),
  },
  async (body) => {
    try {
      const data = await api("POST", "/api/blog/lint", body);
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "add_internal_links",
  "Insert links to related iBOLT blog posts into an existing post. Use to retrofit older posts when new related content is published.",
  {
    id: z.string().describe("Blog post ID"),
  },
  async ({ id }) => {
    try {
      const data = await api("POST", `/api/blog/posts/${encodeURIComponent(id)}/internal-links`, {});
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "refresh_post",
  "Refresh a published post: update dates, prices, and product links against the current catalog, then sync to Shopify. Only saves if quality does not regress.",
  {
    id: z.string().describe("Blog post ID to refresh"),
  },
  async ({ id }) => {
    try {
      const data = await api("POST", `/api/blog/posts/${encodeURIComponent(id)}/refresh`, {});
      return ok(data);
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
        body = sources ? { sourceTypes: sources } : {};
      } else {
        path = "/api/blog/context/research/run";
        body = sources ? { sourceTypes: sources } : {};
      }
      const result = await apiSSE("POST", path, body, 600_000);
      return ok(result.text || "Research complete");
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "get_research_coverage",
  "Show research coverage per industry vertical: entry counts, staleness, missing research sources. Use to decide where to run research.",
  {},
  async () => {
    try {
      const data = await api("GET", "/api/blog/research/coverage");
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "suggest_verticals",
  "Analyze unmapped keywords and benchmark queries to detect new product categories that need a vertical.",
  {},
  async () => {
    try {
      const data = await api("POST", "/api/blog/verticals/suggest", {});
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "create_vertical",
  "Create a complete new industry vertical (terminology, pain points, use cases, research sources) from a short description. Use when entering a new product category.",
  {
    description: z.string().describe("Short description of the new product category or customer vertical"),
  },
  async ({ description }) => {
    try {
      const data = await api("POST", "/api/blog/verticals/create", { description });
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

// ═══════════════════════════════════════
//  AI VISIBILITY BENCHMARK
// ═══════════════════════════════════════

server.tool(
  "run_ai_benchmark",
  "Run the AI visibility benchmark: queries ChatGPT, Claude, Gemini, and Google with buyer-style questions and measures whether iBOLT is mentioned/ranked/cited. Long-running.",
  {
    name: z.string().optional().describe("Optional name for this benchmark run"),
    queryIds: z.array(z.string()).optional().describe("Specific benchmark query IDs to run; omit for all active queries"),
    providers: z.array(z.string()).optional().describe("Providers to run: openai, anthropic, gemini, google"),
    concurrency: z.number().optional().describe("Provider/query concurrency; default comes from the backend"),
  },
  async ({ name, queryIds, providers, concurrency }) => {
    try {
      const body = {};
      if (name) body.name = name;
      if (queryIds?.length) body.queryIds = queryIds;
      if (providers?.length) body.providers = providers;
      if (concurrency !== undefined) body.concurrency = concurrency;
      const result = await apiSSE("POST", "/api/blog/benchmark/run", body, 1_800_000);
      return ok(result.text || "Benchmark complete");
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "get_benchmark_summary",
  "Get provider-level and query-level results from the latest benchmark run, including biggest gaps and top wins.",
  {
    runId: z.string().optional().describe("Benchmark run ID; omit for the latest run"),
  },
  async ({ runId }) => {
    try {
      const path = runId
        ? `/api/blog/benchmark/runs/${encodeURIComponent(runId)}`
        : "/api/blog/benchmark/latest";
      const data = await api("GET", path);
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "list_benchmark_queries",
  "List the tracked buyer-style benchmark queries.",
  {},
  async () => {
    try {
      const data = await api("GET", "/api/blog/benchmark/queries");
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "add_benchmark_query",
  "Add a buyer-style query to track (e.g. 'best forklift tablet mount'). Use when entering a new category.",
  {
    category: z.string().describe("Category or vertical label, e.g. Forklift mounts"),
    query: z.string().describe("Buyer-style AI-search query to track"),
    label: z.string().optional().describe("Short display label"),
    verticalId: z.string().optional().describe("Optional industry vertical ID"),
    intentType: z.string().optional().describe("Intent type, default buyer_guide"),
    priority: z.number().optional().describe("Priority score, default 50"),
    benchmarkGoal: z.string().optional().describe("What a good answer should say"),
    persona: z.string().optional().describe("Target persona"),
    painPoint: z.string().optional().describe("Customer pain point"),
    brandAngle: z.string().optional().describe("Desired iBOLT positioning angle"),
    targetProducts: z.array(z.string()).optional().describe("Product names or handles the answer should connect to"),
    notes: z.string().optional().describe("Internal notes"),
    status: z.string().optional().describe("Query status, default active"),
  },
  async (body) => {
    try {
      const data = await api("POST", "/api/blog/benchmark/queries", body);
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "generate_content_plan",
  "Turn the weakest benchmark queries into a deduplicated content plan (titles, keywords, angles, gap scores).",
  {
    runId: z.string().optional().describe("Benchmark run ID; omit for latest"),
    limit: z.number().optional().describe("Maximum plan items to return; default 8"),
  },
  async ({ runId, limit }) => {
    try {
      const data = await api("GET", `/api/blog/benchmark/content-plan${qs({ runId, limit })}`);
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "materialize_content_plan",
  "Convert a content-plan item into a keyword cluster; optionally queue it for generation (generateNow flag).",
  {
    item: z.object({
      queryId: z.string(),
      primaryKeyword: z.string(),
      title: z.string(),
    }).passthrough().describe("Content-plan item returned by generate_content_plan"),
    generateNow: z.boolean().optional().describe("Immediately generate a post after creating the cluster"),
    queueForGeneration: z.boolean().optional().describe("Queue the created cluster for generation"),
  },
  async ({ item, generateNow, queueForGeneration }) => {
    try {
      const data = await api("POST", "/api/blog/benchmark/content-plan/materialize", {
        item,
        generateNow: Boolean(generateNow),
        queueForGeneration: Boolean(queueForGeneration),
      });
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

// ═══════════════════════════════════════
//  AI VISIBILITY MANAGED-SERVICE OPS
// ═══════════════════════════════════════

server.tool(
  "get_service_packages",
  "Get AI visibility managed-service packages from the backend service-ops catalog.",
  {
    status: z.string().optional().describe("Optional package status filter, e.g. active or archived"),
    audience: z.string().optional().describe("Optional audience/client segment filter"),
    includeInactive: z.boolean().optional().describe("Include inactive or archived packages when supported"),
  },
  async ({ status, audience, includeInactive }) => {
    try {
      const query = qs({ status, audience, includeInactive });
      const data = await apiWithRouteFallback("GET", [
        serviceOpsPath(`/packages${query}`),
        serviceOpsPath(`/service-packages${query}`),
      ]);
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "get_service_checklists",
  "Get AI visibility managed-service delivery checklists, optionally filtered by package or stage.",
  {
    packageId: z.string().optional().describe("Optional service package ID or slug"),
    stage: z.string().optional().describe("Optional workflow stage filter"),
    status: z.string().optional().describe("Optional checklist status filter"),
    includeInactive: z.boolean().optional().describe("Include inactive or archived checklists when supported"),
  },
  async ({ packageId, stage, status, includeInactive }) => {
    try {
      const query = qs({ packageId, stage, status, includeInactive });
      const data = await apiWithRouteFallback("GET", [
        serviceOpsPath(`/checklists${query}`),
        serviceOpsPath(`/service-checklists${query}`),
      ]);
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "generate_local_prompt_pack",
  "Generate a local AI visibility prompt pack through the backend service-ops workflow.",
  {
    packageId: z.string().optional().describe("Optional service package ID or slug"),
    runId: z.string().optional().describe("Optional benchmark run ID; omit for backend default/latest"),
    verticalIds: z.array(z.string()).optional().describe("Optional industry vertical IDs to include"),
    queryIds: z.array(z.string()).optional().describe("Optional benchmark query IDs to include"),
    limit: z.number().optional().describe("Optional max prompts/items"),
    outputDir: z.string().optional().describe("Optional backend-local output directory"),
    dryRun: z.boolean().optional().describe("Preview the pack without writing files when supported"),
    options: z.any().optional().describe("Optional backend-specific JSON object merged into the request body"),
  },
  async (input) => {
    try {
      const body = bodyWithOptions(input);
      const data = await apiWithRouteFallback("POST", [
        serviceOpsPath("/generate-local-prompt-pack"),
        serviceOpsPath("/local-prompt-pack/generate"),
        serviceOpsPath("/local-prompt-pack"),
        serviceOpsPath("/prompt-pack/local"),
      ], body);
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "build_outbound_snapshot",
  "Build an outbound AI visibility managed-service snapshot through the backend service-ops workflow.",
  {
    packageId: z.string().optional().describe("Optional service package ID or slug"),
    runId: z.string().optional().describe("Optional benchmark run ID; omit for backend default/latest"),
    checklistId: z.string().optional().describe("Optional checklist ID or slug to focus the snapshot"),
    verticalIds: z.array(z.string()).optional().describe("Optional industry vertical IDs to include"),
    queryIds: z.array(z.string()).optional().describe("Optional benchmark query IDs to include"),
    includeDrafts: z.boolean().optional().describe("Include draft artifacts when supported"),
    outputDir: z.string().optional().describe("Optional backend-local output directory"),
    dryRun: z.boolean().optional().describe("Preview the snapshot without writing files when supported"),
    options: z.any().optional().describe("Optional backend-specific JSON object merged into the request body"),
  },
  async (input) => {
    try {
      const body = bodyWithOptions(input);
      const data = await apiWithRouteFallback("POST", [
        serviceOpsPath("/build-outbound-snapshot"),
        serviceOpsPath("/outbound-snapshot/build"),
        serviceOpsPath("/outbound-snapshot"),
        serviceOpsPath("/snapshots/outbound"),
      ], body);
      return ok(data);
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

// ═══════════════════════════════════════
//  PHOTO BANK & IMAGE MANAGEMENT
// ═══════════════════════════════════════

server.tool(
  "list_photos",
  "List photos in the image bank, optionally filtered by product. Returns metadata including analysis results, quality scores, and vertical relevance.",
  {
    productId: z.string().optional().describe("Filter photos by product ID"),
  },
  async ({ productId }) => {
    try {
      const data = await api("GET", `/api/blog/photos${qs({ productId })}`);
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "get_photo",
  "Get detailed metadata for a single photo — analysis results, quality score, angle type, vertical relevance, hero candidacy",
  { id: z.string().describe("Photo ID") },
  async ({ id }) => {
    try {
      const data = await api("GET", `/api/blog/photos/${encodeURIComponent(id)}`);
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "photo_stats",
  "Get photo bank statistics — total count, analyzed, unanalyzed, and unassigned photos",
  {},
  async () => {
    try {
      const data = await api("GET", "/api/blog/photos/stats");
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "import_photos",
  "Import photos from a local directory into the image bank. Recursively scans for jpg, png, webp, heic, tiff, bmp. Skips duplicates. Takes a few minutes for large directories.",
  {
    dirPath: z.string().describe("Absolute path to the directory containing images"),
  },
  async ({ dirPath }) => {
    try {
      const result = await apiSSE("POST", "/api/blog/photos/import-directory", { dirPath }, 600_000);
      return ok(result.text || "Import complete");
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "analyze_photo",
  "Run GPT-4V vision analysis on a single photo — identifies product, angle type, context, quality score, vertical relevance, and hero candidacy",
  { id: z.string().describe("Photo ID to analyze") },
  async ({ id }) => {
    try {
      const data = await api("POST", `/api/blog/photos/${encodeURIComponent(id)}/analyze`);
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "batch_analyze_photos",
  "Batch-analyze unanalyzed photos with GPT-4V vision. Processes up to 20 photos by default.",
  {
    limit: z.number().optional().describe("Max photos to analyze (default 20)"),
  },
  async ({ limit }) => {
    try {
      const body = {};
      if (limit !== undefined) body.limit = limit;
      const result = await apiSSE("POST", "/api/blog/photos/batch-analyze", body, 600_000);
      return ok(result.text || "Batch analysis complete");
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "auto_associate_photos",
  "Automatically match unassigned photos to products using filename matching and AI analysis results",
  {},
  async () => {
    try {
      const data = await api("POST", "/api/blog/photos/auto-associate");
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

server.tool(
  "delete_photo",
  "Delete a photo from the image bank (removes files and database record)",
  { id: z.string().describe("Photo ID to delete") },
  async ({ id }) => {
    try {
      const data = await api("DELETE", `/api/blog/photos/${encodeURIComponent(id)}`);
      return ok(data);
    } catch (e) { return err(e.message); }
  }
);

// ── Start ──

const transport = new StdioServerTransport();
await server.connect(transport);
