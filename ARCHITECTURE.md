# ScholarMark Architecture Reference

> Updated 2026-02-27. Covers the full codebase of `anotations-jan-26` after Opus upgrade + humanizer integration.

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
14. [Document Export (PDF / DOCX)](#14-document-export-pdf--docx)
15. [Humanizer System](#15-humanizer-system)
16. [Web Clips & Chrome Extension](#16-web-clips--chrome-extension)
17. [Environment Variables](#17-environment-variables)
18. [All API Endpoints](#18-all-api-endpoints)

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
| AI | Anthropic SDK | 0.78 |
| Auth | JWT + bcrypt | jsonwebtoken 9, bcrypt 6 |
| PDF gen | pdf-lib | 1.17 |
| DOCX gen | docx (via markdownToDocx) | 9.6 |
| Markdown parsing | unified + remark-parse + remark-gfm | 11 / 4 |
| File uploads | Multer | 2.0 (50 MB limit) |
| Image processing | Sharp | 0.34 |
| PDF text extraction | pdf-parse | 2.4 |
| Markdown rendering | react-markdown | 10.1 |
| AI (humanizer) | Google Gemini REST API (primary) / Anthropic SDK (fallback) | - |

**Database file:** `data/sourceannotator.db`
**Default port:** `5001`

---

## 2. App Routes & Pages

Defined in `client/src/App.tsx`. All content routes are wrapped in `<ProtectedRoute>`.

| Route | Component | Auth | Purpose |
|-------|-----------|------|---------|
| `/login` | Login | No | Sign in |
| `/register` | Register | No | Create account |
| `/` | Home | Yes | Dashboard |
| `/projects` | Projects | Yes | Project list |
| `/web-clips` | WebClips | Yes | Web clip collection |
| `/projects/:id` | ProjectWorkspace | Yes | Project workspace (Documents + Write tabs) |
| `/projects/:projectId/documents/:docId` | ProjectDocument | Yes | Document viewer with annotations |
| `/chat` | Chat | Yes | Standalone chatbot |
| `/chat/:conversationId` | Chat | Yes | Specific conversation |
| `/write` | WritingPage | Yes | Chat-based writing (alias) |
| `/writing` | WritingPage | Yes | Chat-based writing |

---

## 3. Server Entry & Middleware

**File:** `server/index.ts`

Startup order:
1. Load `.env` via dotenv
2. Create Express app + HTTP server
3. CORS (allows chrome-extension, localhost, 89.167.10.34, `ALLOWED_ORIGINS`)
4. `express.json()` with raw body capture
5. Passport auth setup
6. Auth routes registered first
7. All other routes via `registerRoutes()`
8. Vite dev server (dev) or static file serving (prod)
9. Listen on port 5001

**Request logging:** All `/api` endpoints logged with duration, status code, and truncated response body.

---

## 4. Database Schema

**File:** `shared/schema.ts`

### users
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| email | TEXT UNIQUE | |
| username | TEXT UNIQUE | |
| password | TEXT | bcrypt hash (12 rounds) |
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

---

## 5. Authentication System

**Files:** `server/auth.ts`, `server/authRoutes.ts`, `server/authStorage.ts`, `client/src/lib/auth.ts`

- **Method:** Stateless JWT (7-day expiry)
- **Password:** bcrypt with 12 salt rounds
- **Client storage:** `localStorage` key `scholarmark_token`
- **Header format:** `Authorization: Bearer <token>`
- **Middleware:** `requireAuth` (rejects 401) and `optionalAuth` (attaches user if present)
- **Tiers:** free (50K tokens, 50MB storage), pro, max

---

## 6. Document Upload & Processing

**File:** `server/routes.ts`

### Supported formats
- **PDF:** Standard text extraction via pdf-parse, or OCR modes (advanced, vision, vision_batch)
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

A simple conversational chatbot with no project context.

| Aspect | Detail |
|--------|--------|
| Model | `claude-opus-4-6` |
| Max tokens | 8192 |
| System prompt | Generic ScholarMark AI assistant (or source-aware if web clips selected) |
| Streaming | SSE with `{type: "text"/"done"/"error"}` events |
| Auto-title | Generated from first user message |

The standalone chat page (`/chat`) uses the base system prompt. The writing page (`/writing`) in "No Project" mode can attach web clips as sources.

---

## 10. Writing System (Chat-Based)

**Files:** `server/chatRoutes.ts`, `client/src/components/WritingChat.tsx`, `client/src/hooks/useWritingChat.ts`

**Route:** `/writing` (standalone) or Project Workspace -> Write tab

This is the primary writing workflow -- an iterative chat where the AI has access to project sources and can write paper sections on request. All writing features use **Opus 4.6**.

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
- Frontend uses `useStandaloneConversations()` hook

### Chat Message Flow

1. User sends message
2. Server loads conversation history
3. Server calls `loadConversationContext(conv, userId)`:
   - If `conv.projectId` exists: loads project metadata + project documents
   - If no project: loads selected web clips as sources via `loadStandaloneWebClipSources()`
4. `buildWritingSystemPrompt()` creates source-aware prompt with project context
5. Opus 4.6 responds with source-aware content

| Aspect | Detail |
|--------|--------|
| Model | `claude-opus-4-6` (constant `CHAT_MODEL`) |
| Max tokens | 8192 (constant `CHAT_MAX_TOKENS`) |
| System prompt | Source-aware with project context (see [Section 12](#12-source-injection--formatting)) |
| Streaming | SSE |

### Compile Flow

User clicks "Compile Paper" -> server reads full conversation -> assembles into polished paper.

| Aspect | Detail |
|--------|--------|
| Model | `claude-opus-4-6` (constant `COMPILE_MODEL`) |
| Max tokens | 8192 (constant `COMPILE_MAX_TOKENS`) |
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

**Project context and source materials** are appended to the compile prompt for bibliography generation.

**After compilation:** Paper auto-saved to project as a document (if project mode).

### Verify Flow

User clicks "Verify" -> server sends compiled paper + full source materials for review.

| Aspect | Detail |
|--------|--------|
| Model | `claude-opus-4-6` (constant `VERIFY_MODEL`) |
| Max tokens | 8192 (constant `VERIFY_MAX_TOKENS`) |
| Endpoint | `POST /api/chat/conversations/:id/verify` |

**Verify prompt performs strict source verification:**
1. Cross-reference every direct quote against the provided source text
2. Check whether paraphrases accurately reflect source content
3. Verify page numbers / section references
4. Flag any citation that doesn't correspond to provided sources
5. Check citation and bibliography formatting consistency
6. Identify unsupported or over-claimed assertions
7. Review logical flow, argument coherence, tone consistency, grammar

**Output format:** Executive summary, numbered findings (highest severity first) with location/issue/fix, optional strengths section.

**Full source materials** are now injected into verify (not just title/author/excerpt), enabling real quote verification.

### Settings (stored per conversation)

| Setting | Options | Effect |
|---------|---------|--------|
| Tone | academic, casual, ap_style | Controls writing register and formality |
| Citation style | chicago, mla, apa | Determines citation format in-text and bibliography |
| Humanize prose | true/false (default true) | Enables "Humanize" button; stored as `humanize` on conversation |
| No en-dashes | true/false | Adds instruction: "NEVER use em-dashes or en-dashes" |

### Source Selection

- **Project mode:** All project documents auto-selected on first conversation creation
- **Standalone mode:** Web clips shown as selectable sources
- User can deselect/reselect individual sources via checkboxes
- Selection saved to conversation's `selectedSourceIds` field
- Only selected sources are injected into AI context

### Source Context Limits

| Constant | Value | Purpose |
|----------|-------|---------|
| `MAX_SOURCE_EXCERPT_CHARS` | 2,000 | Max chars for source excerpt/summary |
| `MAX_SOURCE_FULLTEXT_CHARS` | 30,000 | Max chars per individual source |
| `MAX_SOURCE_TOTAL_FULLTEXT_CHARS` | 150,000 | Total budget across all sources |

When multiple sources are loaded, the per-source fulltext limit is dynamically computed as `min(30000, max(2000, 150000 / sourceCount))` to distribute the budget evenly.

### Props

```typescript
interface WritingChatProps {
  initialProjectId?: string;  // Pre-select project
  lockProject?: boolean;      // Hide project selector (used in ProjectWorkspace)
}
```

---

## 11. Writing System (One-Shot Pipeline)

**Files:** `server/writingPipeline.ts`, `server/writingRoutes.ts`, `client/src/components/WritingPane.tsx`, `client/src/hooks/useWriting.ts`

**Endpoint:** `POST /api/write`

Accessible via "Quick Generate" dialog in WritingChat. Generates a complete paper in one pass through 3 phases.

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

The planner creates a structured outline with thesis, section titles, descriptions, source assignments, and target word counts per section.

### Phase 2: Writer (per section)

| Aspect | Detail |
|--------|--------|
| Model | Haiku (default) or Sonnet (deepWrite) |
| Max tokens | 2x target words (or 8192+ with deepWrite) |
| Thinking | 4096 budget tokens (deepWrite only) |
| Output | Markdown section with heading |

Each section is written independently with the full outline for context. Sources assigned to each section are injected.

### Phase 3: Stitcher

| Aspect | Detail |
|--------|--------|
| Model | Haiku (default) or Sonnet (deepWrite) |
| Max tokens | 8192 |
| Output | Complete markdown paper |

Combines all sections, adds transitions, introduction, conclusion, and bibliography.

### Deep Write Mode

When `deepWrite: true`:
- Uses `claude-sonnet-4-5-20241022` instead of Haiku
- Enables extended thinking (4096 budget tokens)
- Increases max output tokens to 8192+
- Produces higher quality but costs more

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
loadConversationContext(conv, userId)                  [chatRoutes.ts:183-210]
  |
  +-- If conv.projectId exists:
  |     loadProjectSources(projectId, selectedSourceIds) [chatRoutes.ts:70-116]
  |       | Fetches project_documents + full document text
  |       | Filters to selectedSourceIds
  |       | Distributes fulltext budget (150K total / N sources)
  |     projectStorage.getProject(projectId)
  |       | Fetches project thesis, scope, contextSummary
  |
  +-- If no projectId:
        loadStandaloneWebClipSources(userId, selectedSourceIds) [chatRoutes.ts:118-181]
          | Fetches web clips by ID from web_clips table
          | Formats as WritingSource with kind: "web_clip"
  |
formatSourceForPrompt(source)                          [writingPipeline.ts:86-116]
  | Formats each source as structured text block
  |
buildWritingSystemPrompt(sources, project, citationStyle, tone, noEnDashes) [chatRoutes.ts:212-247]
  | Embeds project context + all formatted sources into system prompt
  |
anthropic.messages.stream({ system: prompt, ... })
```

### Source format template (project documents)

```
[SOURCE projectdoc-{id}]
Type: project_document
Document: {filename}
Title: {title}
Author(s): {author}
Category: project_source
Citation Author(s): {firstName lastName, ...}
Citation Title: {title: subtitle}
Date: {publicationDate}
Publisher: {publisher}
In: {containerTitle}
Pages: {pageStart}-{pageEnd}
URL: {url}
Excerpt: "{summary or first 2000 chars}"
Content Snippet:
{up to 30000 chars of fullText, budget-distributed}
```

### Source format template (web clips, standalone mode)

```
[SOURCE webclip-{id}]
Type: web_clip
Page: {pageTitle}
URL: {sourceUrl}
Author: {authorName}
Published: {publishDate}

Highlighted text:
{highlightedText}

Surrounding context:
{surroundingContext}

User note:
{note}
```

### Size limits
- Excerpt: max 2,000 characters (was 700)
- Per-source fulltext: max 30,000 characters (was 7,000)
- Total fulltext budget: 150,000 characters across all sources
- Per-source limit dynamically computed: `min(30000, max(2000, 150000 / N))`

### System prompt (with sources and project context)

```
You are ScholarMark AI, an expert academic writing partner. You are collaborating
with a student on a research paper.

PROJECT CONTEXT:
Project: {project.name}
Thesis: {project.thesis}
Scope: {project.scope}
Summary: {project.contextSummary}

You have access to {N} source document(s).

SOURCE MATERIALS:
{all formatted sources}

When the student asks you to write, draft, expand, or refine content:
1. Write in {tone} register with {STYLE} citations.
2. Ground every claim in the provided sources and cite specific page numbers
   or section references when available.
3. When quoting a source, use exact source text.
4. Distinguish direct quotations from paraphrases.
5. Explicitly flag claims that go beyond what the provided sources support.
6. Maintain the student's argumentative thread across the full conversation
   and build on what has already been drafted.
7. When asked to write a section, produce complete, publication-ready prose
   (not an outline).
[8. NEVER use em-dashes or en-dashes. -- only if noEnDashes is true]

Do not fabricate quotations, publication details, page numbers, or bibliography
metadata. If source detail is uncertain, state uncertainty clearly and cite
conservatively.
```

### System prompt (no sources, no project)

```
You are ScholarMark AI, a helpful academic writing assistant. You help students
with research, writing, citations, and understanding academic sources. Be concise,
accurate, and helpful.
```

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
  containerTitle?: string    // Journal or book name
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

### Where citations appear

1. **Project documents** -- `citationData` JSON field on `project_documents`
2. **Web clips** -- auto-generated `footnote` and `bibliography` fields
3. **AI writing** -- prompted to use citation style in system prompt
4. **Compile** -- bibliography assembled from conversation context + sources
5. **Verify** -- checks citation format accuracy

---

## 14. Document Export (PDF / DOCX)

**Files:** `client/src/lib/documentExport.ts`, `client/src/lib/markdownToDocx.ts`

All export happens **client-side** -- no server round-trip needed. Both exporters parse the markdown AST for rich formatting.

### PDF (pdf-lib)

- Font: Times Roman (body 11pt), Times Roman Bold (heading 15pt)
- Page: Letter (612x792), margins 48px (~0.67")
- Line height: 15px
- Auto word-wrap based on font metrics
- Auto page breaks
- Color: dark gray `rgb(0.08, 0.08, 0.08)`

### DOCX (docx library via markdownToDocx)

- **File:** `client/src/lib/markdownToDocx.ts`
- Parses markdown AST via unified/remark-parse/remark-gfm
- Rich formatting: bold, italic, superscript footnote references, headings, lists, hyperlinks
- Footnotes rendered as Word footnotes
- Page: 8.5"x11" with 1" margins
- Font: configurable (default Times New Roman body, heading styles)

### Utilities

| Function | Purpose |
|----------|---------|
| `stripMarkdown(md)` | Remove all markdown syntax -> plain text |
| `toSafeFilename(s)` | Escape illegal filename chars, max 80 chars |
| `downloadBlob(blob, name)` | Trigger browser download |
| `buildDocxBlob(title, content)` | Generate DOCX blob (via markdownToDocx) |
| `buildPdfBlob(title, content)` | Generate PDF blob (via pdf-lib with markdown AST) |
| `getDocTypeLabel(filename)` | Return "PDF" / "TXT" / "IMAGE" / "DOC" |
| `copyTextToClipboard(text)` | Copy to clipboard (`lib/clipboard.ts`) with fallback for older browsers |

---

## 15. Humanizer System

**Files:** `server/humanizer.ts`, `server/humanizerRoutes.ts`, `client/src/hooks/useHumanizer.ts`, `prompts/humanizer.txt`

Rewrites AI-generated text to sound more human/natural. Ported from the [ai-humanizer](https://github.com/dixon2004/ai-humanizer) project (MIT).

### Architecture

```
WritingChat "Humanize" button
  |
  v
useHumanizeText() mutation  →  POST /api/humanize (requireAuth)
                                    |
                                    v
                               humanizeText()
                                    |
                          ┌─────────┴─────────┐
                          v                   v
                   Gemini (primary)    Anthropic (fallback)
                   gemini-2.5-flash-lite    claude-opus-4-6
```

### Provider strategy
1. If `GEMINI_API_KEY` is set, try Google Gemini first (cheaper for this task)
2. If Gemini fails or key is absent, fall back to Anthropic (requires `ANTHROPIC_API_KEY`)
3. If neither key is configured, returns 503

### Prompt template

Loaded from `prompts/humanizer.txt` at startup (cached). Falls back to hardcoded template if file is missing. Rules enforce: simple language, active voice, no colons/semicolons/dashes, varied sentence length, occasional grammar quirks, output-only (no explanations).

### API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/humanize` | Yes | Humanize text |

**Request body:** `{ text: string, model?: string, temperature?: number }`
**Response:** `{ humanizedText: string, provider: "gemini" | "anthropic", model: string, tokensUsed?: number }`

**Validation:**
- `text` required, max 50,000 characters
- `temperature` must be finite number (clamped 0-1, default 0.7)
- Token usage auto-incremented on user's `tokensUsed` counter

### Frontend integration

- **Toggle:** "Humanize prose" checkbox in conversation settings (stored as `humanize` column on `conversations`)
- **Button:** "Humanize Compiled Paper" in WritingChat right panel (appears after compile)
- **Revert:** "Revert to Original" button restores pre-humanized compiled content
- **State:** `humanizedCompiledContent` tracked in WritingChat; `effectiveCompiledContent` switches between original and humanized for display/export

### Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `GEMINI_API_KEY` | - | Google Gemini API key (primary provider) |
| `GEMINI_HUMANIZER_MODEL` | `gemini-2.5-flash-lite` | Override Gemini model |
| `HUMANIZER_ANTHROPIC_MODEL` | `claude-opus-4-6` | Override Anthropic fallback model |

---

## 16. Web Clips & Chrome Extension

**Files:** `server/webClipRoutes.ts`, `server/extensionRoutes.ts`

### Web Clips
- Store webpage highlights with URL, title, author, date
- Support categories and tags
- Optional project/document association
- Can be promoted to full project annotations

### Chrome Extension
- `POST /api/extension/save` -- saves highlight from browser
- Auto-generates citation data from webpage metadata
- Auto-assigns to first project (or creates "Web Highlights" project)

---

## 17. Environment Variables

### Required

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude API key |
| `JWT_SECRET` | JWT signing key (has dev fallback) |

### Optional

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | 5001 | Server port |
| `NODE_ENV` | - | development / production |
| `ALLOWED_ORIGINS` | "" | CORS whitelist (comma-separated) |
| `VISION_OCR_MODEL` | "gpt-4o" | OCR model |
| `MAX_COMBINED_UPLOAD_FILES` | 25 | Max batch upload files |
| `GEMINI_API_KEY` | - | Google Gemini key (humanizer primary provider) |
| `GEMINI_HUMANIZER_MODEL` | `gemini-2.5-flash-lite` | Override humanizer Gemini model |
| `HUMANIZER_ANTHROPIC_MODEL` | `claude-opus-4-6` | Override humanizer Anthropic fallback model |

---

## 18. All API Endpoints

### Auth (`server/authRoutes.ts`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Sign in -> JWT |
| POST | `/api/auth/logout` | Sign out (client-side) |
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
| GET | `/api/documents/:id/source-meta` | Source file metadata |
| GET | `/api/documents/:id/source` | Stream original file |
| POST | `/api/documents/:id/set-intent` | Trigger AI analysis |
| GET | `/api/documents/:id/annotations` | List annotations |
| POST | `/api/documents/:id/annotate` | Create manual annotation |
| PUT | `/api/annotations/:id` | Update annotation |
| DELETE | `/api/annotations/:id` | Delete annotation |
| POST | `/api/documents/:id/search` | Semantic search |
| GET | `/api/documents/:id/summary` | Get AI summary |
| GET | `/api/system/status` | System diagnostics |

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
| GET | `/api/chat/conversations` | List conversations (optional `?projectId=`) |
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
| POST | `/api/humanize` | Humanize text (Gemini primary, Anthropic fallback) |

### Web Clips (`server/webClipRoutes.ts`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/web-clips` | List clips (with pagination/filtering) |
| POST | `/api/web-clips` | Create clip |
| GET | `/api/web-clips/:id` | Get single clip |
| PUT | `/api/web-clips/:id` | Update clip |
| DELETE | `/api/web-clips/:id` | Delete clip |
| POST | `/api/web-clips/:id/promote` | Promote to project annotation |

### Extension (`server/extensionRoutes.ts`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/extension/save` | Save highlight from Chrome extension |

---

## Model Usage Summary

| Feature | Model | Max Tokens | Notes |
|---------|-------|-----------|-------|
| Chat (standalone) | `claude-opus-4-6` | 8192 | Web clips as sources |
| Chat (project) | `claude-opus-4-6` | 8192 | Project docs in system prompt + project context |
| Compile paper | `claude-opus-4-6` | 8192 | Reads full conversation + sources + project context |
| Verify paper | `claude-opus-4-6` | 8192 | Full source materials + compiled paper |
| Planning (default) | `claude-haiku-4-5-20251001` | 4096 | Generates outline (one-shot pipeline) |
| Planning (deep) | `claude-sonnet-4-5-20241022` | 4096 | With extended thinking (one-shot pipeline) |
| Section writing (default) | `claude-haiku-4-5-20251001` | 2x target words | Per section (one-shot pipeline) |
| Section writing (deep) | `claude-sonnet-4-5-20241022` | 8192+ | Extended thinking (one-shot pipeline) |
| Stitching (default) | `claude-haiku-4-5-20251001` | 8192 | Assembles final paper (one-shot pipeline) |
| Stitching (deep) | `claude-sonnet-4-5-20241022` | 8192 | Better assembly (one-shot pipeline) |
| Auto-title | `claude-haiku-4-5-20251001` | 30 | Short title from first message |
| Humanizer (primary) | `gemini-2.5-flash-lite` | - | Via Google Gemini REST API |
| Humanizer (fallback) | `claude-opus-4-6` | 4096 | Via Anthropic SDK when Gemini unavailable |

---

## Key Architectural Patterns

1. **SSE Streaming** -- All AI responses streamed via Server-Sent Events with JSON payloads
2. **Source Clipping** -- Excerpts max 2000 chars, full text max 30000 chars per source (150K total budget distributed dynamically)
3. **Two annotation layers** -- Document-global + project-scoped
4. **Per-conversation settings** -- Citation style, tone, humanize, source selection persist per chat
5. **Client-side export** -- PDF/DOCX generated in browser (pdf-lib for PDF, docx library with markdown AST for DOCX), no server needed
6. **React Query invalidation** -- Mutations automatically refresh related queries (`staleTime: Infinity` — relies on explicit invalidation)
7. **V2 AI pipeline** -- Generator -> Hard Verifier -> Soft Verifier for annotation quality
8. **Multi-provider AI** -- Anthropic (chat/writing/verify), OpenAI (annotation pipeline/OCR), Gemini (humanizer) with fallback chains
9. **Chat component decomposition** -- WritingChat delegates to `chat/ChatInput`, `chat/ChatMessages`, `chat/ChatSidebar`, `chat/DocumentPanel`, `chat/DocumentStatusCard`
