# ScholarMark Architecture Reference (Dev Branch)

> Updated 2026-03-11. Covers the `dev` branch of `anotations-jan-26` -- a streamlined version focused on core writing/research features with Clerk authentication and simplified architecture.

---

## Branch Differences from Master

The dev branch **removes** several production systems to focus on core functionality:

| Removed | Reason |
|---------|--------|
| MCP server (`mcp-server/`) | Separated into its own deployment |
| Analytics system (`analyticsRoutes.ts`, `analyticsLogger.ts`, 6 analytics components) | Deferred to production |
| OAuth routes (`oauthRoutes.ts`, `oauthStorage.ts`) | Replaced by Clerk auth |
| Quote jump links (`quoteJumpLinks.ts`, `annotationLinks.ts`) | Simplified annotation UX |
| Client-side PDF/DOCX export (`pdfExport.ts`, `docxExport.ts`, `markdownConfig.tsx`) | Simplified export |
| Admin analytics page (`AdminAnalytics.tsx`) | Removed with analytics system |
| Extension auth page (`ExtensionAuth.tsx`) | Simplified extension flow |
| ToolStepsIndicator component | Simplified chat UI |
| Deploy configs (`deploy/`, `mcp-server/deploy/`) | Production-specific |
| Clerk type shims (`clerk-shims.d.ts`) | Clerk now native dependency |

**Key additions on dev:**
- Clerk authentication (replaces JWT-only)
- 4-phase collaborative writing flow
- Simplified database initialization (single `db.ts`)
- Dynamic context escalation with research agent
- Writing model selection (precision vs extended)

---

## Table of Contents

