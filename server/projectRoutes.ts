import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { requireAuth, requireTier } from "./auth";
import { projectStorage } from "./projectStorage";
import { globalSearch, searchProjectDocument } from "./projectSearch";
import { generateChicagoFootnote, generateChicagoBibliography, generateFootnoteWithQuote, generateInlineCitation, generateFootnote, generateInTextCitation, generateBibliographyEntry } from "./citationGenerator";
import { generateRetrievalContext, generateProjectContextSummary, generateFolderContextSummary, generateSearchableContent, embedText } from "./contextGenerator";
import { db } from "./db";
import { storage } from "./storage";
import { isSourceRole } from "./sourceRoles";
import {
  getEmbedding,
  cosineSimilarity,
  extractCitationMetadata,
  PIPELINE_CONFIG,
  getMaxChunksForLevel,
  type ThoroughnessLevel,
} from "./openai";
// V2 Pipeline - improved annotation system
import { processChunksWithPipelineV2, processChunksWithMultiplePrompts } from "./pipelineV2";
import { randomUUID } from "crypto";
import { batchProcess } from "./replit_integrations/batch/utils";
import {
  insertProjectSchema,
  insertFolderSchema,
  insertProjectDocumentSchema,
  insertProjectAnnotationSchema,
  citationDataSchema,
  batchAnalysisRequestSchema,
  batchAddDocumentsRequestSchema,
  citationStyles,
  projectDocuments,
  type CitationData,
  type CitationStyle,
  type AnnotationCategory,
  type BatchDocumentResult,
  type BatchAnalysisResponse,
  type BatchAddDocumentResult,
  type BatchAddDocumentsResponse,
} from "@shared/schema";

interface AnalysisConstraints {
  categories?: AnnotationCategory[];
  maxAnnotationsPerDoc?: number;
  minConfidence?: number;
  thoroughness?: ThoroughnessLevel;
}

// Default color palette for multi-prompt analysis
const PROMPT_COLORS = [
  '#ef4444', // red
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
];

function getDefaultPromptColor(index: number): string {
  return PROMPT_COLORS[index % PROMPT_COLORS.length];
}

async function analyzeProjectDocument(
  projectDocId: string,
  intent: string,
  constraints?: AnalysisConstraints
): Promise<{ annotationsCreated: number; filename: string; chunksAnalyzed: number; totalChunks: number }> {
  const projectDoc = await projectStorage.getProjectDocument(projectDocId);
  if (!projectDoc) {
    throw new Error("Project document not found");
  }

  const doc = await storage.getDocument(projectDoc.documentId);
  if (!doc) {
    throw new Error("Document not found");
  }

  const project = await projectStorage.getProject(projectDoc.projectId);
  
  const fullIntent = project?.thesis 
    ? `Project thesis: ${project.thesis}\n\nResearch focus: ${intent}`
    : intent;

  const chunks = await storage.getChunksForDocument(doc.id);
  if (chunks.length === 0) {
    throw new Error("No text chunks found for analysis");
  }

  const thoroughness = constraints?.thoroughness || 'standard';
  const maxChunks = getMaxChunksForLevel(thoroughness);

  let topChunks: { text: string; startPosition: number; id: string }[];
  
  try {
    const intentEmbedding = await getEmbedding(fullIntent);
    
    const chunksWithEmbeddings = await Promise.all(
      chunks.map(async (chunk) => {
        if (!chunk.embedding) {
          try {
            const embedding = await getEmbedding(chunk.text);
            await storage.updateChunkEmbedding(chunk.id, embedding);
            return { ...chunk, embedding };
          } catch {
            return chunk;
          }
        }
        return chunk;
      })
    );

    const rankedChunks = chunksWithEmbeddings
      .filter(c => c.embedding)
      .map((chunk) => ({
        chunk,
        similarity: cosineSimilarity(chunk.embedding!, intentEmbedding),
      }))
      .sort((a, b) => b.similarity - a.similarity);

    const minSimilarity = thoroughness === 'exhaustive' ? 0.1 : 0.3;

    topChunks = rankedChunks
      .filter(({ similarity }) => similarity >= minSimilarity)
      .slice(0, maxChunks)
      .map(({ chunk }) => ({
        text: chunk.text,
        startPosition: chunk.startPosition,
        id: chunk.id,
      }));
      
    if (topChunks.length === 0) {
      topChunks = chunks.slice(0, maxChunks)
        .map(chunk => ({
          text: chunk.text,
          startPosition: chunk.startPosition,
          id: chunk.id,
        }));
    }
  } catch (embeddingError) {
    console.warn("Embedding-based ranking failed, using document order:", embeddingError);
    topChunks = chunks.slice(0, maxChunks)
      .map(chunk => ({
        text: chunk.text,
        startPosition: chunk.startPosition,
        id: chunk.id,
      }));
  }

  console.log(`Analyzing ${topChunks.length} of ${chunks.length} chunks (${thoroughness} mode)`);

  const existingAnnotations = await projectStorage.getProjectAnnotationsByDocument(projectDocId);
  const existingUserAnnotations = existingAnnotations.filter((annotation) => !annotation.isAiGenerated);
  const existingAnnotationPositions = existingUserAnnotations
    .map(a => ({
      startPosition: a.startPosition,
      endPosition: a.endPosition,
      confidenceScore: a.confidenceScore,
    }));

  // Use V2 pipeline for improved annotation quality
  let pipelineAnnotations: Awaited<ReturnType<typeof processChunksWithPipelineV2>> = [];
  try {
    pipelineAnnotations = await processChunksWithPipelineV2(
      topChunks,
      fullIntent,
      doc.id,
      doc.fullText,
      existingAnnotationPositions
    );
  } catch (pipelineError) {
    console.error("[ProjectAnalyze] Pipeline failed", {
      projectDocumentId: projectDocId,
      documentId: doc.id,
      error: pipelineError instanceof Error ? pipelineError.message : String(pipelineError),
    });
    throw new Error("AI pipeline failed while processing document chunks");
  }

  if (constraints?.categories && constraints.categories.length > 0) {
    pipelineAnnotations = pipelineAnnotations.filter(
      ann => constraints.categories!.includes(ann.category as AnnotationCategory)
    );
  }

  if (constraints?.minConfidence) {
    pipelineAnnotations = pipelineAnnotations.filter(
      ann => ann.confidence >= constraints.minConfidence!
    );
  }

  if (constraints?.maxAnnotationsPerDoc) {
    pipelineAnnotations = pipelineAnnotations.slice(0, constraints.maxAnnotationsPerDoc);
  }

  // Replace prior AI annotations for single-prompt runs while preserving manual/user annotations.
  const priorAiAnnotations = existingAnnotations.filter((annotation) => annotation.isAiGenerated);
  if (pipelineAnnotations.length > 0 && priorAiAnnotations.length > 0) {
    await Promise.all(priorAiAnnotations.map((annotation) => projectStorage.deleteProjectAnnotation(annotation.id)));
  }

  for (const ann of pipelineAnnotations) {
    const created = await projectStorage.createProjectAnnotation({
      projectDocumentId: projectDocId,
      startPosition: ann.absoluteStart,
      endPosition: ann.absoluteEnd,
      highlightedText: ann.highlightText,
      category: ann.category as AnnotationCategory,
      note: ann.note,
      isAiGenerated: true,
      confidenceScore: ann.confidence,
    });
    
    generateSearchableContent(ann.highlightText, ann.note, ann.category as AnnotationCategory)
      .then(searchableContent => {
        projectStorage.updateProjectAnnotation(created.id, { searchableContent });
      })
      .catch(err => console.warn("Search indexing failed (non-blocking):", err));
  }

  return { 
    annotationsCreated: pipelineAnnotations.length,
    filename: doc.filename,
    chunksAnalyzed: topChunks.length,
    totalChunks: chunks.length,
  };
}

