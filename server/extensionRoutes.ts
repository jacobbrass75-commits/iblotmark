import type { Express, Request, Response } from "express";
import { requireAuth, requireTier } from "./auth";
import { db } from "./db";
import { webClips } from "@shared/schema";
import { generateChicagoBibliography, generateChicagoFootnote } from "./citationGenerator";

function normalizeUrl(input: string): string {
  const url = new URL(input);
  url.hash = "";
  return url.toString();
}

export function registerExtensionRoutes(app: Express): void {
  // POST /api/extension/save — Save a highlight from the Chrome extension
  // Requires auth (JWT in Authorization header)
  // Body: { highlightedText, pageUrl, pageTitle, context, projectId?, timestamp? }
  // Creates an annotation in the specified project (or default project)
  app.post("/api/extension/save", requireAuth, requireTier("pro"), async (req: Request, res: Response) => {
    try {
      const { highlightedText, pageUrl, pageTitle, context, projectId } = req.body;

      if (
        !highlightedText ||
        typeof highlightedText !== "string" ||
        !highlightedText.trim() ||
        !pageUrl ||
        typeof pageUrl !== "string" ||
        !pageTitle ||
        typeof pageTitle !== "string" ||
        !pageTitle.trim()
      ) {
        return res.status(400).json({ message: "Invalid extension payload" });
      }

      let sourceUrl: string;
      try {
        sourceUrl = normalizeUrl(pageUrl);
      } catch {
        return res.status(400).json({ message: "Invalid extension payload" });
      }

      const parsedUrl = new URL(sourceUrl);
      const citationData = {
        sourceType: "website" as const,
        authors: [] as Array<{ firstName: string; lastName: string }>,
        title: pageTitle.trim(),
        containerTitle: parsedUrl.hostname,
        url: sourceUrl,
        accessDate: new Date().toISOString().split("T")[0],
      };
      const footnote = generateChicagoFootnote(citationData);
      const bibliography = generateChicagoBibliography(citationData);

      const [clip] = await db.insert(webClips).values({
        userId: req.user!.userId,
        highlightedText: highlightedText.trim(),
        note: typeof context === "string" && context.trim() ? context.trim() : null,
        category: "web_clip",
        sourceUrl,
        pageTitle: pageTitle.trim(),
        siteName: parsedUrl.hostname,
        citationData,
        footnote,
        bibliography,
        projectId: typeof projectId === "string" && projectId.trim() ? projectId.trim() : null,
        surroundingContext: typeof context === "string" && context.trim() ? context.trim() : null,
        tags: [],
      }).returning();

      return res.status(201).json({
        success: true,
        clip,
      });
    } catch (error) {
      console.error("Extension save error:", error);
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to save highlight",
      });
    }
  });
}
