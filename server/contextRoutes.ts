// Context bank and research agent API routes
// CRUD for verticals/context entries + research orchestrator triggers.

import { Router, type Request, type Response } from "express";
import {
  getVerticals,
  getVerticalById,
  getVerticalBySlug,
  getContextEntries,
  addContextEntry,
  verifyContextEntry,
  deleteContextEntry,
  getContextStats,
  formatContextForPrompt,
} from "./contextBanks";
import { db } from "./db";
import { industryVerticals } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  ResearchOrchestrator,
  runFullRedditResearch,
  runVerticalResearch,
  getResearchJobs,
  type OrchestratorProgress,
} from "./iboltResearchAgent";

export function registerContextRoutes(app: { use: (path: string, router: Router) => void }) {
  const router = Router();

  // --- Verticals ---

  // GET /api/blog/context/verticals — List all industry verticals
  router.get("/verticals", async (_req: Request, res: Response) => {
    try {
      const verticals = await getVerticals();
      res.json(verticals);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/blog/context/verticals — Create a new industry vertical
  router.post("/verticals", async (req: Request, res: Response) => {
    try {
      const { name, slug, description, terminology, painPoints, useCases, regulations, seasonalRelevance, compatibleDevices } = req.body;
      if (!name || !slug) {
        return res.status(400).json({ error: "name and slug are required" });
      }
      const [vertical] = await db.insert(industryVerticals).values({
        name,
        slug: slug.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        description: description || null,
        terminology: terminology || [],
        painPoints: painPoints || [],
        useCases: useCases || [],
        regulations: regulations || [],
        seasonalRelevance: seasonalRelevance || null,
        compatibleDevices: compatibleDevices || [],
      }).returning();
      res.json(vertical);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // PATCH /api/blog/context/verticals/:id — Update an industry vertical
  router.patch("/verticals/:id", async (req: Request, res: Response) => {
    try {
      const updates: any = { updatedAt: new Date() };
      const allowed = ["name", "slug", "description", "terminology", "painPoints", "useCases", "regulations", "seasonalRelevance", "compatibleDevices"];
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }
      const [vertical] = await db.update(industryVerticals).set(updates).where(eq(industryVerticals.id, req.params.id)).returning();
      res.json(vertical);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/context/verticals/:id — Get single vertical with stats
  router.get("/verticals/:id", async (req: Request, res: Response) => {
    try {
      const vertical = await getVerticalById(req.params.id);
      if (!vertical) return res.status(404).json({ error: "Vertical not found" });
      const stats = await getContextStats(vertical.id);
      res.json({ ...vertical, contextStats: stats });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- Context Entries ---

  // GET /api/blog/context/entries/:verticalId — List context entries for a vertical
  router.get("/entries/:verticalId", async (req: Request, res: Response) => {
    try {
      const category = req.query.category as string | undefined;
      const includeUnverified = req.query.includeUnverified === "true";
      const entries = await getContextEntries(req.params.verticalId, category, !includeUnverified);
      res.json(entries);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/blog/context/entries — Add a manual context entry
  router.post("/entries", async (req: Request, res: Response) => {
    try {
      const { verticalId, category, content, sourceType } = req.body;
      if (!verticalId || !category || !content) {
        return res.status(400).json({ error: "verticalId, category, and content are required" });
      }
      const entry = await addContextEntry({
        verticalId,
        category,
        content,
        sourceType: sourceType || "manual",
        confidence: 1.0,
        isVerified: true,
      });
      res.json(entry);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // PATCH /api/blog/context/entries/:id/verify — Verify or unverify a context entry
  router.patch("/entries/:id/verify", async (req: Request, res: Response) => {
    try {
      const { verified } = req.body;
      await verifyContextEntry(req.params.id, verified !== false);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/blog/context/entries/:id — Delete a context entry
  router.delete("/entries/:id", async (req: Request, res: Response) => {
    try {
      await deleteContextEntry(req.params.id);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/context/prompt/:verticalId — Get formatted context for a vertical
  router.get("/prompt/:verticalId", async (req: Request, res: Response) => {
    try {
      const prompt = await formatContextForPrompt(req.params.verticalId);
      res.json({ prompt });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- Research Agent ---

  // Active SSE connections for research progress
  const activeResearchStreams = new Map<string, Response>();

  // POST /api/blog/context/research/run — Launch research agents (SSE streaming)
  router.post("/research/run", async (req: Request, res: Response) => {
    try {
      const { verticalIds, sourceTypes, concurrency } = req.body;

      // Set up SSE
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const sendEvent = (event: string, data: any) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      sendEvent("started", { message: "Research agents launching..." });

      const orchestrator = new ResearchOrchestrator({
        concurrency: concurrency || 5,
        onProgress: (progress) => {
          sendEvent("progress", progress);
        },
      });

      const result = await orchestrator.runResearch({
        verticalIds,
        sourceTypes: sourceTypes || ["reddit"],
      });

      sendEvent("completed", result);
      res.end();
    } catch (error: any) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  });

  // POST /api/blog/context/research/reddit — Quick launch: Reddit research for all verticals
  router.post("/research/reddit", async (_req: Request, res: Response) => {
    try {
      // Set up SSE
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const sendEvent = (event: string, data: any) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      sendEvent("started", { message: "Reddit research agents launching for all verticals..." });

      const result = await runFullRedditResearch((progress) => {
        sendEvent("progress", progress);
      });

      sendEvent("completed", result);
      res.end();
    } catch (error: any) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  });

  // POST /api/blog/context/research/vertical/:id — Research a single vertical
  router.post("/research/vertical/:id", async (req: Request, res: Response) => {
    try {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const sendEvent = (event: string, data: any) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const vertical = await getVerticalById(req.params.id);
      sendEvent("started", { message: `Research agents launching for ${vertical?.name || "unknown"}...` });

      const result = await runVerticalResearch(req.params.id, (progress) => {
        sendEvent("progress", progress);
      });

      sendEvent("completed", result);
      res.end();
    } catch (error: any) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  });

  // GET /api/blog/context/research/jobs — List research job history
  router.get("/research/jobs", async (req: Request, res: Response) => {
    try {
      const verticalId = req.query.verticalId as string | undefined;
      const jobs = await getResearchJobs(verticalId);
      res.json(jobs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.use("/api/blog/context", router);
}