1. [Tech Stack](#1-tech-stack)
2. [App Routes & Pages](#2-app-routes--pages)
3. [Server Entry & Middleware](#3-server-entry--middleware)
4. [Database Schema](#4-database-schema)
5. [Authentication System](#5-authentication-system)
6. [Document Upload & Processing](#6-document-upload--processing)
7. [Project System](#7-project-system)
8. [Annotation System](#8-annotation-system)
9. [Chat System (Standalone)](#9-chat-system-standalone)
10. [Writing System (Chat-Based)](#10-writing-system-chat-based)
11. [Writing System (One-Shot Pipeline)](#11-writing-system-one-shot-pipeline)
12. [Source Injection & Formatting](#12-source-injection--formatting)
13. [Citation System](#13-citation-system)
14. [Humanizer System](#14-humanizer-system)
15. [Web Clips & Chrome Extension](#15-web-clips--chrome-extension)
16. [Environment Variables](#16-environment-variables)
17. [All API Endpoints](#17-all-api-endpoints)
18. [Directory Structure](#18-directory-structure)

---

## 1. Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | React + TypeScript | React 18.3, TS 5.6 |
| Routing | Wouter | 3.3 |
| Data fetching | TanStack React Query | 5.60 |
| UI | Radix UI / Shadcn | - |
| Build | Vite | 7.3 |
| Backend | Express.js | 4.21 |
| Database | SQLite via Drizzle ORM | drizzle-orm 0.39 |
| AI (chat/writing) | Anthropic SDK | 0.78 |
| AI (annotations) | OpenAI SDK | 6.16 |
| AI (humanizer) | Google Gemini REST API (primary) / Anthropic SDK (fallback) | - |
| Auth | Clerk Express | @clerk/express 1.7 |
| File uploads | Multer | 2.0 (50 MB limit) |
| Image processing | Sharp | 0.34 |
| PDF text extraction | pdf-parse | 2.4 |
| Markdown rendering | react-markdown | 10.1 |
| Validation | Zod | 3.25 |
| Forms | react-hook-form | 7.55 |

**Database file:** `data/sourceannotator.db`
**Default port:** `5001`

---

## 2. App Routes & Pages

Defined in `client/src/App.tsx`. All content routes are wrapped in `<ProtectedRoute>`.

| Route | Component | Auth | Purpose |
|-------|-----------|------|---------|
| `/sign-in` | Login | No | Sign in (Clerk) |
| `/sign-up` | Register | No | Create account (Clerk) |
| `/pricing` | Pricing | No | Pricing page |
| `/` | Home | Yes | Dashboard |
| `/projects` | Projects | Yes | Project list |
| `/web-clips` | WebClips | Yes | Web clip collection |
| `/projects/:id` | ProjectWorkspace | Yes | Project workspace (Documents + Write tabs) |
| `/projects/:projectId/documents/:docId` | ProjectDocument | Yes | Document viewer with annotations |
| `/chat` | Chat | Yes | Standalone chatbot |
| `/chat/:conversationId` | Chat | Yes | Specific conversation |
| `/write` | WritingPage | Yes | Chat-based writing (alias) |
| `/writing` | WritingPage | Yes | Chat-based writing |

**Removed from master:** `/admin/analytics`, `/extension-auth`

---

## 3. Server Entry & Middleware

**File:** `server/index.ts`

Startup order:
1. Load `.env` via dotenv
2. Create Express app + HTTP server
3. CORS (allows chrome-extension, localhost, 89.167.10.34, `ALLOWED_ORIGINS`)
4. `express.json()` with raw body capture
5. `express.urlencoded()` for form data
6. Clerk middleware (`configureClerk(app)`)
7. Auth routes registered
8. All other routes via `registerRoutes()`
9. Static file serving (production) or Vite dev server
10. Listen on port 5001

**Key difference from master:** Uses Clerk middleware instead of Passport/JWT setup. No analytics logging middleware.

---

## 4. Database Schema

**File:** `shared/schema.ts`

### users
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID (maps to Clerk userId) |
| email | TEXT UNIQUE | |
| username | TEXT UNIQUE | |
| password | TEXT | bcrypt hash (legacy, Clerk handles auth) |
| firstName, lastName | TEXT | Optional |
| tier | TEXT | "free" / "pro" / "max" |
| tokensUsed | INT | AI token counter |
| tokenLimit | INT | Default: 50,000 (free) |
| storageUsed | INT | Bytes |
| storageLimit | INT | Default: 50 MB (free) |
| emailVerified | BOOL | |
| billingCycleStart | INT | Timestamp |
| createdAt, updatedAt | INT | Timestamps |

### documents
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| userId | TEXT | Owner |
| filename | TEXT | Original filename |
| fullText | TEXT | Extracted text content |
| uploadDate | INT | Timestamp |
| userIntent | TEXT | Analysis goal |
| summary | TEXT | AI-generated summary |
| mainArguments | JSON | string[] |
| keyConcepts | JSON | string[] |
| chunkCount | INT | Number of text chunks |
| status | TEXT | "ready" / "processing" / "error" |
| processingError | TEXT | Error message if failed |

### text_chunks
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| documentId | TEXT FK | -> documents(id) CASCADE |
| text | TEXT | Chunk content |
| startPosition | INT | Absolute char offset |
| endPosition | INT | Absolute char offset |
| sectionTitle | TEXT | Optional heading |
| embedding | JSON | number[] (vector) |

### annotations (document-level)
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| documentId | TEXT FK | -> documents(id) CASCADE |
| chunkId | TEXT | Optional source chunk |
| startPosition, endPosition | INT | Text positions |
| highlightedText | TEXT | Quoted text |
| category | TEXT | key_quote / argument / evidence / methodology / user_added |
| note | TEXT | Annotation content |
| isAiGenerated | BOOL | |
| confidenceScore | REAL | 0-1 |
| promptText | TEXT | Source prompt (multi-prompt) |
| promptIndex | INT | Which prompt in batch |
| promptColor | TEXT | UI color grouping |
| analysisRunId | TEXT | Batch job ID |
| createdAt | INT | |

### projects
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| userId | TEXT | Owner |
| name | TEXT | Project name |
| description | TEXT | |
| thesis | TEXT | Research thesis |
| scope | TEXT | Project scope |
| contextSummary | TEXT | AI-generated context |
| contextEmbedding | JSON | number[] |
| createdAt, updatedAt | INT | |

### folders
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| projectId | TEXT FK | -> projects(id) CASCADE |
| parentFolderId | TEXT | Self-referential (nested) |
| name | TEXT | |
| description | TEXT | |
| sortOrder | INT | |
| createdAt | INT | |

### project_documents (links documents to projects)
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| projectId | TEXT FK | -> projects(id) CASCADE |
| documentId | TEXT FK | -> documents(id) CASCADE |
| folderId | TEXT FK | -> folders(id) SET NULL |
| projectContext | TEXT | Role/context within project |
| roleInProject | TEXT | e.g. "primary source" |
| citationData | JSON | Structured citation metadata |
| retrievalContext | TEXT | Context for writing pipeline |
| retrievalEmbedding | JSON | number[] for retrieval |
| lastViewedAt | INT | |
| scrollPosition | INT | |
| addedAt | INT | |

### project_annotations (project-scoped)
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| projectDocumentId | TEXT FK | -> project_documents(id) CASCADE |
| startPosition, endPosition | INT | |
| highlightedText | TEXT | |
| category | TEXT | Same 5 categories |
| note | TEXT | |
| isAiGenerated | BOOL | |
| confidenceScore | REAL | |
| promptText, promptIndex, promptColor | TEXT/INT/TEXT | Multi-prompt |
| analysisRunId | TEXT | |
| searchableContent | TEXT | Full-text search index |
| searchEmbedding | JSON | number[] |
| createdAt | INT | |

### conversations
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| userId | TEXT | Owner |
| projectId | TEXT FK | -> projects(id) SET NULL |
| title | TEXT | Default: "New Chat" |
| model | TEXT | Default: "claude-haiku-4-5" |
| selectedSourceIds | JSON | string[] (project doc IDs) |
| citationStyle | TEXT | Default: "chicago" |
| tone | TEXT | Default: "academic" |
| humanize | BOOL | Default: true (auto-humanize on compile) |
| noEnDashes | BOOL | Default: false |
| createdAt, updatedAt | INT | |

### messages
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| conversationId | TEXT FK | -> conversations(id) CASCADE |
| role | TEXT | "user" / "assistant" / "system" |
| content | TEXT | Message text |
| tokensUsed | INT | Default: 0 |
| createdAt | INT | |

### prompt_templates
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| projectId | TEXT FK | -> projects(id) CASCADE |
| name | TEXT | Template name |
| prompts | JSON | Array<{text, color}> |
| createdAt | INT | |

### web_clips
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| userId | TEXT | |
| highlightedText | TEXT | |
| note, category | TEXT | |
| sourceUrl, pageTitle, siteName | TEXT | |
| authorName, publishDate | TEXT | |
| citationData | JSON | CitationData |
| footnote, bibliography | TEXT | Generated |
| projectId | TEXT FK | Optional |
| projectDocumentId | TEXT FK | Optional |
| surroundingContext | TEXT | |
| tags | JSON | string[] |
| createdAt | INT | |

**Note:** The dev branch initializes additional tables (like `web_clips` and OCR queue) via raw SQL in `db.ts` rather than through Drizzle migrations.

---

## 5. Authentication System

**Files:** `server/auth.ts`, `server/authRoutes.ts`, `server/authStorage.ts`

- **Method:** Clerk Express sessions (replaces JWT-only on master)
- **Middleware:** `clerkMiddleware()` installed globally
- **User resolution:** Clerk session -> local DB user via `getOrCreateUser()`
- **Middleware functions:**
  - `requireAuth` -- resolves Clerk user, rejects 401 if not authenticated
  - `optionalAuth` -- attaches user if present, continues if not
  - `requireTier(tier)` -- checks user tier meets minimum level
- **Tier hierarchy:** free (0) < pro (1) < max (2)
- **Tier limits:**
  - free: 50K tokens, 50 MB storage
  - pro: 500K tokens, 500 MB storage
  - max: 2M tokens, 5 GB storage

**Key difference from master:** No JWT token generation, no Passport, no bcrypt login flow. Clerk handles all auth externally.

---

## 6. Document Upload & Processing

**File:** `server/routes.ts`

### Supported formats
- **PDF:** Standard text extraction via pdf-parse, or OCR modes (advanced, vision)
- **TXT:** Direct text extraction
- **Images:** PNG, JPG, JPEG, WEBP, GIF, BMP, TIF, TIFF, HEIC, HEIF -- always OCR'd

### Processing flow

**Synchronous (TXT, standard PDF):**
1. Extract text
2. Check for garbled text (scanned PDF detection)
3. Create document record with fullText
4. Save source file to `data/uploads/`
5. Chunk text (V2: 500 chars, 50 char overlap, sentence boundaries)
6. Store chunks in DB
7. Generate AI summary in background

**Async (OCR modes):**
1. Create document with empty fullText, status="processing"
2. Save source file
3. Enqueue OCR job
4. Return 202 Accepted
5. Job fills fullText, updates status -> "ready"

### Text chunking (V2)
- Target size: 500 characters
- Overlap: 50 characters between chunks
- Boundary: attempts sentence-end (". ", ".\n", "? ", "! ")
- Stored with absolute start/end positions

---

## 7. Project System

**Files:** `server/projectRoutes.ts`, `client/src/hooks/useProjects.ts`

A project contains:
- **Metadata:** name, description, thesis, scope
- **Documents:** linked via `project_documents` join table
- **Folders:** nested organization within the project
- **Annotations:** project-scoped annotations on project documents
- **Prompt templates:** saved multi-prompt analysis configurations
- **Web clips:** optional association
- **Conversations:** chat conversations linked to project

### Key operations
- **Add document to project:** Creates `project_document` record with optional citation data
- **Batch add:** Add multiple documents at once
- **Analyze document:** AI generates project annotations with categories and confidence
- **Multi-prompt analysis:** Run multiple prompts with color coding
- **Batch analyze:** Analyze multiple documents with constraints (categories, max per doc, min confidence)
- **Search:** Full-text search across all project documents with relevance ranking

---

## 8. Annotation System

### Categories
| Category | Description |
|----------|-------------|
| `key_quote` | Important quote from source |
| `argument` | Main argument or claim |
| `evidence` | Supporting evidence/data |
| `methodology` | Research method/approach |
| `user_added` | Manual user annotation |

### Two annotation layers

1. **Document-level** (`annotations` table): Global annotations on a document
2. **Project-level** (`project_annotations` table): Project-scoped, with search embedding

### AI Analysis Pipeline (V2)

```
Input: Document chunks + user intent
  |
Phase 1: Generator -- processes chunks, extracts candidate annotations (up to 5/chunk)
  |
Phase 2: Hard Verifier -- reviews candidates, approves/rejects, adjusts categories
  |
Phase 3: Soft Verifier & Refiner -- final scoring, position correction
  |
Output: Stored annotations with confidence scores
```

Thoroughness levels: quick, standard, thorough, exhaustive (controls how many chunks are analyzed)

---

## 9. Chat System (Standalone)

**Files:** `server/chatRoutes.ts`, `client/src/pages/Chat.tsx`, `client/src/hooks/useChat.ts`

**Route:** `/chat`

A conversational chatbot with optional source context.

| Aspect | Detail |
|--------|--------|
| Model (precision) | `claude-opus-4-6` (200K context) |
| Model (extended) | `claude-sonnet-4-5-20250929` (200K context) |
| Max tokens | 8192 |
| System prompt | Generic ScholarMark AI assistant (or source-aware if web clips selected) |
| Streaming | SSE with `{type: "chat_text"/"document_start"/"done"/"error"}` events |
| Auto-title | Generated from first user message |

### Dynamic Context Escalation

The dev branch introduces context escalation -- when the AI requests more context via XML tool tags:

```
<chunk_request doc_id="...">query text</chunk_request>
<context_request doc_id="...">topic</context_request>
```

The server intercepts these, fetches additional chunks from the document, and re-sends with expanded context. Max 2 escalation rounds per message.

### Research Agent

**File:** `server/researchAgent.ts`

A Claude Sonnet 4.5-based agent that autonomously finds relevant quotes in documents:
- Triggered when context escalation isn't sufficient
- Chunks large documents (220K char max per call)
- Returns verified findings with relevance scores
- Uses `extractRecentWritingTopic()` to determine search focus

---

## 10. Writing System (Chat-Based)

**Files:** `server/chatRoutes.ts`, `client/src/components/WritingChat.tsx`, `client/src/hooks/useWritingChat.ts`

**Route:** `/writing` (standalone) or Project Workspace -> Write tab

### 4-Phase Collaborative Writing Flow

The dev branch implements a structured writing flow:

1. **Chat Phase** -- User discusses research with AI, explores sources
2. **Draft Phase** -- AI produces structured paper sections on request
3. **Compile Phase** -- Server assembles conversation into polished paper
4. **Verify Phase** -- AI cross-references citations against source materials

### Layout (3-column)

```
+---------------+------------------+------------------+
|  Sidebar      |  Chat            |  Right Panel     |
|  (250px)      |  (flex)          |  (380px)         |
|               |                  |                  |
|  [New Chat]   |  Messages        |  Settings        |
|  Conv. list   |  + streaming     |  Sources         |
|  Search       |                  |  Compile/Verify  |
|  Rename/Del   |  [Input]         |  Compiled Paper  |
|               |                  |  Export buttons   |
+---------------+------------------+------------------+
```

### Two Modes

**Project Mode** (with a project selected):
- Sources come from project documents (`project_documents` table)
- Project thesis, scope, and context summary injected into system prompt
- Conversations scoped to the project (`projectId` set)
- Compiled papers auto-saved to the project

**Standalone Mode** ("No Project (General Writing)"):
- Sources come from web clips (`web_clips` table)
- No project context injection -- uses base system prompt unless web clips selected
- Conversations have `projectId = null`
- Fetched via `GET /api/chat/conversations?standalone=true`

### Writing Model Selection

| Mode | Chat Model | Compile Model | Verify Model |
|------|-----------|---------------|--------------|
| Precision | `claude-opus-4-6` | `claude-opus-4-6` | `claude-opus-4-6` |
| Extended | `claude-sonnet-4-5-20250929` | `claude-sonnet-4-5-20250929` | `claude-sonnet-4-5-20250929` |

### Compile Flow

User clicks "Compile Paper" -> server reads full conversation -> assembles into polished paper.

| Aspect | Detail |
|--------|--------|
| Max tokens | 8192 |
| Endpoint | `POST /api/chat/conversations/:id/compile` |

**Compile prompt instructs Claude to:**
1. Include every piece of substantive writing the assistant produced
2. Preserve thesis and argument structure
3. Do NOT summarize or shorten -- include content in full
4. If same section was revised multiple times, use the LATEST version
5. Remove conversational chatter
6. Add only transitions, introduction (if missing), and conclusion
7. Compile bibliography from all cited sources
8. Do not fabricate source details
9. Output clean markdown with ## section headings

**After compilation:** Paper auto-saved to project as a document (if project mode).

### Verify Flow

User clicks "Verify" -> server sends compiled paper + full source materials for review.

| Aspect | Detail |
|--------|--------|
| Max tokens | 8192 |
| Endpoint | `POST /api/chat/conversations/:id/verify` |

**Verify prompt performs strict source verification.**

### Settings (stored per conversation)

| Setting | Options | Effect |
|---------|---------|--------|
| Tone | academic, casual, ap_style | Controls writing register and formality |
| Citation style | chicago, mla, apa | Determines citation format in-text and bibliography |
| Humanize prose | true/false (default true) | Enables "Humanize" button |
| No en-dashes | true/false | Adds instruction: "NEVER use em-dashes or en-dashes" |
| Writing model | precision, extended | Selects Opus vs Sonnet model |

### Source Context Limits

| Constant | Value | Purpose |
|----------|-------|---------|
| `MAX_SOURCE_EXCERPT_CHARS` | 2,000 | Max chars for source excerpt/summary |
| `MAX_SOURCE_FULLTEXT_CHARS` | 30,000 | Max chars per individual source |
| `MAX_SOURCE_TOTAL_FULLTEXT_CHARS` | 150,000 | Total budget across all sources |
| `MAX_CONTEXT_ESCALATIONS` | 2 | Max context escalation rounds per message |
| `RESERVED_TOKENS` | 10,000 | Reserved for system overhead |

---

## 11. Writing System (One-Shot Pipeline)

**Files:** `server/writingPipeline.ts`, `server/writingRoutes.ts`, `client/src/components/WritingPane.tsx`, `client/src/hooks/useWriting.ts`

**Endpoint:** `POST /api/write`

Generates a complete paper in one pass through 3 phases.

### Phase 1: Planner

| Aspect | Detail |
|--------|--------|
| Model | Haiku (default) or Sonnet (deepWrite) |
| Max tokens | 4096 |
| Output | JSON: `{ thesis, sections[], bibliography[] }` |

**Target word counts:**
- short: ~1500 words (3 pages)
- medium: ~2500 words (5 pages)
- long: ~4000 words (8 pages)

### Phase 2: Writer (per section)

| Aspect | Detail |
|--------|--------|
| Model | Haiku (default) or Sonnet (deepWrite) |
| Max tokens | 2x target words (or 8192+ with deepWrite) |
| Thinking | 4096 budget tokens (deepWrite only) |

### Phase 3: Stitcher

| Aspect | Detail |
|--------|--------|
| Model | Haiku (default) or Sonnet (deepWrite) |
| Max tokens | 8192 |
| Output | Complete markdown paper |

### SSE Event Types

| Event | Payload | When |
|-------|---------|------|
| `status` | `{ message, phase }` | Phase transitions |
| `plan` | `{ plan }` | After planning complete |
| `section` | `{ index, title, content }` | After each section written |
| `complete` | `{ fullText }` | Final assembled paper |
| `saved` | `{ savedPaper }` | Paper saved to project |
| `error` | `{ error }` | On failure |

---

## 12. Source Injection & Formatting

### How sources get into the AI's context

```
User selects project + sources (or web clips in standalone mode)
  |
loadConversationContext(conv, userId)
  |
  +-- If conv.projectId exists:
  |     loadProjectSources(projectId, selectedSourceIds)
  |       | Fetches project_documents + full document text
  |       | Filters to selectedSourceIds
  |       | Distributes fulltext budget (150K total / N sources)
  |     projectStorage.getProject(projectId)
  |       | Fetches project thesis, scope, contextSummary
  |
  +-- If no projectId:
        loadStandaloneWebClipSources(userId, selectedSourceIds)
          | Fetches web clips by ID from web_clips table
          | Formats as WritingSource with kind: "web_clip"
  |
formatSourceForPrompt(source)
  | Formats each source as structured text block
  |
buildWritingSystemPrompt(sources, project, citationStyle, tone, noEnDashes)
  | Embeds project context + all formatted sources into system prompt
  |
anthropic.messages.stream({ system: prompt, ... })
```

### Size limits
- Excerpt: max 2,000 characters
- Per-source fulltext: max 30,000 characters
- Total fulltext budget: 150,000 characters across all sources
- Per-source limit dynamically computed: `min(30000, max(2000, 150000 / N))`

---

## 13. Citation System

**File:** `server/citationGenerator.ts`

### CitationData structure

```typescript
{
  sourceType: "book" | "journal" | "website" | "newspaper" | "chapter" | "thesis" | "other"
  authors: Array<{ firstName: string, lastName: string, suffix?: string }>
  title: string
  subtitle?: string
  containerTitle?: string
  publisher?: string
  publicationPlace?: string
  publicationDate?: string
  volume?: string
  issue?: string
  pageStart?: string
  pageEnd?: string
  url?: string
  accessDate?: string
  doi?: string
  edition?: string
  editors?: Array<{ firstName: string, lastName: string }>
}
```

### Supported styles
- **Chicago** -- footnotes + bibliography
- **MLA** -- in-text parenthetical + works cited
- **APA** -- in-text parenthetical + references

---

## 14. Humanizer System

**Files:** `server/humanizer.ts`, `server/humanizerRoutes.ts`, `client/src/hooks/useHumanizer.ts`, `prompts/humanizer.txt`

### Architecture

```
WritingChat "Humanize" button
  |
  v
useHumanizeText() mutation  ->  POST /api/humanize (requireAuth)
                                    |
                                    v
                               humanizeText()
                                    |
                          +----------+---------+
                          v                    v
                   Gemini (primary)     Anthropic (fallback)
                   gemini-2.5-flash-lite    claude-opus-4-6
```

### Provider strategy
1. If `GEMINI_API_KEY` is set, try Google Gemini first (cheaper)
2. If Gemini fails or key is absent, fall back to Anthropic
3. If neither key is configured, returns 503

### API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/humanize` | Yes | Humanize text |

**Request body:** `{ text: string, model?: string, temperature?: number }`
**Validation:** `text` max 50,000 characters, `temperature` clamped 0-1

---

## 15. Web Clips & Chrome Extension

**Files:** `server/webClipRoutes.ts`, `server/extensionRoutes.ts`

### Web Clips
- Store webpage highlights with URL, title, author, date
- Support categories and tags
- Optional project/document association

### Chrome Extension
- `POST /api/extension/save` -- saves highlight from browser
- Auto-generates citation data from webpage metadata
- Simplified flow (no separate ExtensionAuth page)

---

## 16. Environment Variables

### Required

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude API key |
| `CLERK_SECRET_KEY` | Clerk backend auth key |
| `CLERK_PUBLISHABLE_KEY` | Clerk frontend auth key |

### Optional

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | 5001 | Server port |
| `NODE_ENV` | - | development / production |
| `ALLOWED_ORIGINS` | "" | CORS whitelist (comma-separated) |
| `OPENAI_API_KEY` | - | OpenAI key (annotations, embeddings, OCR) |
| `VISION_OCR_MODEL` | "gpt-4o" | OCR model |
| `MAX_COMBINED_UPLOAD_FILES` | 25 | Max batch upload files |
| `GEMINI_API_KEY` | - | Google Gemini key (humanizer primary) |
| `GEMINI_HUMANIZER_MODEL` | `gemini-2.5-flash-lite` | Override humanizer model |
| `HUMANIZER_ANTHROPIC_MODEL` | `claude-opus-4-6` | Override humanizer fallback |

---

## 17. All API Endpoints

### Auth (`server/authRoutes.ts`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Create account (legacy, Clerk primary) |
| POST | `/api/auth/login` | Sign in (legacy) |
| POST | `/api/auth/logout` | Sign out |
| GET | `/api/auth/me` | Current user profile |
| PUT | `/api/auth/me` | Update profile |
| GET | `/api/auth/usage` | Token/storage usage |

### Documents (`server/routes.ts`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/upload` | Upload single file |
| POST | `/api/upload-group` | Batch image upload |
| GET | `/api/documents` | List all documents |
| GET | `/api/documents/meta` | Lightweight metadata |
| GET | `/api/documents/:id` | Full document |
| GET | `/api/documents/:id/status` | Processing status |
| POST | `/api/documents/:id/set-intent` | Trigger AI analysis |
| GET | `/api/documents/:id/annotations` | List annotations |
| POST | `/api/documents/:id/annotate` | Create manual annotation |
| PUT | `/api/annotations/:id` | Update annotation |
| DELETE | `/api/annotations/:id` | Delete annotation |
| POST | `/api/documents/:id/search` | Semantic search |
| GET | `/api/documents/:id/summary` | Get AI summary |

### Projects (`server/projectRoutes.ts`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects` | List projects |
| POST | `/api/projects` | Create project |
| GET | `/api/projects/:id` | Get project |
| PUT | `/api/projects/:id` | Update project |
| DELETE | `/api/projects/:id` | Delete project |
| GET | `/api/projects/:id/documents` | List project documents |
| POST | `/api/projects/:id/documents` | Add document to project |
| POST | `/api/projects/:id/documents/batch` | Batch add documents |
| DELETE | `/api/projects/:id/documents/:docId` | Remove document |
| GET | `/api/projects/:id/documents/:docId/annotations` | List project annotations |
| POST | `/api/projects/:id/documents/:docId/annotations` | Create annotation |
| POST | `/api/projects/:id/documents/:docId/analyze` | AI analyze document |
| POST | `/api/projects/:id/documents/:docId/analyze-multi` | Multi-prompt analysis |
| POST | `/api/projects/:id/documents/:docId/search` | Search document |
| PUT | `/api/projects/:id/annotations/:annId` | Update annotation |
| DELETE | `/api/projects/:id/annotations/:annId` | Delete annotation |
| POST | `/api/projects/:id/batch-analysis` | Batch analyze documents |
| POST | `/api/projects/:id/search` | Search across project |
| POST | `/api/projects/:id/citations/generate` | Generate citations |
| POST | `/api/projects/:id/citations/compile-bibliography` | Compile bibliography |
| GET | `/api/projects/:id/folders` | List folders |
| POST | `/api/projects/:id/folders` | Create folder |
| PUT | `/api/projects/:id/folders/:folderId` | Update folder |
| DELETE | `/api/projects/:id/folders/:folderId` | Delete folder |

### Chat (`server/chatRoutes.ts`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/chat/conversations` | List conversations |
| POST | `/api/chat/conversations` | Create conversation |
| GET | `/api/chat/conversations/:id` | Get conversation + messages |
| PUT | `/api/chat/conversations/:id` | Update settings/title |
| DELETE | `/api/chat/conversations/:id` | Delete conversation |
| PUT | `/api/chat/conversations/:id/sources` | Update source selection |
| POST | `/api/chat/conversations/:id/messages` | Send message (SSE stream) |
| POST | `/api/chat/conversations/:id/compile` | Compile paper (SSE stream) |
| POST | `/api/chat/conversations/:id/verify` | Verify paper (SSE stream) |

### Writing (`server/writingRoutes.ts`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/write` | One-shot paper generation (SSE stream) |

### Humanizer (`server/humanizerRoutes.ts`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/humanize` | Humanize text |

### Web Clips (`server/webClipRoutes.ts`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/web-clips` | List clips |
| POST | `/api/web-clips` | Create clip |
| GET | `/api/web-clips/:id` | Get single clip |
| PUT | `/api/web-clips/:id` | Update clip |
| DELETE | `/api/web-clips/:id` | Delete clip |

### Extension (`server/extensionRoutes.ts`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/extension/save` | Save highlight from Chrome extension |

---

## Model Usage Summary

| Feature | Model | Max Tokens | Notes |
|---------|-------|-----------|-------|
| Chat (precision) | `claude-opus-4-6` | 8192 | 200K context window |
| Chat (extended) | `claude-sonnet-4-5-20250929` | 8192 | 200K context window |
| Compile paper | Model per writing mode | 8192 | Full conversation + sources |
| Verify paper | Model per writing mode | 8192 | Full source materials + paper |
| Research agent | `claude-sonnet-4-5-20250929` | - | Autonomous finding extraction |
| Planning (default) | `claude-haiku-4-5-20251001` | 4096 | One-shot pipeline |
| Planning (deep) | `claude-sonnet-4-5-20241022` | 4096 | Extended thinking |
| Section writing | Haiku or Sonnet | 2x target words | Per section |
| Stitching | Haiku or Sonnet | 8192 | Final assembly |
| Auto-title | `claude-haiku-4-5-20251001` | 30 | Short title from first message |
| Humanizer (primary) | `gemini-2.5-flash-lite` | - | Google Gemini REST API |
| Humanizer (fallback) | `claude-opus-4-6` | 4096 | Anthropic SDK |
| Annotations | `gpt-4o-mini` | - | OpenAI (pipeline V2) |
| Embeddings | `text-embedding-3-small` | - | OpenAI |
| Vision OCR | `gpt-4o` | - | OpenAI |

---

## Key Architectural Patterns

1. **SSE Streaming** -- All AI responses streamed via Server-Sent Events with JSON payloads
2. **Source Clipping** -- Excerpts max 2000 chars, full text max 30000 chars per source (150K total budget)
3. **Two annotation layers** -- Document-global + project-scoped
4. **Per-conversation settings** -- Citation style, tone, humanize, model, source selection persist per chat
5. **Clerk authentication** -- Session-based auth with tier-gated features
6. **React Query invalidation** -- Mutations refresh related queries (`staleTime: Infinity`)
7. **V2 AI pipeline** -- Generator -> Hard Verifier -> Soft Verifier for annotation quality
8. **Multi-provider AI** -- Anthropic (chat/writing), OpenAI (annotations/OCR), Gemini (humanizer)
9. **Context escalation** -- AI can request additional document context via XML tool tags (max 2 rounds)
10. **Research agent** -- Autonomous source discovery and quote extraction

---

## 18. Directory Structure

```
anotations-jan-26/ (dev branch)
├── .claude/                           # Claude Code configuration
│   ├── agents/                        # Agent personas
│   ├── commands/                      # Custom commands
│   ├── skills/                        # Custom skills
│   └── code-review-standards.md
├── .claude-docs/                      # Internal documentation
│   ├── overview.md
│   ├── server-api.md
│   ├── server-internals.md
│   ├── client-architecture.md
│   ├── database-schema.md
│   └── config-and-setup.md
├── chrome-extension/                  # Chrome extension (Manifest V3)
│   ├── manifest.json
│   ├── background/background.js
│   ├── content/content.js
│   ├── popup/
│   ├── options/
│   └── icons/
├── server/                            # Express backend (~29 TS files)
│   ├── index.ts                       # Entry point + middleware
│   ├── auth.ts                        # Clerk authentication
│   ├── authRoutes.ts                  # Auth endpoints
│   ├── authStorage.ts                 # User CRUD
│   ├── routes.ts                      # Document API
│   ├── projectRoutes.ts               # Project API (49KB)
│   ├── chatRoutes.ts                  # Chat/writing API (46KB)
│   ├── writingRoutes.ts               # One-shot writing endpoint
│   ├── writingPipeline.ts             # Writing pipeline (15KB)
│   ├── chatStorage.ts                 # Conversation CRUD
│   ├── projectStorage.ts              # Project CRUD
│   ├── storage.ts                     # Document CRUD
│   ├── pipelineV2.ts                  # 3-phase annotation pipeline (32KB)
│   ├── openai.ts                      # OpenAI integration (27KB)
│   ├── humanizer.ts                   # Humanizer (Gemini/Anthropic)
│   ├── humanizerRoutes.ts             # Humanizer endpoint
│   ├── researchAgent.ts               # Research agent (10KB)
│   ├── citationGenerator.ts           # Citation formatting (28KB)
│   ├── contextGenerator.ts            # Context generation
│   ├── chunker.ts                     # Text segmentation
│   ├── ocrProcessor.ts                # OCR pipeline (42KB)
│   ├── ocrQueue.ts                    # Background OCR queue (11KB)
│   ├── projectSearch.ts               # Semantic search
│   ├── webClipRoutes.ts               # Web clip endpoints
│   ├── extensionRoutes.ts             # Chrome extension endpoint
│   ├── sourceFiles.ts                 # Source file storage
│   ├── db.ts                          # Drizzle ORM + table init
│   ├── vite.ts                        # Dev server
│   └── static.ts                      # Production static serving
├── client/src/                        # React frontend
│   ├── main.tsx                       # Entry point
│   ├── App.tsx                        # Router (12 routes)
│   ├── index.css                      # Global styles + themes
│   ├── pages/                         # Page components (11)
│   │   ├── Home.tsx, Projects.tsx, ProjectWorkspace.tsx
│   │   ├── ProjectDocument.tsx, Chat.tsx, WritingPage.tsx
│   │   ├── WebClips.tsx, Login.tsx, Register.tsx
│   │   ├── Pricing.tsx, not-found.tsx
│   ├── components/                    # UI components (~70 files)
│   │   ├── chat/                      # Chat subcomponents (5)
│   │   │   ├── ChatMessages.tsx, ChatInput.tsx
│   │   │   ├── ChatSidebar.tsx, DocumentPanel.tsx
│   │   │   └── DocumentStatusCard.tsx
│   │   ├── ui/                        # Radix/shadcn components (60+)
│   │   └── (25+ custom components)
│   ├── hooks/                         # React Query hooks (10)
│   │   ├── useChat.ts, useWritingChat.ts, useWriting.ts
│   │   ├── useDocument.ts, useProjects.ts, useProjectSearch.ts
│   │   ├── useWebClips.ts, useHumanizer.ts
│   │   ├── use-toast.ts, use-mobile.tsx
│   └── lib/                           # Utilities
│       ├── queryClient.ts, auth.ts, utils.ts
│       ├── clipboard.ts, documentExport.ts
├── shared/
│   └── schema.ts                      # Drizzle + Zod schemas (664 lines)
├── scripts/
│   ├── build.ts                       # Production build script
│   ├── migrate.cjs                    # Migration CLI
│   └── sql/                           # SQL scripts
├── prompts/humanizer.txt              # Humanizer system prompt
├── ARCHITECTURE.md                    # This file
├── CODEBASE_INVENTORY.md              # File inventory
├── CODEBASE_REFERENCE.md              # Detailed reference (68KB)
├── TASK-*.md                          # Task specs (6 files)
├── package.json                       # Dependencies
├── tsconfig.json, vite.config.ts, drizzle.config.ts
├── tailwind.config.ts, postcss.config.js
└── components.json                    # shadcn configuration
```

### File Statistics

| Category | Count |
|----------|-------|
| Server TS files | ~29 |
| Client TSX/TS files | ~70 |
| Shared TS files | 1 |
| UI library components | 60+ |
| Custom components | 25+ |
| React hooks | 10 |
| API endpoints | 45+ |
| Database tables | 11 |
| Route files | 6 |
