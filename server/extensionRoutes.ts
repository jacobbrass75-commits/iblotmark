import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth, requireTier } from "./auth";
import { projectStorage } from "./projectStorage";
import { db } from "./db";
import { generateChicagoBibliography, generateChicagoFootnote } from "./citationGenerator";
import { webClips, type CitationData } from "@shared/schema";

const extensionSaveSchema = z
  .object({
    highlightedText: z.string().trim().min(1),
    pageUrl: z.string().trim().url(),
    pageTitle: z.string().trim().optional(),
    context: z.string().trim().optional(),
    projectId: z.string().trim().optional(),
    timestamp: z.string().trim().optional(),
  })
  .strict();

function normalizeUrl(input: string): string {
  const url = new URL(input);
  url.hash = "";
  return url.toString();
}

export function registerExtensionRoutes(app: Express): void {
  // POST /api/extension/save — Legacy extension endpoint kept for compatibility.
  // Persists a real web clip so older extension builds still save usable data.
  app.post("/api/extension/save", requireAuth, requireTier("pro"), async (req: Request, res: Response) => {
    try {
      const parsed = extensionSaveSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid extension payload",
          details: parsed.error.flatten(),
        });
      }

      const targetProjectId = parsed.data.projectId || null;
      if (targetProjectId) {
        const projects = await projectStorage.getAllProjects(req.user!.userId);
        const ownsProject = projects.some((project) => project.id === targetProjectId);
        if (!ownsProject) {
          return res.status(404).json({ message: "Project not found" });
        }
      }

      const citationData: CitationData = {
        sourceType: "website",
        authors: [],
        title: parsed.data.pageTitle || "Untitled Page",
        url: parsed.data.pageUrl,
        accessDate: new Date().toISOString().split("T")[0],
      };

      const [created] = await db
        .insert(webClips)
        .values({
          userId: req.user!.userId,
          highlightedText: parsed.data.highlightedText,
          note: parsed.data.context || null,
          category: "web_clip",
          sourceUrl: normalizeUrl(parsed.data.pageUrl),
          pageTitle: parsed.data.pageTitle || "Untitled Page",
          citationData,
          footnote: generateChicagoFootnote(citationData),
          bibliography: generateChicagoBibliography(citationData),
          projectId: targetProjectId,
          surroundingContext: parsed.data.context || null,
        })
        .returning();

      return res.status(201).json({
        success: true,
        clip: created,
      });
    } catch (error) {
      console.error("Extension save error:", error);
      return res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to save highlight",
      });
    }
  });
}
