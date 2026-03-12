import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { randomUUID } from "crypto";

// Helper to generate UUID
const genId = () => randomUUID();

// Annotation category enum values
export const annotationCategories = [
  "key_quote",
  "argument",
  "evidence",
  "methodology",
  "user_added"
] as const;

export type AnnotationCategory = typeof annotationCategories[number];

// Documents table
export const documents = sqliteTable("documents", {
  id: text("id").primaryKey().$defaultFn(genId),
  userId: text("user_id"),
  filename: text("filename").notNull(),
  fullText: text("full_text").notNull(),
  uploadDate: integer("upload_date", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  userIntent: text("user_intent"),
  summary: text("summary"),
  mainArguments: text("main_arguments", { mode: "json" }).$type<string[]>(),
  keyConcepts: text("key_concepts", { mode: "json" }).$type<string[]>(),
  chunkCount: integer("chunk_count").default(0).notNull(),
  status: text("status").notNull().default("ready"),
  processingError: text("processing_error"),
});

export const documentsRelations = relations(documents, ({ many }) => ({
  chunks: many(textChunks),
  annotations: many(annotations),
}));

// Text chunks table
export const textChunks = sqliteTable("text_chunks", {
  id: text("id").primaryKey().$defaultFn(genId),
  documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  startPosition: integer("start_position").notNull(),
  endPosition: integer("end_position").notNull(),
  sectionTitle: text("section_title"),
  embedding: text("embedding", { mode: "json" }).$type<number[]>(),
});

export const textChunksRelations = relations(textChunks, ({ one }) => ({
  document: one(documents, {
    fields: [textChunks.documentId],
    references: [documents.id],
  }),
}));

// Annotations table
export const annotations = sqliteTable("annotations", {
  id: text("id").primaryKey().$defaultFn(genId),
  documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  chunkId: text("chunk_id"),
  startPosition: integer("start_position").notNull(),
  endPosition: integer("end_position").notNull(),
  highlightedText: text("highlighted_text").notNull(),
  category: text("category").notNull().$type<AnnotationCategory>(),
  note: text("note").notNull(),
  isAiGenerated: integer("is_ai_generated", { mode: "boolean" }).default(false).notNull(),
  confidenceScore: real("confidence_score"),
  // Multi-prompt support
  promptText: text("prompt_text"),
  promptIndex: integer("prompt_index"),
  promptColor: text("prompt_color"),
  analysisRunId: text("analysis_run_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export const annotationsRelations = relations(annotations, ({ one }) => ({
  document: one(documents, {
    fields: [annotations.documentId],
    references: [documents.id],
  }),
}));

// Zod schemas and types
export const insertDocumentSchema = createInsertSchema(documents).omit({
  id: true,
  uploadDate: true,
  chunkCount: true,
  status: true,
  processingError: true,
});
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documents.$inferSelect;

export const insertTextChunkSchema = createInsertSchema(textChunks).omit({ id: true });
export type InsertTextChunk = z.infer<typeof insertTextChunkSchema>;
export type TextChunk = typeof textChunks.$inferSelect;

export const insertAnnotationSchema = createInsertSchema(annotations).omit({
  id: true,
  createdAt: true
});
export type InsertAnnotation = z.infer<typeof insertAnnotationSchema>;
export type Annotation = typeof annotations.$inferSelect;

// Search result type (not stored in DB)
export const searchResultSchema = z.object({
  quote: z.string(),
  startPosition: z.number(),
  endPosition: z.number(),
  explanation: z.string(),
  relevance: z.enum(["high", "medium", "low"]),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

// Analysis result type (from AI)
export const analysisResultSchema = z.object({
  isRelevant: z.boolean(),
  highlightText: z.string().optional(),
  category: z.enum(annotationCategories).optional(),
  note: z.string().optional(),
  confidence: z.number().optional(),
});
export type AnalysisResult = z.infer<typeof analysisResultSchema>;

// === PIPELINE TYPES ===

// Candidate from Generator (uses relative offsets within chunk)
export const candidateAnnotationSchema = z.object({
  highlightStart: z.number().int().min(0),
  highlightEnd: z.number().int().min(1),
  highlightText: z.string().min(1),
  category: z.enum(annotationCategories),
  note: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type CandidateAnnotation = z.infer<typeof candidateAnnotationSchema>;

// Generator response
export const generatorResponseSchema = z.object({
  candidates: z.array(candidateAnnotationSchema).max(5),
});
export type GeneratorResponse = z.infer<typeof generatorResponseSchema>;

// Verified candidate (after hard + soft verification)
export const verifiedCandidateSchema = candidateAnnotationSchema.extend({
  qualityScore: z.number().min(0).max(1),
  adjustedCategory: z.enum(annotationCategories).optional(),
  adjustedNote: z.string().optional(),
});
export type VerifiedCandidate = z.infer<typeof verifiedCandidateSchema>;

// Verifier response for a single candidate
export const verifierVerdictSchema = z.object({
  candidateIndex: z.number().int().min(0),
  approved: z.boolean(),
  qualityScore: z.number().min(0).max(1),
  adjustedCategory: z.enum(annotationCategories).optional(),
  adjustedNote: z.string().optional(),
  issues: z.array(z.string()).optional(),
});
export type VerifierVerdict = z.infer<typeof verifierVerdictSchema>;

// Verifier batch response
export const verifierResponseSchema = z.object({
  verdicts: z.array(verifierVerdictSchema),
});
export type VerifierResponse = z.infer<typeof verifierResponseSchema>;

// Refined annotation (final output)
export const refinedAnnotationSchema = z.object({
  highlightStart: z.number().int(),
  highlightEnd: z.number().int(),
  highlightText: z.string(),
  category: z.enum(annotationCategories),
  note: z.string(),
  confidence: z.number().min(0).max(1),
});
export type RefinedAnnotation = z.infer<typeof refinedAnnotationSchema>;

// Refiner response
export const refinerResponseSchema = z.object({
  refined: z.array(refinedAnnotationSchema),
});
export type RefinerResponse = z.infer<typeof refinerResponseSchema>;

// Document context for pipeline
export const documentContextSchema = z.object({
  summary: z.string(),
  keyConcepts: z.array(z.string()),
});
export type DocumentContext = z.infer<typeof documentContextSchema>;

// Final pipeline output with absolute positions
export const pipelineAnnotationSchema = z.object({
  absoluteStart: z.number().int(),
  absoluteEnd: z.number().int(),
  highlightText: z.string(),
  category: z.enum(annotationCategories),
  note: z.string(),
  confidence: z.number().min(0).max(1),
});
export type PipelineAnnotation = z.infer<typeof pipelineAnnotationSchema>;

// Users table
export const users = sqliteTable("users", {
  id: text("id").primaryKey().$defaultFn(genId),
  email: text("email").notNull().unique(),
  username: text("username").notNull().unique(),
  password: text("password").default(""), // legacy, unused with Clerk auth
  firstName: text("first_name"),
  lastName: text("last_name"),
  tier: text("tier").notNull().default("free"), // "free" | "pro" | "max"
  tokensUsed: integer("tokens_used").notNull().default(0),
  tokenLimit: integer("token_limit").notNull().default(50000), // 50K for free
  storageUsed: integer("storage_used").notNull().default(0), // bytes
  storageLimit: integer("storage_limit").notNull().default(52428800), // 50MB for free
  emailVerified: integer("email_verified", { mode: "boolean" }).default(false),
  billingCycleStart: integer("billing_cycle_start", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  username: true,
  password: true,
  firstName: true,
  lastName: true,
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const registerSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(30),
  password: z.string().min(8),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// === PROJECT STORAGE LAYER ===

// Citation style types
export const citationStyles = ["chicago", "mla", "apa"] as const;
export type CitationStyle = typeof citationStyles[number];

// Citation data type for Chicago-style citations
export interface CitationData {
  sourceType: 'book' | 'journal' | 'website' | 'newspaper' | 'chapter' | 'thesis' | 'other';
  authors: Array<{
    firstName: string;
    lastName: string;
    suffix?: string;
  }>;
  title: string;
  subtitle?: string;
  containerTitle?: string;
  publisher?: string;
  publicationPlace?: string;
  publicationDate?: string;
  volume?: string;
  issue?: string;
  pageStart?: string;
  pageEnd?: string;
  url?: string;
  accessDate?: string;
  doi?: string;
  edition?: string;
  editors?: Array<{
    firstName: string;
    lastName: string;
  }>;
}

export const citationDataSchema = z.object({
  sourceType: z.enum(['book', 'journal', 'website', 'newspaper', 'chapter', 'thesis', 'other']),
  authors: z.array(z.object({
    firstName: z.string(),
    lastName: z.string(),
    suffix: z.string().optional(),
  })),
  title: z.string(),
  subtitle: z.string().optional(),
  containerTitle: z.string().optional(),
  publisher: z.string().optional(),
  publicationPlace: z.string().optional(),
  publicationDate: z.string().optional(),
  volume: z.string().optional(),
  issue: z.string().optional(),
  pageStart: z.string().optional(),
  pageEnd: z.string().optional(),
  url: z.string().optional(),
  accessDate: z.string().optional(),
  doi: z.string().optional(),
  edition: z.string().optional(),
  editors: z.array(z.object({
    firstName: z.string(),
    lastName: z.string(),
  })).optional(),
});

// Projects table
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey().$defaultFn(genId),
  userId: text("user_id"),
  name: text("name").notNull(),
  description: text("description"),
  thesis: text("thesis"),
  scope: text("scope"),
  contextSummary: text("context_summary"),
  contextEmbedding: text("context_embedding", { mode: "json" }).$type<number[]>(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

// Prompt templates table (project-scoped prompt sets)
export const promptTemplates = sqliteTable("prompt_templates", {
  id: text("id").primaryKey().$defaultFn(genId),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  prompts: text("prompts", { mode: "json" }).$type<Array<{ text: string; color: string }>>().notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

// Folders table (for nested sub-folders)
export const folders = sqliteTable("folders", {
  id: text("id").primaryKey().$defaultFn(genId),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  parentFolderId: text("parent_folder_id"),
  name: text("name").notNull(),
  description: text("description"),
  contextSummary: text("context_summary"),
  contextEmbedding: text("context_embedding", { mode: "json" }).$type<number[]>(),
  sortOrder: integer("sort_order").default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

// Project documents table (links documents to projects with project-specific context)
export const projectDocuments = sqliteTable("project_documents", {
  id: text("id").primaryKey().$defaultFn(genId),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  folderId: text("folder_id").references(() => folders.id, { onDelete: "set null" }),
  projectContext: text("project_context"),
  roleInProject: text("role_in_project"),
  retrievalContext: text("retrieval_context"),
  retrievalEmbedding: text("retrieval_embedding", { mode: "json" }).$type<number[]>(),
  citationData: text("citation_data", { mode: "json" }).$type<CitationData>(),
  lastViewedAt: integer("last_viewed_at", { mode: "timestamp" }),
  scrollPosition: integer("scroll_position"),
  sourceRole: text("source_role").default("evidence"),
  styleAnalysis: text("style_analysis"),
  addedAt: integer("added_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

// Project annotations table (project-specific annotations)
export const projectAnnotations = sqliteTable("project_annotations", {
  id: text("id").primaryKey().$defaultFn(genId),
  projectDocumentId: text("project_document_id").notNull().references(() => projectDocuments.id, { onDelete: "cascade" }),
  startPosition: integer("start_position").notNull(),
  endPosition: integer("end_position").notNull(),
  highlightedText: text("highlighted_text").notNull(),
  category: text("category").notNull().$type<AnnotationCategory>(),
  note: text("note"),
  isAiGenerated: integer("is_ai_generated", { mode: "boolean" }).default(true),
  confidenceScore: real("confidence_score"),
  // Multi-prompt support
  promptText: text("prompt_text"),
  promptIndex: integer("prompt_index"),
  promptColor: text("prompt_color"),
  analysisRunId: text("analysis_run_id"),
  searchableContent: text("searchable_content"),
  searchEmbedding: text("search_embedding", { mode: "json" }).$type<number[]>(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

// Web clips table (saved browser highlights with source metadata + citations)
export const webClips = sqliteTable("web_clips", {
  id: text("id").primaryKey().$defaultFn(genId),
  userId: text("user_id"),
  highlightedText: text("highlighted_text").notNull(),
  note: text("note"),
  category: text("category").notNull().default("key_quote"),
  sourceUrl: text("source_url").notNull(),
  pageTitle: text("page_title").notNull(),
  siteName: text("site_name"),
  authorName: text("author_name"),
  publishDate: text("publish_date"),
  citationData: text("citation_data", { mode: "json" }).$type<CitationData>(),
  footnote: text("footnote"),
  bibliography: text("bibliography"),
  projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
  projectDocumentId: text("project_document_id").references(() => projectDocuments.id, { onDelete: "set null" }),
  surroundingContext: text("surrounding_context"),
  tags: text("tags", { mode: "json" }).$type<string[]>(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

// Relations declared after all tables to avoid reference errors
export const projectsRelations = relations(projects, ({ many }) => ({
  folders: many(folders),
  projectDocuments: many(projectDocuments),
  promptTemplates: many(promptTemplates),
  webClips: many(webClips),
}));

export const promptTemplatesRelations = relations(promptTemplates, ({ one }) => ({
  project: one(projects, {
    fields: [promptTemplates.projectId],
    references: [projects.id],
  }),
}));

export const foldersRelations = relations(folders, ({ one, many }) => ({
  project: one(projects, {
    fields: [folders.projectId],
    references: [projects.id],
  }),
  parentFolder: one(folders, {
    fields: [folders.parentFolderId],
    references: [folders.id],
    relationName: "parentChild",
  }),
  childFolders: many(folders, { relationName: "parentChild" }),
  projectDocuments: many(projectDocuments),
}));

export const projectDocumentsRelations = relations(projectDocuments, ({ one, many }) => ({
  project: one(projects, {
    fields: [projectDocuments.projectId],
    references: [projects.id],
  }),
  document: one(documents, {
    fields: [projectDocuments.documentId],
    references: [documents.id],
  }),
  folder: one(folders, {
    fields: [projectDocuments.folderId],
    references: [folders.id],
  }),
  projectAnnotations: many(projectAnnotations),
  webClips: many(webClips),
}));

export const projectAnnotationsRelations = relations(projectAnnotations, ({ one }) => ({
  projectDocument: one(projectDocuments, {
    fields: [projectAnnotations.projectDocumentId],
    references: [projectDocuments.id],
  }),
}));

export const webClipsRelations = relations(webClips, ({ one }) => ({
  project: one(projects, {
    fields: [webClips.projectId],
    references: [projects.id],
  }),
  projectDocument: one(projectDocuments, {
    fields: [webClips.projectDocumentId],
    references: [projectDocuments.id],
  }),
}));

// Project insert schemas and types
export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  contextSummary: true,
  contextEmbedding: true,
});
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;

export const insertPromptTemplateSchema = createInsertSchema(promptTemplates).omit({
  id: true,
  createdAt: true,
});
export type InsertPromptTemplate = z.infer<typeof insertPromptTemplateSchema>;
export type PromptTemplate = typeof promptTemplates.$inferSelect;

export const insertFolderSchema = createInsertSchema(folders).omit({
  id: true,
  createdAt: true,
  contextSummary: true,
  contextEmbedding: true,
});
export type InsertFolder = z.infer<typeof insertFolderSchema>;
export type Folder = typeof folders.$inferSelect;

export const insertProjectDocumentSchema = createInsertSchema(projectDocuments).omit({
  id: true,
  addedAt: true,
  retrievalContext: true,
  retrievalEmbedding: true,
});
export type InsertProjectDocument = z.infer<typeof insertProjectDocumentSchema>;
export type ProjectDocument = typeof projectDocuments.$inferSelect;

export const insertProjectAnnotationSchema = createInsertSchema(projectAnnotations).omit({
  id: true,
  createdAt: true,
  searchableContent: true,
  searchEmbedding: true,
});
export type InsertProjectAnnotation = z.infer<typeof insertProjectAnnotationSchema>;
export type ProjectAnnotation = typeof projectAnnotations.$inferSelect;

export const insertWebClipSchema = createInsertSchema(webClips).omit({
  id: true,
  createdAt: true,
  footnote: true,
  bibliography: true,
  citationData: true,
});
export type InsertWebClip = z.infer<typeof insertWebClipSchema>;
export type WebClip = typeof webClips.$inferSelect;

// Global search result type
export const globalSearchResultSchema = z.object({
  type: z.enum(['annotation', 'document_context', 'folder_context']),
  documentId: z.string().optional(),
  documentFilename: z.string().optional(),
  folderId: z.string().optional(),
  folderName: z.string().optional(),
  annotationId: z.string().optional(),
  matchedText: z.string(),
  highlightedText: z.string().optional(),
  note: z.string().optional(),
  category: z.enum(annotationCategories).optional(),
  citationData: citationDataSchema.optional(),
  pageNumber: z.string().optional(),
  similarityScore: z.number(),
  relevanceLevel: z.enum(['high', 'medium', 'low']),
  startPosition: z.number().optional(),
});
export type GlobalSearchResult = z.infer<typeof globalSearchResultSchema>;

// Thoroughness levels for document analysis
export const thoroughnessLevels = ['quick', 'standard', 'thorough', 'exhaustive'] as const;
export type ThoroughnessLevel = typeof thoroughnessLevels[number];

// Batch analysis schemas
export const batchAnalysisRequestSchema = z.object({
  projectDocumentIds: z.array(z.string()).min(1).max(50),
  intent: z.string().min(1).max(2000),
  thoroughness: z.enum(thoroughnessLevels).optional().default('standard'),
  constraints: z.object({
    categories: z.array(z.enum(annotationCategories)).optional(),
    maxAnnotationsPerDoc: z.number().int().min(1).max(50).optional(),
    minConfidence: z.number().min(0).max(1).optional(),
  }).optional(),
});
export type BatchAnalysisRequest = z.infer<typeof batchAnalysisRequestSchema>;

export const batchDocumentResultSchema = z.object({
  projectDocumentId: z.string(),
  filename: z.string(),
  status: z.enum(['pending', 'processing', 'completed', 'failed']),
  annotationsCreated: z.number().int().default(0),
  error: z.string().optional(),
});
export type BatchDocumentResult = z.infer<typeof batchDocumentResultSchema>;

export const batchAnalysisResponseSchema = z.object({
  jobId: z.string(),
  status: z.enum(['completed', 'partial', 'failed']),
  totalDocuments: z.number().int(),
  successfulDocuments: z.number().int(),
  failedDocuments: z.number().int(),
  totalAnnotationsCreated: z.number().int(),
  totalTimeMs: z.number(),
  results: z.array(batchDocumentResultSchema),
});
export type BatchAnalysisResponse = z.infer<typeof batchAnalysisResponseSchema>;

// Batch document upload schemas
export const batchAddDocumentsRequestSchema = z.object({
  documentIds: z.array(z.string()).min(1).max(50),
  folderId: z.string().nullable().optional(),
});
export type BatchAddDocumentsRequest = z.infer<typeof batchAddDocumentsRequestSchema>;

export const batchAddDocumentResultSchema = z.object({
  documentId: z.string(),
  filename: z.string(),
  status: z.enum(['added', 'already_exists', 'failed']),
  projectDocumentId: z.string().optional(),
  error: z.string().optional(),
});
export type BatchAddDocumentResult = z.infer<typeof batchAddDocumentResultSchema>;

export const batchAddDocumentsResponseSchema = z.object({
  totalRequested: z.number().int(),
  added: z.number().int(),
  alreadyExists: z.number().int(),
  failed: z.number().int(),
  results: z.array(batchAddDocumentResultSchema),
});
export type BatchAddDocumentsResponse = z.infer<typeof batchAddDocumentsResponseSchema>;


// === CHAT TABLES ===

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey().$defaultFn(genId),
  userId: text("user_id"), // nullable until auth is merged
  projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
  title: text("title").notNull().default("New Chat"),
  model: text("model").notNull().default("claude-opus-4-6"),
  writingModel: text("writing_model").default("precision"),
  selectedSourceIds: text("selected_source_ids", { mode: "json" }).$type<string[]>(),
  citationStyle: text("citation_style").default("chicago"),
  tone: text("tone").default("academic"),
  humanize: integer("humanize", { mode: "boolean" }).default(true),
  noEnDashes: integer("no_en_dashes", { mode: "boolean" }).default(false),
  evidenceClipboard: text("evidence_clipboard"),
  compactionSummary: text("compaction_summary"),
  compactedAtTurn: integer("compacted_at_turn").default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey().$defaultFn(genId),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // "user" | "assistant" | "system"
  content: text("content").notNull(),
  tokensUsed: integer("tokens_used").default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  project: one(projects, {
    fields: [conversations.projectId],
    references: [projects.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Conversation = typeof conversations.$inferSelect;

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true, createdAt: true,
});
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;

