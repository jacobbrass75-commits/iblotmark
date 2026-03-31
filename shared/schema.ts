import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";
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

// === INFRASTRUCTURE TABLES ===

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  label: text("label"),
  keyHash: text("key_hash").notNull().unique(),
  keyPrefix: text("key_prefix").notNull(),
  lastUsedAt: integer("last_used_at"),
  revokedAt: integer("revoked_at"),
  createdAt: integer("created_at").notNull(),
});

export const mcpOauthClients = sqliteTable("mcp_oauth_clients", {
  clientId: text("client_id").primaryKey(),
  clientSecretHash: text("client_secret_hash"),
  clientName: text("client_name").notNull(),
  redirectUris: text("redirect_uris").notNull(),
  grantTypes: text("grant_types").notNull(),
  responseTypes: text("response_types").notNull(),
  tokenEndpointAuthMethod: text("token_endpoint_auth_method").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const mcpAuthCodes = sqliteTable("mcp_auth_codes", {
  codeHash: text("code_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull().references(() => mcpOauthClients.clientId, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  scope: text("scope").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  codeChallengeMethod: text("code_challenge_method").notNull(),
  expiresAt: integer("expires_at").notNull(),
  used: integer("used").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const mcpTokens = sqliteTable("mcp_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull().references(() => mcpOauthClients.clientId, { onDelete: "cascade" }),
  keyHash: text("key_hash").notNull().unique(),
  keyPrefix: text("key_prefix").notNull(),
  scope: text("scope").notNull(),
  refreshTokenHash: text("refresh_token_hash"),
  expiresAt: integer("expires_at"),
  lastUsedAt: integer("last_used_at"),
  revokedAt: integer("revoked_at"),
  createdAt: integer("created_at").notNull(),
});

export const analyticsToolCalls = sqliteTable("analytics_tool_calls", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  userId: text("user_id").notNull(),
  projectId: text("project_id"),
  toolName: text("tool_name").notNull(),
  documentId: text("document_id"),
  escalationRound: integer("escalation_round").notNull(),
  turnNumber: integer("turn_number").notNull(),
  resultSizeChars: integer("result_size_chars").notNull(),
  success: integer("success").notNull(),
  metadata: text("metadata"),
  timestamp: integer("timestamp").notNull(),
});

export const analyticsContextSnapshots = sqliteTable("analytics_context_snapshots", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  turnNumber: integer("turn_number").notNull(),
  escalationRound: integer("escalation_round").notNull(),
  estimatedTokens: integer("estimated_tokens").notNull(),
  warningLevel: text("warning_level").notNull(),
  trigger: text("trigger"),
  metadata: text("metadata"),
  timestamp: integer("timestamp").notNull(),
});

// OCR jobs queue (runtime-managed, registered here so db:push doesn't drop it)
export const ocrJobs = sqliteTable("ocr_jobs", {
  id: text("id").primaryKey().$defaultFn(genId),
  documentId: text("document_id").notNull(),
  jobType: text("job_type").notNull(),
  status: text("status").notNull().default("queued"),
  payload: text("payload").notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  lastError: text("last_error"),
  createdAt: integer("created_at").notNull().default(0),
  updatedAt: integer("updated_at").notNull().default(0),
  startedAt: integer("started_at"),
  finishedAt: integer("finished_at"),
});

// OCR page-level results (runtime-managed, registered here so db:push doesn't drop it)
export const ocrPageResults = sqliteTable("ocr_page_results", {
  id: text("id").primaryKey().$defaultFn(genId),
  jobId: text("job_id").notNull(),
  documentId: text("document_id").notNull(),
  pageNumber: integer("page_number").notNull(),
  text: text("text").notNull(),
  createdAt: integer("created_at").notNull().default(0),
  updatedAt: integer("updated_at").notNull().default(0),
}, (table) => [
  uniqueIndex("idx_ocr_page_results_job_page").on(table.jobId, table.pageNumber),
]);

// === iBOLT BLOG GENERATION TABLES ===

// Industry verticals (12 categories)
export const industryVerticals = sqliteTable("industry_verticals", {
  id: text("id").primaryKey().$defaultFn(genId),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  terminology: text("terminology", { mode: "json" }).$type<string[]>(),
  painPoints: text("pain_points", { mode: "json" }).$type<string[]>(),
  useCases: text("use_cases", { mode: "json" }).$type<string[]>(),
  regulations: text("regulations", { mode: "json" }).$type<string[]>(),
  seasonalRelevance: text("seasonal_relevance"),
  compatibleDevices: text("compatible_devices", { mode: "json" }).$type<string[]>(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export const insertIndustryVerticalSchema = createInsertSchema(industryVerticals).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertIndustryVertical = z.infer<typeof insertIndustryVerticalSchema>;
export type IndustryVertical = typeof industryVerticals.$inferSelect;

// Context entries (industry knowledge bank)
export const contextEntries = sqliteTable("context_entries", {
  id: text("id").primaryKey().$defaultFn(genId),
  verticalId: text("vertical_id").notNull().references(() => industryVerticals.id, { onDelete: "cascade" }),
  category: text("category").notNull(), // "terminology" | "use_case" | "pain_point" | "regulation" | "trend" | "competitor" | "user_language"
  content: text("content").notNull(),
  sourceType: text("source_type").notNull().default("seed"), // "seed" | "youtube" | "reddit" | "web" | "manual"
  sourceUrl: text("source_url"),
  confidence: real("confidence").notNull().default(1.0),
  isVerified: integer("is_verified", { mode: "boolean" }).default(true).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export const insertContextEntrySchema = createInsertSchema(contextEntries).omit({
  id: true, createdAt: true,
});
export type InsertContextEntry = z.infer<typeof insertContextEntrySchema>;
export type ContextEntry = typeof contextEntries.$inferSelect;

// Keyword imports (CSV upload batch tracking) — declared before keywords so FK reference works
export const keywordImports = sqliteTable("keyword_imports", {
  id: text("id").primaryKey().$defaultFn(genId),
  filename: text("filename").notNull(),
  totalKeywords: integer("total_keywords").default(0),
  newKeywords: integer("new_keywords").default(0),
  duplicateKeywords: integer("duplicate_keywords").default(0),
  importedAt: integer("imported_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export const insertKeywordImportSchema = createInsertSchema(keywordImports).omit({
  id: true, importedAt: true,
});
export type InsertKeywordImport = z.infer<typeof insertKeywordImportSchema>;
export type KeywordImport = typeof keywordImports.$inferSelect;

// Keyword clusters (groups of related keywords) — declared before keywords so FK reference works
export const keywordClusters = sqliteTable("keyword_clusters", {
  id: text("id").primaryKey().$defaultFn(genId),
  name: text("name").notNull(),
  primaryKeyword: text("primary_keyword").notNull(),
  verticalId: text("vertical_id").references(() => industryVerticals.id, { onDelete: "set null" }),
  totalVolume: integer("total_volume").default(0),
  avgDifficulty: real("avg_difficulty").default(0),
  priority: real("priority").default(0),
  status: text("status").notNull().default("pending"), // "pending" | "generating" | "generated" | "published"
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export const insertKeywordClusterSchema = createInsertSchema(keywordClusters).omit({
  id: true, createdAt: true,
});
export type InsertKeywordCluster = z.infer<typeof insertKeywordClusterSchema>;
export type KeywordCluster = typeof keywordClusters.$inferSelect;

// Keywords (from Ubersuggest CSV)
export const keywords = sqliteTable("keywords", {
  id: text("id").primaryKey().$defaultFn(genId),
  keyword: text("keyword").notNull(),
  volume: integer("volume").default(0),
  difficulty: integer("difficulty").default(0),
  cpc: real("cpc").default(0),
  opportunityScore: real("opportunity_score").default(0),
  status: text("status").notNull().default("new"), // "new" | "clustered" | "assigned" | "generated" | "published"
  clusterId: text("cluster_id").references(() => keywordClusters.id, { onDelete: "set null" }),
  importId: text("import_id").references(() => keywordImports.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export const insertKeywordSchema = createInsertSchema(keywords).omit({
  id: true, createdAt: true, opportunityScore: true,
});
export type InsertKeyword = z.infer<typeof insertKeywordSchema>;
export type Keyword = typeof keywords.$inferSelect;

// Products (scraped from iboltmounts.com)
export const products = sqliteTable("ibolt_products", {
  id: text("id").primaryKey().$defaultFn(genId),
  shopifyId: text("shopify_id").unique(),
  title: text("title").notNull(),
  handle: text("handle").notNull(),
  description: text("description"),
  productType: text("product_type"),
  vendor: text("vendor"),
  tags: text("tags", { mode: "json" }).$type<string[]>(),
  imageUrl: text("image_url"),
  price: text("price"),
  url: text("url"),
  // Catalog enrichment fields
  catalogDescription: text("catalog_description"),
  catalogPageRef: text("catalog_page_ref"),
  hasPhotos: integer("has_photos", { mode: "boolean" }).default(false),
  photoCount: integer("photo_count").default(0),
  scrapedAt: integer("scraped_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export const insertProductSchema = createInsertSchema(products).omit({
  id: true, scrapedAt: true, updatedAt: true,
});
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof products.$inferSelect;

// Product-to-vertical mapping (many-to-many)
export const productVerticals = sqliteTable("product_verticals", {
  id: text("id").primaryKey().$defaultFn(genId),
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  verticalId: text("vertical_id").notNull().references(() => industryVerticals.id, { onDelete: "cascade" }),
  relevanceScore: real("relevance_score").default(1.0),
});

export type ProductVertical = typeof productVerticals.$inferSelect;

// Generation batches (batch job tracking) — declared before blogPosts so FK reference works
export const generationBatches = sqliteTable("generation_batches", {
  id: text("id").primaryKey().$defaultFn(genId),
  name: text("name"),
  totalPosts: integer("total_posts").default(0),
  completedPosts: integer("completed_posts").default(0),
  failedPosts: integer("failed_posts").default(0),
  status: text("status").notNull().default("pending"), // "pending" | "running" | "completed" | "failed"
  startedAt: integer("started_at", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export const insertGenerationBatchSchema = createInsertSchema(generationBatches).omit({
  id: true, createdAt: true, completedPosts: true, failedPosts: true,
});
export type InsertGenerationBatch = z.infer<typeof insertGenerationBatchSchema>;
export type GenerationBatch = typeof generationBatches.$inferSelect;

// Blog posts (generated output)
export const blogPosts = sqliteTable("blog_posts", {
  id: text("id").primaryKey().$defaultFn(genId),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  metaTitle: text("meta_title"),
  metaDescription: text("meta_description"),
  markdown: text("markdown"),
  html: text("html"),
  clusterId: text("cluster_id").references(() => keywordClusters.id, { onDelete: "set null" }),
  verticalId: text("vertical_id").references(() => industryVerticals.id, { onDelete: "set null" }),
  batchId: text("batch_id").references(() => generationBatches.id, { onDelete: "set null" }),
  status: text("status").notNull().default("draft"), // "draft" | "review" | "approved" | "published"
  wordCount: integer("word_count").default(0),
  // Verification scores (0-100)
  brandConsistency: integer("brand_consistency"),
  seoOptimization: integer("seo_optimization"),
  naturalLanguage: integer("natural_language"),
  factualAccuracy: integer("factual_accuracy"),
  overallScore: integer("overall_score"),
  verificationNotes: text("verification_notes"),
  generatedAt: integer("generated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export const insertBlogPostSchema = createInsertSchema(blogPosts).omit({
  id: true, generatedAt: true, updatedAt: true,
});
export type InsertBlogPost = z.infer<typeof insertBlogPostSchema>;
export type BlogPost = typeof blogPosts.$inferSelect;

// Blog post products (products mentioned in posts)
export const blogPostProducts = sqliteTable("blog_post_products", {
  id: text("id").primaryKey().$defaultFn(genId),
  blogPostId: text("blog_post_id").notNull().references(() => blogPosts.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  mentionContext: text("mention_context"),
});

export type BlogPostProduct = typeof blogPostProducts.$inferSelect;

// Research jobs (research agent job tracking)
export const researchJobs = sqliteTable("research_jobs", {
  id: text("id").primaryKey().$defaultFn(genId),
  verticalId: text("vertical_id").notNull().references(() => industryVerticals.id, { onDelete: "cascade" }),
  sourceType: text("source_type").notNull(), // "youtube" | "reddit" | "web"
  query: text("query").notNull(),
  status: text("status").notNull().default("pending"), // "pending" | "running" | "completed" | "failed"
  entriesFound: integer("entries_found").default(0),
  error: text("error"),
  startedAt: integer("started_at", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export const insertResearchJobSchema = createInsertSchema(researchJobs).omit({
  id: true, createdAt: true, entriesFound: true,
});
export type InsertResearchJob = z.infer<typeof insertResearchJobSchema>;
export type ResearchJob = typeof researchJobs.$inferSelect;

// === iBOLT BLOG RELATIONS ===

export const industryVerticalsRelations = relations(industryVerticals, ({ many }) => ({
  contextEntries: many(contextEntries),
  keywordClusters: many(keywordClusters),
  productVerticals: many(productVerticals),
  blogPosts: many(blogPosts),
  researchJobs: many(researchJobs),
}));

export const contextEntriesRelations = relations(contextEntries, ({ one }) => ({
  vertical: one(industryVerticals, {
    fields: [contextEntries.verticalId],
    references: [industryVerticals.id],
  }),
}));

export const keywordsRelations = relations(keywords, ({ one }) => ({
  cluster: one(keywordClusters, {
    fields: [keywords.clusterId],
    references: [keywordClusters.id],
  }),
  kwImport: one(keywordImports, {
    fields: [keywords.importId],
    references: [keywordImports.id],
  }),
}));

export const keywordClustersRelations = relations(keywordClusters, ({ one, many }) => ({
  vertical: one(industryVerticals, {
    fields: [keywordClusters.verticalId],
    references: [industryVerticals.id],
  }),
  keywords: many(keywords),
  blogPosts: many(blogPosts),
}));

export const keywordImportsRelations = relations(keywordImports, ({ many }) => ({
  keywords: many(keywords),
}));

export const iboltProductsRelations = relations(products, ({ many }) => ({
  productVerticals: many(productVerticals),
  blogPostProducts: many(blogPostProducts),
}));

export const productVerticalsRelations = relations(productVerticals, ({ one }) => ({
  product: one(products, {
    fields: [productVerticals.productId],
    references: [products.id],
  }),
  vertical: one(industryVerticals, {
    fields: [productVerticals.verticalId],
    references: [industryVerticals.id],
  }),
}));

export const blogPostsRelations = relations(blogPosts, ({ one, many }) => ({
  cluster: one(keywordClusters, {
    fields: [blogPosts.clusterId],
    references: [keywordClusters.id],
  }),
  vertical: one(industryVerticals, {
    fields: [blogPosts.verticalId],
    references: [industryVerticals.id],
  }),
  batch: one(generationBatches, {
    fields: [blogPosts.batchId],
    references: [generationBatches.id],
  }),
  blogPostProducts: many(blogPostProducts),
}));

export const blogPostProductsRelations = relations(blogPostProducts, ({ one }) => ({
  blogPost: one(blogPosts, {
    fields: [blogPostProducts.blogPostId],
    references: [blogPosts.id],
  }),
  product: one(products, {
    fields: [blogPostProducts.productId],
    references: [products.id],
  }),
}));

export const generationBatchesRelations = relations(generationBatches, ({ many }) => ({
  blogPosts: many(blogPosts),
}));

export const researchJobsRelations = relations(researchJobs, ({ one }) => ({
  vertical: one(industryVerticals, {
    fields: [researchJobs.verticalId],
    references: [industryVerticals.id],
  }),
}));

// === PRODUCT INFO BANK + PICTURE BANK ===

// Catalog imports (PDF import tracking)
export const productCatalogImports = sqliteTable("product_catalog_imports", {
  id: text("id").primaryKey().$defaultFn(genId),
  filename: text("filename").notNull(),
  totalPages: integer("total_pages"),
  extractedProducts: integer("extracted_products").default(0),
  matchedProducts: integer("matched_products").default(0),
  newProducts: integer("new_products").default(0),
  status: text("status").notNull().default("pending"), // "pending" | "extracting" | "matching" | "completed" | "failed"
  error: text("error"),
  importedAt: integer("imported_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

export const insertCatalogImportSchema = createInsertSchema(productCatalogImports).omit({
  id: true, importedAt: true, extractedProducts: true, matchedProducts: true, newProducts: true,
});
export type InsertCatalogImport = z.infer<typeof insertCatalogImportSchema>;
export type CatalogImport = typeof productCatalogImports.$inferSelect;

// Catalog extractions (AI-extracted products from PDF)
export const productCatalogExtractions = sqliteTable("product_catalog_extractions", {
  id: text("id").primaryKey().$defaultFn(genId),
  importId: text("import_id").notNull().references(() => productCatalogImports.id, { onDelete: "cascade" }),
  extractedName: text("extracted_name").notNull(),
  extractedDescription: text("extracted_description"),
  pageNumber: integer("page_number"),
  confidence: real("confidence").default(0.8),
  matchedProductId: text("matched_product_id").references(() => products.id, { onDelete: "set null" }),
  matchStatus: text("match_status").notNull().default("pending"), // "pending" | "matched" | "new" | "rejected"
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export const insertCatalogExtractionSchema = createInsertSchema(productCatalogExtractions).omit({
  id: true, createdAt: true, matchedProductId: true, matchStatus: true,
});
export type InsertCatalogExtraction = z.infer<typeof insertCatalogExtractionSchema>;
export type CatalogExtraction = typeof productCatalogExtractions.$inferSelect;

// Product photos (the Picture Bank)
export const productPhotos = sqliteTable("product_photos", {
  id: text("id").primaryKey().$defaultFn(genId),
  productId: text("product_id").references(() => products.id, { onDelete: "set null" }),
  filename: text("filename").notNull(),
  originalFilename: text("original_filename").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSize: integer("file_size"),
  filePath: text("file_path").notNull(),
  thumbnailPath: text("thumbnail_path"),
  width: integer("width"),
  height: integer("height"),
  // AI vision analysis
  angleType: text("angle_type"), // "front" | "back" | "side" | "top" | "detail" | "full" | "in-use"
  contextType: text("context_type"), // "studio" | "in-use" | "lifestyle" | "packaging" | "technical"
  settingDescription: text("setting_description"),
  qualityScore: real("quality_score"),
  isHero: integer("is_hero", { mode: "boolean" }).default(false),
  verticalRelevance: text("vertical_relevance", { mode: "json" }).$type<string[]>(),
  aiAnalysis: text("ai_analysis", { mode: "json" }),
  analyzedAt: integer("analyzed_at", { mode: "timestamp" }),
  uploadedAt: integer("uploaded_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export const insertProductPhotoSchema = createInsertSchema(productPhotos).omit({
  id: true, uploadedAt: true, analyzedAt: true,
});
export type InsertProductPhoto = z.infer<typeof insertProductPhotoSchema>;
export type ProductPhoto = typeof productPhotos.$inferSelect;

// Blog post photos (photos selected for posts)
export const blogPostPhotos = sqliteTable("blog_post_photos", {
  id: text("id").primaryKey().$defaultFn(genId),
  blogPostId: text("blog_post_id").notNull().references(() => blogPosts.id, { onDelete: "cascade" }),
  photoId: text("photo_id").notNull().references(() => productPhotos.id, { onDelete: "cascade" }),
  sectionIndex: integer("section_index"),
  placement: text("placement").notNull().default("inline"), // "hero" | "inline" | "product-spotlight"
  altText: text("alt_text"),
  caption: text("caption"),
  selectionReason: text("selection_reason"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export type BlogPostPhoto = typeof blogPostPhotos.$inferSelect;

// Pre-chunked context for intelligent pipeline retrieval
export const pipelineContextChunks = sqliteTable("pipeline_context_chunks", {
  id: text("id").primaryKey().$defaultFn(genId),
  sourceType: text("source_type").notNull(), // "product" | "context_entry" | "catalog" | "research"
  sourceId: text("source_id").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  chunkText: text("chunk_text").notNull(),
  tokenEstimate: integer("token_estimate"),
  verticalId: text("vertical_id").references(() => industryVerticals.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export type PipelineContextChunk = typeof pipelineContextChunks.$inferSelect;

// === Phase 5 Relations ===

export const catalogImportsRelations = relations(productCatalogImports, ({ many }) => ({
  extractions: many(productCatalogExtractions),
}));

export const catalogExtractionsRelations = relations(productCatalogExtractions, ({ one }) => ({
  import_: one(productCatalogImports, {
    fields: [productCatalogExtractions.importId],
    references: [productCatalogImports.id],
  }),
  matchedProduct: one(products, {
    fields: [productCatalogExtractions.matchedProductId],
    references: [products.id],
  }),
}));

export const productPhotosRelations = relations(productPhotos, ({ one, many }) => ({
  product: one(products, {
    fields: [productPhotos.productId],
    references: [products.id],
  }),
  blogPostPhotos: many(blogPostPhotos),
}));

export const blogPostPhotosRelations = relations(blogPostPhotos, ({ one }) => ({
  blogPost: one(blogPosts, {
    fields: [blogPostPhotos.blogPostId],
    references: [blogPosts.id],
  }),
  photo: one(productPhotos, {
    fields: [blogPostPhotos.photoId],
    references: [productPhotos.id],
  }),
}));