/** Verify the project belongs to the requesting user. Returns the project or sends 403/404. */
async function verifyProjectOwnership(req: Request, res: Response, projectId: string) {
  const project = await projectStorage.getProject(projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return null;
  }
  if ((project as any).userId && (project as any).userId !== req.user!.userId) {
    res.status(403).json({ error: "Access denied" });
    return null;
  }
  return project;
}

/** Verify a project_document exists and belongs to the requesting user. */
async function verifyProjectDocumentOwnership(req: Request, res: Response, projectDocumentId: string) {
  const projectDoc = await projectStorage.getProjectDocument(projectDocumentId);
  if (!projectDoc) {
    res.status(404).json({ error: "Project document not found" });
    return null;
  }

  const project = await verifyProjectOwnership(req, res, projectDoc.projectId);
  if (!project) {
    return null;
  }

  return projectDoc;
}

export function registerProjectRoutes(app: Express): void {
  // === PROJECTS ===

  app.post("/api/projects", requireAuth, async (req: Request, res: Response) => {
    try {
      const validated = insertProjectSchema.parse(req.body);
      const project = await projectStorage.createProject({ ...validated, userId: req.user!.userId } as any);
      
      // Context generation is optional - don't block project creation
      if (validated.thesis && validated.scope) {
        try {
          const contextSummary = await generateProjectContextSummary(validated.thesis, validated.scope, []);
          // Embeddings may not be available, store context summary without embedding
          await projectStorage.updateProject(project.id, { contextSummary });
        } catch (contextError) {
          console.warn("Context generation failed (non-blocking):", contextError);
        }
      }
      
      res.status(201).json(project);
    } catch (error) {
      console.error("Error creating project:", error);
      res.status(400).json({ error: "Failed to create project" });
    }
  });

  app.get("/api/projects", requireAuth, async (req: Request, res: Response) => {
    try {
      const projects = await projectStorage.getAllProjects(req.user!.userId);
      res.json(projects);
    } catch (error) {
      console.error("Error fetching projects:", error);
      res.status(500).json({ error: "Failed to fetch projects" });
    }
  });

  app.get("/api/projects/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const project = await verifyProjectOwnership(req, res, req.params.id);
      if (!project) return;
      res.json(project);
    } catch (error) {
      console.error("Error fetching project:", error);
      res.status(500).json({ error: "Failed to fetch project" });
    }
  });

  app.put("/api/projects/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const project = await verifyProjectOwnership(req, res, req.params.id);
      if (!project) return;
      const updated = await projectStorage.updateProject(req.params.id, req.body);
      if (!updated) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      // Context generation is optional - don't block project update
      if (req.body.thesis || req.body.scope) {
        try {
          const projectDocs = await projectStorage.getProjectDocumentsByProject(req.params.id);
          const docContexts = projectDocs
            .map(pd => pd.retrievalContext)
            .filter((c): c is string => !!c);
          
          const contextSummary = await generateProjectContextSummary(
            updated.thesis || "",
            updated.scope || "",
            docContexts
          );
          await projectStorage.updateProject(req.params.id, { contextSummary });
        } catch (contextError) {
          console.warn("Context generation failed (non-blocking):", contextError);
        }
      }
      
      res.json(updated);
    } catch (error) {
      console.error("Error updating project:", error);
      res.status(500).json({ error: "Failed to update project" });
    }
  });

  app.delete("/api/projects/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const project = await verifyProjectOwnership(req, res, req.params.id);
      if (!project) return;
      await projectStorage.deleteProject(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting project:", error);
      res.status(500).json({ error: "Failed to delete project" });
    }
  });

  // === PROMPT TEMPLATES ===

  app.post("/api/projects/:projectId/prompt-templates", requireAuth, async (req: Request, res: Response) => {
    try {
      const { name, prompts } = req.body;
      if (!name || typeof name !== "string") {
        return res.status(400).json({ error: "Template name is required" });
      }
      if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
        return res.status(400).json({ error: "At least one prompt is required" });
      }

      const template = await projectStorage.createPromptTemplate({
        projectId: req.params.projectId,
        name,
        prompts,
      });
      res.status(201).json(template);
    } catch (error) {
      console.error("Error creating prompt template:", error);
      res.status(500).json({ error: "Failed to create prompt template" });
    }
  });

  app.get("/api/projects/:projectId/prompt-templates", requireAuth, async (req: Request, res: Response) => {
    try {
      const templates = await projectStorage.getPromptTemplatesByProject(req.params.projectId);
      res.json(templates);
    } catch (error) {
      console.error("Error fetching prompt templates:", error);
      res.status(500).json({ error: "Failed to fetch prompt templates" });
    }
  });

  app.put("/api/prompt-templates/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { name, prompts } = req.body;
      const updated = await projectStorage.updatePromptTemplate(req.params.id, {
        ...(name && { name }),
        ...(prompts && { prompts }),
      });
      if (!updated) {
        return res.status(404).json({ error: "Template not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating prompt template:", error);
      res.status(500).json({ error: "Failed to update prompt template" });
    }
  });

  app.delete("/api/prompt-templates/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      await projectStorage.deletePromptTemplate(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting prompt template:", error);
      res.status(500).json({ error: "Failed to delete prompt template" });
    }
  });

  // === FOLDERS ===

  app.post("/api/projects/:projectId/folders", requireAuth, async (req: Request, res: Response) => {
    try {
      const validated = insertFolderSchema.parse({
        ...req.body,
        projectId: req.params.projectId,
      });
      const folder = await projectStorage.createFolder(validated);
      res.status(201).json(folder);
    } catch (error) {
      console.error("Error creating folder:", error);
      res.status(400).json({ error: "Failed to create folder" });
    }
  });

  app.get("/api/projects/:projectId/folders", requireAuth, async (req: Request, res: Response) => {
    try {
      const folders = await projectStorage.getFoldersByProject(req.params.projectId);
      res.json(folders);
    } catch (error) {
      console.error("Error fetching folders:", error);
      res.status(500).json({ error: "Failed to fetch folders" });
    }
  });

  app.put("/api/folders/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const updated = await projectStorage.updateFolder(req.params.id, req.body);
      if (!updated) {
        return res.status(404).json({ error: "Folder not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating folder:", error);
      res.status(500).json({ error: "Failed to update folder" });
    }
  });

  app.delete("/api/folders/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      await projectStorage.deleteFolder(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting folder:", error);
      res.status(500).json({ error: "Failed to delete folder" });
    }
  });

  app.put("/api/folders/:id/move", requireAuth, async (req: Request, res: Response) => {
    try {
      const { parentFolderId } = req.body;
      const updated = await projectStorage.moveFolder(req.params.id, parentFolderId || null);
      if (!updated) {
        return res.status(404).json({ error: "Folder not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error moving folder:", error);
      res.status(500).json({ error: "Failed to move folder" });
    }
  });

  // === PROJECT DOCUMENTS ===

  app.post("/api/projects/:projectId/documents", requireAuth, async (req: Request, res: Response) => {
    try {
      const validated = insertProjectDocumentSchema.parse({
        ...req.body,
        projectId: req.params.projectId,
      });

      const projectDoc = await projectStorage.addDocumentToProject(validated);

      // Context and citation generation - don't block document addition
      try {
        const doc = await storage.getDocument(validated.documentId);
        const project = await projectStorage.getProject(req.params.projectId);

        if (doc && project) {
          // Generate retrieval context
          const retrievalContext = await generateRetrievalContext(
            doc.summary || "",
            doc.mainArguments || [],
            doc.keyConcepts || [],
            project.thesis || "",
            validated.roleInProject || ""
          );

          // Auto-extract citation metadata using AI
          let citationData = null;
          try {
            citationData = await extractCitationMetadata(doc.fullText);
            console.log(`[Citation] Auto-extracted citation for ${doc.filename}`);
          } catch (citationError) {
            console.warn("Citation extraction failed (non-blocking):", citationError);
          }

          await projectStorage.updateProjectDocument(projectDoc.id, {
            retrievalContext,
            ...(citationData && { citationData }),
          });
        }
      } catch (contextError) {
        console.warn("Context generation failed (non-blocking):", contextError);
      }

      res.status(201).json(projectDoc);
    } catch (error) {
      console.error("Error adding document to project:", error);
      res.status(400).json({ error: "Failed to add document to project" });
    }
  });

  app.get("/api/projects/:projectId/documents", requireAuth, async (req: Request, res: Response) => {
    try {
      const documents = await projectStorage.getProjectDocumentsByProject(req.params.projectId);
      res.json(documents);
    } catch (error) {
      console.error("Error fetching project documents:", error);
      res.status(500).json({ error: "Failed to fetch project documents" });
    }
  });

  app.post("/api/projects/:projectId/documents/batch", requireAuth, async (req: Request, res: Response) => {
    try {
      const validated = batchAddDocumentsRequestSchema.parse(req.body);
      const { documentIds, folderId } = validated;
      const projectId = req.params.projectId;

      const project = await projectStorage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const existingDocs = await projectStorage.getProjectDocumentsByProject(projectId);
      const existingDocIds = new Set(existingDocs.map(d => d.documentId));

      const results: BatchAddDocumentResult[] = [];
      let added = 0;
      let alreadyExists = 0;
      let failed = 0;

      for (const documentId of documentIds) {
        try {
          const doc = await storage.getDocument(documentId);
          if (!doc) {
            results.push({
              documentId,
              filename: "Unknown",
              status: "failed",
              error: "Document not found",
            });
            failed++;
            continue;
          }

          if (existingDocIds.has(documentId)) {
            results.push({
              documentId,
              filename: doc.filename,
              status: "already_exists",
            });
            alreadyExists++;
            continue;
          }

          const projectDoc = await projectStorage.addDocumentToProject({
            projectId,
            documentId,
            folderId: folderId || null,
          });

          results.push({
            documentId,
            filename: doc.filename,
            status: "added",
            projectDocumentId: projectDoc.id,
          });
          added++;
          existingDocIds.add(documentId);

          generateRetrievalContext(
            doc.summary || "",
            doc.mainArguments || [],
            doc.keyConcepts || [],
            project.thesis || "",
            ""
          )
            .then(retrievalContext => {
              projectStorage.updateProjectDocument(projectDoc.id, { retrievalContext });
            })
            .catch(err => console.warn("Context generation failed (non-blocking):", err));
        } catch (error) {
          results.push({
            documentId,
            filename: "Unknown",
            status: "failed",
            error: error instanceof Error ? error.message : "Unknown error",
          });
          failed++;
        }
      }

      const response: BatchAddDocumentsResponse = {
        totalRequested: documentIds.length,
        added,
        alreadyExists,
        failed,
        results,
      };

      res.status(201).json(response);
    } catch (error) {
      console.error("Error in batch add documents:", error);
      res.status(400).json({ error: "Failed to add documents" });
    }
  });

  app.get("/api/project-documents/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectDoc = await verifyProjectDocumentOwnership(req, res, req.params.id);
      if (!projectDoc) return;
      res.json(projectDoc);
    } catch (error) {
      console.error("Error fetching project document:", error);
      res.status(500).json({ error: "Failed to fetch project document" });
    }
  });

  app.put("/api/project-documents/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectDoc = await verifyProjectDocumentOwnership(req, res, req.params.id);
      if (!projectDoc) return;
      const { sourceRole, ...otherFields } = req.body ?? {};

      if (sourceRole !== undefined && sourceRole !== null && !isSourceRole(sourceRole)) {
        return res.status(400).json({ error: "Invalid sourceRole" });
      }

      let updated = Object.keys(otherFields).length > 0
        ? await projectStorage.updateProjectDocument(req.params.id, otherFields)
        : await projectStorage.getProjectDocument(req.params.id);

      if (sourceRole && isSourceRole(sourceRole)) {
        const [sourceRoleUpdated] = await db
          .update(projectDocuments)
          .set({ sourceRole })
          .where(eq(projectDocuments.id, req.params.id))
          .returning();
        updated = sourceRoleUpdated;
      }

      if (!updated) {
        return res.status(404).json({ error: "Project document not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating project document:", error);
      res.status(500).json({ error: "Failed to update project document" });
    }
  });

  app.delete("/api/project-documents/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectDoc = await verifyProjectDocumentOwnership(req, res, req.params.id);
      if (!projectDoc) return;
      await projectStorage.removeDocumentFromProject(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error removing document from project:", error);
      res.status(500).json({ error: "Failed to remove document from project" });
    }
  });

  app.put("/api/project-documents/:id/move", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectDoc = await verifyProjectDocumentOwnership(req, res, req.params.id);
      if (!projectDoc) return;
      const { folderId } = req.body;
      const updated = await projectStorage.updateProjectDocument(req.params.id, {
        folderId: folderId || null,
      });
      if (!updated) {
        return res.status(404).json({ error: "Project document not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error moving project document:", error);
      res.status(500).json({ error: "Failed to move project document" });
    }
  });

  app.put("/api/project-documents/:id/citation", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectDoc = await verifyProjectDocumentOwnership(req, res, req.params.id);
      if (!projectDoc) return;
      const citationData = citationDataSchema.parse(req.body);
      const updated = await projectStorage.updateProjectDocument(req.params.id, {
        citationData,
      });
      if (!updated) {
        return res.status(404).json({ error: "Project document not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating citation data:", error);
      res.status(400).json({ error: "Failed to update citation data" });
    }
  });

  // === PROJECT ANNOTATIONS ===

  app.post("/api/project-documents/:id/annotations", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectDoc = await verifyProjectDocumentOwnership(req, res, req.params.id);
      if (!projectDoc) return;
      const validated = insertProjectAnnotationSchema.parse({
        ...req.body,
        projectDocumentId: req.params.id,
      });
      
      const annotation = await projectStorage.createProjectAnnotation(validated);
      
      // Search indexing is optional - don't block annotation creation
      try {
        const searchableContent = await generateSearchableContent(
          validated.highlightedText,
          validated.note || null,
          validated.category
        );
        await projectStorage.updateProjectAnnotation(annotation.id, {
          searchableContent,
        });
      } catch (indexError) {
        console.warn("Search indexing failed (non-blocking):", indexError);
      }
      
      res.status(201).json(annotation);
    } catch (error) {
      console.error("Error creating project annotation:", error);
      res.status(400).json({ error: "Failed to create annotation" });
    }
  });

  app.get("/api/project-documents/:id/annotations", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectDoc = await verifyProjectDocumentOwnership(req, res, req.params.id);
      if (!projectDoc) return;
      const annotations = await projectStorage.getProjectAnnotationsByDocument(req.params.id);
      res.json(annotations);
    } catch (error) {
      console.error("Error fetching project annotations:", error);
      res.status(500).json({ error: "Failed to fetch annotations" });
    }
  });

  app.put("/api/project-annotations/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const annotation = await projectStorage.getProjectAnnotation(req.params.id);
      if (!annotation) {
        return res.status(404).json({ error: "Annotation not found" });
      }

      const projectDoc = await verifyProjectDocumentOwnership(req, res, annotation.projectDocumentId);
      if (!projectDoc) return;

      const updated = await projectStorage.updateProjectAnnotation(req.params.id, req.body);
      if (!updated) {
        return res.status(404).json({ error: "Annotation not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating project annotation:", error);
      res.status(500).json({ error: "Failed to update annotation" });
    }
  });

  app.delete("/api/project-annotations/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const annotation = await projectStorage.getProjectAnnotation(req.params.id);
      if (!annotation) {
        return res.status(404).json({ error: "Annotation not found" });
      }

      const projectDoc = await verifyProjectDocumentOwnership(req, res, annotation.projectDocumentId);
      if (!projectDoc) return;

      await projectStorage.deleteProjectAnnotation(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting project annotation:", error);
      res.status(500).json({ error: "Failed to delete annotation" });
    }
  });

  // === AI ANALYSIS ===

  app.post("/api/project-documents/:id/analyze", requireAuth, async (req: Request, res: Response) => {
    try {
      const { intent, thoroughness } = req.body;
      if (!intent || typeof intent !== "string") {
        return res.status(400).json({ error: "Research intent is required" });
      }

      const projectDoc = await verifyProjectDocumentOwnership(req, res, req.params.id);
      if (!projectDoc) return;

      const validThoroughness = ['quick', 'standard', 'thorough', 'exhaustive'].includes(thoroughness) 
        ? thoroughness as ThoroughnessLevel 
        : 'standard';

      const startTime = Date.now();
      console.log("[ProjectAnalyze] Starting single-prompt analysis", {
        projectDocumentId: req.params.id,
        projectId: projectDoc.projectId,
        documentId: projectDoc.documentId,
        userId: req.user?.userId,
        thoroughness: validThoroughness,
      });

      const result = await analyzeProjectDocument(req.params.id, intent, { thoroughness: validThoroughness });
      const finalAnnotations = await projectStorage.getProjectAnnotationsByDocument(req.params.id);

      console.log("[ProjectAnalyze] Completed single-prompt analysis", {
        projectDocumentId: req.params.id,
        chunksAnalyzed: result.chunksAnalyzed,
        totalChunks: result.totalChunks,
        annotationsCreated: result.annotationsCreated,
        totalAnnotationsOnDocument: finalAnnotations.length,
        durationMs: Date.now() - startTime,
      });
      
      res.json({
        annotations: finalAnnotations,
        stats: {
          chunksAnalyzed: result.chunksAnalyzed,
          totalChunks: result.totalChunks,
          annotationsCreated: result.annotationsCreated,
          coverage: Math.round((result.chunksAnalyzed / result.totalChunks) * 100),
        }
      });
    } catch (error) {
      console.error("Error analyzing project document:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to analyze document" });
    }
  });

  // Multi-prompt parallel analysis
  app.post("/api/project-documents/:id/analyze-multi", requireAuth, requireTier("max"), async (req: Request, res: Response) => {
    try {
      const { prompts, thoroughness } = req.body;

      if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
        return res.status(400).json({ error: "At least one prompt is required" });
      }

      // Validate prompts structure
      for (const prompt of prompts) {
        if (!prompt.text || typeof prompt.text !== "string") {
          return res.status(400).json({ error: "Each prompt must have a text field" });
        }
      }

      const validThoroughness = ['quick', 'standard', 'thorough', 'exhaustive'].includes(thoroughness)
        ? thoroughness as ThoroughnessLevel
        : 'standard';

      const projectDocId = req.params.id;
      const projectDoc = await verifyProjectDocumentOwnership(req, res, projectDocId);
      if (!projectDoc) return;

      const doc = await storage.getDocument(projectDoc.documentId);
      if (!doc) {
        return res.status(404).json({ error: "Document not found" });
      }

      const project = await projectStorage.getProject(projectDoc.projectId);
      const chunks = await storage.getChunksForDocument(doc.id);

      if (chunks.length === 0) {
        return res.status(400).json({ error: "No text chunks found for analysis" });
      }

      // Rank chunks by similarity (using first prompt for ranking, or document order)
      const maxChunks = getMaxChunksForLevel(validThoroughness);
      let topChunks: { text: string; startPosition: number; id: string }[];

      try {
        const firstPromptIntent = project?.thesis
          ? `Project thesis: ${project.thesis}\n\nResearch focus: ${prompts[0].text}`
          : prompts[0].text;
        const intentEmbedding = await getEmbedding(firstPromptIntent);

        const chunksWithEmbeddings = await Promise.all(
          chunks.map(async (chunk) => {
            if (!chunk.embedding) {
              try {
                const embedding = await getEmbedding(chunk.text);
                await storage.updateChunkEmbedding(chunk.id, embedding);
                return { ...chunk, embedding };
              } catch {
                return chunk;
              }
            }
            return chunk;
          })
        );

        const rankedChunks = chunksWithEmbeddings
          .filter(c => c.embedding)
          .map((chunk) => ({
            chunk,
            similarity: cosineSimilarity(chunk.embedding!, intentEmbedding),
          }))
          .sort((a, b) => b.similarity - a.similarity);

        const minSimilarity = validThoroughness === 'exhaustive' ? 0.1 : 0.3;
        topChunks = rankedChunks
          .filter(({ similarity }) => similarity >= minSimilarity)
          .slice(0, maxChunks)
          .map(({ chunk }) => ({
            text: chunk.text,
            startPosition: chunk.startPosition,
            id: chunk.id,
          }));

        if (topChunks.length === 0) {
          topChunks = chunks.slice(0, maxChunks).map(chunk => ({
            text: chunk.text,
            startPosition: chunk.startPosition,
            id: chunk.id,
          }));
        }
      } catch {
        topChunks = chunks.slice(0, maxChunks).map(chunk => ({
          text: chunk.text,
          startPosition: chunk.startPosition,
          id: chunk.id,
        }));
      }

      // Keep both user and prior AI annotations so analyses can accumulate over time.
      const existingAnnotations = await projectStorage.getProjectAnnotationsByDocument(projectDocId);
      const existingAnnotationPositions = existingAnnotations
        .map(a => ({
          startPosition: a.startPosition,
          endPosition: a.endPosition,
          confidenceScore: a.confidenceScore,
        }));

      // Ensure prompt indices continue across runs so prior prompt groups remain distinct.
      const maxExistingPromptIndex = existingAnnotations.reduce((max, ann) => {
        if (ann.promptIndex == null) return max;
        return ann.promptIndex > max ? ann.promptIndex : max;
      }, -1);
      const promptIndexBase = maxExistingPromptIndex + 1;

      // Prepare prompts with colors and indices
      const promptsWithMeta = prompts.map((p: { text: string; color?: string }, localIndex: number) => ({
        text: project?.thesis
          ? `Project thesis: ${project.thesis}\n\nResearch focus: ${p.text}`
          : p.text,
        color: p.color || getDefaultPromptColor(promptIndexBase + localIndex),
        index: promptIndexBase + localIndex,
        localIndex,
      }));

      // Generate analysis run ID
      const analysisRunId = randomUUID();

      const startTime = Date.now();
      console.log(`Multi-prompt analysis: ${prompts.length} prompts on ${topChunks.length} chunks`);
      console.log("[ProjectAnalyze] Starting multi-prompt analysis", {
        analysisRunId,
        projectDocumentId: projectDocId,
        projectId: projectDoc.projectId,
        documentId: projectDoc.documentId,
        promptCount: prompts.length,
        chunksAnalyzed: topChunks.length,
        totalChunks: chunks.length,
        userId: req.user?.userId,
        thoroughness: validThoroughness,
      });

      // Run all prompts in parallel
      const resultsMap = await processChunksWithMultiplePrompts(
        topChunks,
        promptsWithMeta,
        doc.id,
        doc.fullText,
        existingAnnotationPositions
      );

      // Create annotations with prompt metadata
      const results: Array<{ promptIndex: number; promptText: string; annotationsCreated: number }> = [];
      let totalAnnotations = 0;

      for (const [promptIndex, annotations] of Array.from(resultsMap.entries())) {
        const promptMeta = promptsWithMeta.find((p) => p.index === promptIndex);
        if (!promptMeta) continue;
        const originalPrompt = prompts[promptMeta.localIndex];
        let created = 0;

        for (const ann of annotations) {
          await projectStorage.createProjectAnnotation({
            projectDocumentId: projectDocId,
            startPosition: ann.absoluteStart,
            endPosition: ann.absoluteEnd,
            highlightedText: ann.highlightText,
            category: ann.category as AnnotationCategory,
            note: ann.note,
            isAiGenerated: true,
            confidenceScore: ann.confidence,
            promptText: originalPrompt.text,
            promptIndex,
            promptColor: promptMeta.color,
            analysisRunId,
          });
          created++;
        }

        results.push({
          promptIndex,
          promptText: originalPrompt.text,
          annotationsCreated: created,
        });
        totalAnnotations += created;
      }

      const finalAnnotations = await projectStorage.getProjectAnnotationsByDocument(projectDocId);
      console.log("[ProjectAnalyze] Completed multi-prompt analysis", {
        analysisRunId,
        projectDocumentId: projectDocId,
        promptCount: prompts.length,
        totalAnnotationsCreated: totalAnnotations,
        totalAnnotationsOnDocument: finalAnnotations.length,
        durationMs: Date.now() - startTime,
      });

      res.json({
        analysisRunId,
        results,
        totalAnnotations,
        annotations: finalAnnotations,
        stats: {
          chunksAnalyzed: topChunks.length,
          totalChunks: chunks.length,
          coverage: Math.round((topChunks.length / chunks.length) * 100),
        },
      });
    } catch (error) {
      console.error("Error in multi-prompt analysis:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to analyze document" });
    }
  });

  app.post("/api/projects/:projectId/batch-analyze", requireAuth, requireTier("max"), async (req: Request, res: Response) => {
    try {
      const validated = batchAnalysisRequestSchema.parse(req.body);
      const { projectDocumentIds, intent, thoroughness, constraints } = validated;
      
      const startTime = Date.now();
      const jobId = crypto.randomUUID();
      
      const project = await projectStorage.getProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const results: BatchDocumentResult[] = projectDocumentIds.map(id => ({
        projectDocumentId: id,
        filename: "",
        status: "pending" as const,
        annotationsCreated: 0,
      }));

      await batchProcess(
        projectDocumentIds,
        async (docId, index) => {
          try {
            const result = await analyzeProjectDocument(docId, intent, { 
              ...constraints, 
              thoroughness: thoroughness as ThoroughnessLevel 
            });
            results[index] = {
              projectDocumentId: docId,
              filename: result.filename,
              status: "completed",
              annotationsCreated: result.annotationsCreated,
            };
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : "Unknown error";
            results[index] = {
              projectDocumentId: docId,
              filename: results[index].filename || "Unknown",
              status: "failed",
              annotationsCreated: 0,
              error: errorMsg,
            };
          }
        },
        { concurrency: 2 }
      );

      const successfulDocs = results.filter(r => r.status === "completed").length;
      const failedDocs = results.filter(r => r.status === "failed").length;
      const totalAnnotations = results.reduce((sum, r) => sum + r.annotationsCreated, 0);

      const response: BatchAnalysisResponse = {
        jobId,
        status: failedDocs === 0 ? "completed" : successfulDocs === 0 ? "failed" : "partial",
        totalDocuments: projectDocumentIds.length,
        successfulDocuments: successfulDocs,
        failedDocuments: failedDocs,
        totalAnnotationsCreated: totalAnnotations,
        totalTimeMs: Date.now() - startTime,
        results,
      };

      res.json(response);
    } catch (error) {
      console.error("Error in batch analysis:", error);
      res.status(500).json({ error: "Failed to process batch analysis" });
    }
  });

  // === SEARCH ===

  app.post("/api/projects/:projectId/search", requireAuth, async (req: Request, res: Response) => {
    try {
      const { query, filters, limit } = req.body;

      if (!query || typeof query !== "string") {
        return res.status(400).json({ error: "Query is required" });
      }

      const results = await globalSearch(req.params.projectId, query, filters, limit);
      res.json(results);
    } catch (error) {
      console.error("Error performing search:", error);
      res.status(500).json({ error: "Failed to perform search" });
    }
  });

  // Search within a single project document
  app.post("/api/project-documents/:id/search", requireAuth, async (req: Request, res: Response) => {
    try {
      const { query } = req.body;

      if (!query || typeof query !== "string") {
        return res.status(400).json({ error: "Query is required" });
      }

      const projectDoc = await verifyProjectDocumentOwnership(req, res, req.params.id);
      if (!projectDoc) return;

      const results = await searchProjectDocument(req.params.id, query);
      res.json(results);
    } catch (error) {
      console.error("Error searching project document:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to search document" });
    }
  });

  // === CITATIONS ===

  app.post("/api/citations/generate", requireAuth, async (req: Request, res: Response) => {
    try {
      const { citationData, style = "chicago", pageNumber, isSubsequent } = req.body;
      const validated = citationDataSchema.parse(citationData);
      const validStyle: CitationStyle = (citationStyles as readonly string[]).includes(style) ? style as CitationStyle : "chicago";

      const footnote = generateFootnote(validated, validStyle, pageNumber, isSubsequent);
      const bibliography = generateBibliographyEntry(validated, validStyle);
      const inlineCitation = generateInTextCitation(validated, validStyle, pageNumber);

      res.json({ footnote, bibliography, inlineCitation, style: validStyle });
    } catch (error) {
      console.error("Error generating citation:", error);
      res.status(400).json({ error: "Failed to generate citation" });
    }
  });

  app.post("/api/citations/ai", requireAuth, async (req: Request, res: Response) => {
    try {
      const { documentId, highlightedText, style = "chicago" } = req.body;
      const validStyle: CitationStyle = (citationStyles as readonly string[]).includes(style) ? style as CitationStyle : "chicago";

      if (!documentId) {
        return res.status(400).json({ error: "Document ID is required" });
      }

      const document = await storage.getDocument(documentId);
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      const citationData = await extractCitationMetadata(document.fullText, highlightedText);

      if (!citationData) {
        return res.status(422).json({
          error: "Unable to extract citation metadata from document",
          footnote: `"${highlightedText?.substring(0, 100) || 'Quote'}..." (Source: ${document.filename})`,
          bibliography: `${document.filename}. [Citation metadata unavailable]`
        });
      }

      const footnote = generateFootnote(citationData, validStyle);
      const bibliography = generateBibliographyEntry(citationData, validStyle);

      res.json({ footnote, bibliography, citationData });
    } catch (error) {
      console.error("Error generating AI citation:", error);
      res.status(500).json({ error: "Failed to generate citation" });
    }
  });

  // Generate footnote with embedded quote for an annotation
  app.post("/api/citations/footnote-with-quote", requireAuth, async (req: Request, res: Response) => {
    try {
      const { citationData, quote, pageNumber, style = "chicago" } = req.body;
      const validStyle: CitationStyle = (citationStyles as readonly string[]).includes(style) ? style as CitationStyle : "chicago";

      if (!quote) {
        return res.status(400).json({ error: "Quote text is required" });
      }

      if (!citationData) {
        // Fallback if no citation data: return a generic quote format
        const cleanQuote = quote.trim().replace(/\s+/g, ' ');
        const displayQuote = cleanQuote.length > 150
          ? cleanQuote.substring(0, 147) + '...'
          : cleanQuote;
        return res.json({
          footnote: `"${displayQuote}."`,
          footnoteWithQuote: `"${displayQuote}."`,
          inlineCitation: "(Source unavailable)",
          bibliography: "[Citation metadata unavailable]"
        });
      }

      const validated = citationDataSchema.parse(citationData);

      const footnote = generateFootnote(validated, validStyle, pageNumber);
      const footnoteWithQuote = generateFootnoteWithQuote(validated, quote, pageNumber);
      const inlineCitation = generateInTextCitation(validated, validStyle, pageNumber);
      const bibliography = generateBibliographyEntry(validated, validStyle);

      res.json({
        footnote,
        footnoteWithQuote,
        inlineCitation,
        bibliography
      });
    } catch (error) {
      console.error("Error generating footnote with quote:", error);
      res.status(400).json({ error: "Failed to generate footnote" });
    }
  });

  // Generate footnote for a specific annotation by ID
  app.post("/api/project-annotations/:id/footnote", requireAuth, async (req: Request, res: Response) => {
    try {
      const annotation = await projectStorage.getProjectAnnotation(req.params.id);
      if (!annotation) {
        return res.status(404).json({ error: "Annotation not found" });
      }

      const projectDoc = await verifyProjectDocumentOwnership(req, res, annotation.projectDocumentId);
      if (!projectDoc) return;

      const { pageNumber, style = "chicago" } = req.body;
      const validStyle: CitationStyle = (citationStyles as readonly string[]).includes(style) ? style as CitationStyle : "chicago";

      // Use citation data from the project document
      const citationData = projectDoc.citationData;

      if (!citationData) {
        // Try to extract citation on-the-fly
        const doc = await storage.getDocument(projectDoc.documentId);
        if (doc) {
          const extractedCitation = await extractCitationMetadata(doc.fullText, annotation.highlightedText);
          if (extractedCitation) {
            // Save for future use
            await projectStorage.updateProjectDocument(projectDoc.id, { citationData: extractedCitation });

            const footnoteWithQuote = generateFootnoteWithQuote(extractedCitation, annotation.highlightedText, pageNumber);
            const footnote = generateFootnote(extractedCitation, validStyle, pageNumber);
            const inlineCitation = generateInTextCitation(extractedCitation, validStyle, pageNumber);
            const bibliography = generateBibliographyEntry(extractedCitation, validStyle);

            return res.json({
              footnote,
              footnoteWithQuote,
              inlineCitation,
              bibliography,
              citationData: extractedCitation
            });
          }
        }

        // Fallback
        const cleanQuote = annotation.highlightedText.trim().replace(/\s+/g, ' ');
        const displayQuote = cleanQuote.length > 150
          ? cleanQuote.substring(0, 147) + '...'
          : cleanQuote;
        const docName = doc?.filename || "Unknown Source";

        return res.json({
          footnote: `${docName}.`,
          footnoteWithQuote: `${docName}: "${displayQuote}."`,
          inlineCitation: `(${docName})`,
          bibliography: `${docName}. [Citation metadata unavailable]`,
          citationData: null
        });
      }

      const footnoteWithQuote = generateFootnoteWithQuote(citationData as CitationData, annotation.highlightedText, pageNumber);
      const footnote = generateFootnote(citationData as CitationData, validStyle, pageNumber);
      const inlineCitation = generateInTextCitation(citationData as CitationData, validStyle, pageNumber);
      const bibliography = generateBibliographyEntry(citationData as CitationData, validStyle);

      res.json({
        footnote,
        footnoteWithQuote,
        inlineCitation,
        bibliography,
        citationData
      });
    } catch (error) {
      console.error("Error generating annotation footnote:", error);
      res.status(500).json({ error: "Failed to generate footnote" });
    }
  });

  // === STATE PERSISTENCE ===

  app.put("/api/project-documents/:id/view-state", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectDoc = await verifyProjectDocumentOwnership(req, res, req.params.id);
      if (!projectDoc) return;

      const { scrollPosition } = req.body;
      const updated = await projectStorage.updateProjectDocument(req.params.id, {
        lastViewedAt: new Date(),
        scrollPosition: scrollPosition || 0,
      });
      if (!updated) {
        return res.status(404).json({ error: "Project document not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating view state:", error);
      res.status(500).json({ error: "Failed to update view state" });
    }
  });
}
