# ScholarMark Architecture Reference

> Updated 2026-03-11. Covers the full codebase after context optimization + Clerk auth + writing model selection.

---

## Table of Contents

1. [Tech Stack](#1-tech-stack)
2. [App Routes & Pages](#2-app-routes--pages)
3. [Server Entry & Middleware](#3-server-entry--middleware)
4. [Database Schema](#4-database-schema)
5. [Authentication System (Clerk + API Keys + MCP)](#5-authentication-system-clerk--api-keys--mcp)
6. [Document Upload & Processing](#6-document-upload--processing)
7. [Project System](#7-project-system)
8. [Annotation System](#8-annotation-system)
9. [Chat System (Standalone)](#9-chat-system-standalone)
10. [Writing System (Chat-Based)](#10-writing-system-chat-based)
11. [Context Optimization System](#11-context-optimization-system)
12. [Research Agent](#12-research-agent)
13. [Writing System (One-Shot Pipeline)](#13-writing-system-one-shot-pipeline)
14. [Source Injection & Formatting](#14-source-injection--formatting)
15. [Citation System](#15-citation-system)
16. [Document Export (PDF / DOCX)](#16-document-export-pdf--docx)
17. [Humanizer System](#17-humanizer-system)
18. [Web Clips & Chrome Extension](#18-web-clips--chrome-extension)
19. [Analytics & OAuth Provider](#19-analytics--oauth-provider)
20. [MCP Server](#20-mcp-server)
21. [Environment Variables](#21-environment-variables)
22. [All API Endpoints](#22-all-api-endpoints)

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
| Auth | Clerk (primary) + API keys + MCP OAuth tokens | @clerk/express |
| Analytics | `server/analyticsLogger.ts` + `server/analyticsRoutes.ts` | SQLite-backed |
| PDF gen | pdf-lib | 1.17 |
| DOCX gen | docx (via markdownToDocx) | 9.6 |
| Markdown parsing | unified + remark-parse + remark-gfm | 11 / 4 |
| File uploads | Multer | 2.0 (50 MB limit) |
| Image processing | Sharp | 0.34 |
| PDF text extraction | pdf-parse | 2.4 |
| Markdown rendering | react-markdown | 10.1 |
| AI (humanizer) | Google Gemini REST API (primary) / Anthropic SDK (fallback) | - |
| MCP Server | @modelcontextprotocol/sdk | 1.27 |

**Database file:** `data/sourceannotator.db`
**Default port:** `5001` (main app), `5002` (MCP server)

---

## 2. App Routes & Pages

Defined in `client/src/App.tsx`. All lazy-loaded via `React.lazy()`. Content routes wrapped in `<ProtectedRoute>`.

| Route | Component | Auth | Purpose |
|-------|-----------|------|---------|
| `/sign-in` | Login | No | Clerk sign-in |
| `/sign-up` | Register | No | Clerk sign-up |
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
| `/extension-auth` | ExtensionAuth | Yes | Chrome extension auth flow |
| `/admin/analytics` | AdminAnalytics | Yes | Admin analytics dashboard (lazy loaded) |

---

## 3. Server Entry & Middleware

**File:** `server/index.ts`

Startup order:
1. Load `.env` via dotenv
2. Create Express app + HTTP server
3. Trust proxy (`app.set("trust proxy", true)`)
4. CORS (allows `chrome-extension://`, `localhost`, `89.167.10.34`, `claude.ai`, `claude.com`, `mcp.scholarmark.ai`, `app.scholarmark.ai`, `ALLOWED_ORIGINS`)
5. `express.json()` with raw body capture
6. `express.urlencoded({ extended: false })`
7. Malformed URI rejection middleware
8. Clerk auth via `configureClerk(app)`
9. Request logging middleware (duration, status code, truncated response body)
10. OAuth routes via `registerOAuthRoutes(app)`
11. Auth routes via `registerAuthRoutes(app)`
12. All other routes via `registerRoutes(httpServer, app)`
13. Analytics init via `initAnalytics()`
14. Error handler middleware
15. Vite dev server (dev) or static file serving (prod)
16. Listen on port 5001

---

## 4. Database Schema

**File:** `shared/schema.ts`

### users
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| email | TEXT UNIQUE | |
| username | TEXT UNIQUE | |
| password | TEXT | Legacy, unused with Clerk auth (default empty) |
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
| sourceRole | TEXT | "evidence" / "style_reference" / "background" (default "evidence") |
| styleAnalysis | TEXT | JSON StyleAnalysis for style_reference sources |
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
| model | TEXT | Default: "claude-opus-4-6" |
| writingModel | TEXT | "precision" or "extended" (default "precision") |
| selectedSourceIds | JSON | string[] (project doc IDs) |
| citationStyle | TEXT | Default: "chicago" |
| tone | TEXT | Default: "academic" |
| humanize | BOOL | Default: true (auto-humanize on compile) |
| noEnDashes | BOOL | Default: false |
| evidenceClipboard | TEXT | JSON EvidenceClipboard (persistent evidence accumulation) |
| compactionSummary | TEXT | Haiku-generated conversation summary |
| compactedAtTurn | INT | Turn number through which history is compacted (default 0) |
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

### analytics_tool_calls
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| conversation_id | TEXT | |
| user_id | TEXT | |
| project_id | TEXT | Nullable |
| tool_name | TEXT | |
| document_id | TEXT | Nullable |
| escalation_round | INT | |
| turn_number | INT | |
| result_size_chars | INT | |
| success | INT | Boolean |
| metadata | TEXT | JSON |
| timestamp | INT | |

### analytics_context_snapshots
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| conversation_id | TEXT | |
| turn_number | INT | |
| escalation_round | INT | |
| estimated_tokens | INT | |
| warning_level | TEXT | "ok" / "caution" / "critical" |
| trigger | TEXT | Nullable |
| metadata | TEXT | JSON |
| timestamp | INT | |

---

## 5. Authentication System (Clerk + API Keys + MCP)

**Files:** `server/auth.ts`, `server/authRoutes.ts`, `server/authStorage.ts`

ScholarMark uses a triple-auth system:

### Clerk (primary)
- Installed globally via `configureClerk(app)` in `server/auth.ts`
- Uses `@clerk/express` middleware (`clerkMiddleware`, `getAuth`, `clerkClient`)
- On each request, `resolveUser()` calls `clerkClient.users.getUser()` to get email and tier from `publicMetadata`
- Ensures a local DB row exists via `getOrCreateUser(clerkUserId, email, tier)` for usage tracking
- Client routes: `/sign-in` and `/sign-up` use Clerk's hosted UI components

### API Keys (`sk_sm_` prefix)
- For programmatic access (extensions, scripts)
- `resolveApiKeyUser()` checks `Authorization: Bearer sk_sm_...` header
- SHA-256 hash lookup in `api_keys` table
- Bypasses Clerk middleware (`shouldBypassClerk()` returns true for `sk_sm_` or `mcp_sm_` tokens)
- Updates `last_used_at` on each use

### MCP Tokens (`mcp_sm_` prefix)
- OAuth tokens issued by the OAuth provider for MCP server access
- Same resolution path as API keys, but checked in `mcp_tokens` table
- Supports expiration (`expires_at` column)
- Issued via OAuth authorization code flow (see [Section 19](#19-analytics--oauth-provider))

### Tier System
| Tier | Level | Token Limit | Storage Limit |
|------|-------|------------|---------------|
| free | 0 | 50,000 | 50 MB |
| pro | 1 | 500,000 | 500 MB |
| max | 2 | 2,000,000 | 5 GB |

### Middleware
- **`requireAuth`**: Tries API key/MCP token first, then Clerk session. Returns 401 if neither succeeds.
- **`optionalAuth`**: Attaches user if present, doesn't reject.
- **`requireTier(minTier)`**: Checks `TIER_LEVELS[userTier] >= TIER_LEVELS[minTier]`, returns 403 if insufficient.
- **`checkTokenBudget`**: Placeholder hook; actual enforcement in AI call handlers.

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
- **Update source role:** `PUT /api/project-documents/:id` to set sourceRole (evidence/style_reference/background)

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
| Model | Uses conversation's `writingModel` setting (precision=Opus, extended=Sonnet) |
| Max tokens | 8192 |
| System prompt | Generic ScholarMark AI assistant (or source-aware if web clips selected) |
| Streaming | SSE with `{type: "text"/"done"/"error"}` events |
| Auto-title | Generated from first user message |

The standalone chat page (`/chat`) uses the base system prompt. The writing page (`/writing`) in "No Project" mode can attach web clips as sources.

---

## 10. Writing System (Chat-Based)

**Files:** `server/chatRoutes.ts`, `client/src/components/WritingChat.tsx`, `client/src/hooks/useWritingChat.ts`

**Route:** `/writing` (standalone) or Project Workspace -> Write tab

This is the primary writing workflow -- an iterative chat where the AI has access to project sources and can write paper sections on request.

### Two Writing Modes

The `writingModel` field on each conversation selects the mode: `"precision"` (default) or `"extended"`.

#### Precision Mode (Opus 4.6)

A **two-phase turn** architecture optimized for token efficiency:

**Phase 1 -- Evidence Gathering (Haiku):**
- `gatherEvidence()` in `server/gatherer.ts`
- Model: `claude-haiku-4-5-20251001`
- Haiku receives the user message, thesis, accumulated evidence clipboard, and source stubs
- Calls source tools (search chunks, get summaries) to gather relevant evidence
- Max 3 tool-use iterations (stops when `stop_reason !== "tool_use"`)
- Skips `style_reference` sources (only gathers from `evidence` and `background`)
- Returns an `EvidenceBrief` with relevant sources, findings, style notes, and suggested approach

**Phase 2 -- Writing (Opus):**
- Model: `claude-opus-4-6`
- Receives compacted conversation history + evidence clipboard + evidence brief
- **No tools** -- Opus writes purely from the gathered evidence
- System prompt adds "PRECISION MODE" directive telling Opus to use evidence from the brief
- System prompt includes the full evidence brief formatted by `formatEvidenceBrief()`

**Post-turn: Evidence Extraction (Haiku):**
- `extractUsedEvidence()` in `server/evidenceClipboard.ts`
- Haiku analyzes the assistant's response to identify which evidence was actually used
- Updates the persistent evidence clipboard with new items (Jaccard dedup, 0.88 threshold)
- Tracks writing progress (sections drafted/revised/final)

#### Extended Mode (Sonnet 4.5)

A **single-phase turn** with XML tag context escalation:

- Model: `claude-sonnet-4-5-20250929`
- Sonnet writes with full source context and can request additional context mid-stream
- `<chunk_request>` and `<context_request>` XML tags parsed from the streamed response
- `MAX_CONTEXT_ESCALATIONS = 2` rounds per turn
- Research agent triggered on `<research_request>` tags (see [Section 12](#12-research-agent))
- Context escalation handled by `loadSurroundingChunks()` and `loadProjectSourcesTiered()`
- SSE events: `context_loading`, `context_loaded`, `context_warning`

### Models by Mode

```typescript
const MODELS = {
  precision: {
    chat: "claude-opus-4-6",
    compile: "claude-opus-4-6",
    verify: "claude-opus-4-6",
  },
  extended: {
    chat: "claude-sonnet-4-5-20250929",
    compile: "claude-sonnet-4-5-20250929",
    verify: "claude-sonnet-4-5-20250929",
  },
  research: "claude-sonnet-4-5-20250929",
};
```

### 4-Phase Conversation Flow (UI)

The system prompt instructs the AI to follow a collaborative process:

1. **Phase 1 -- Discovery:** Ask the student about thesis/argument, angle, scope, audience/tone (2-3 focused questions)
2. **Phase 2 -- Source Review:** Review available sources and explain which are most relevant and why
3. **Phase 3 -- Outline:** Propose a structured outline showing argument organization and source placement
4. **Phase 4 -- Drafting:** After outline approval, write content wrapped in `<document>` tags

Important exceptions: skip phases when student says "just write it", when revising existing text, when continuing an established thread, or for short editing requests.

### Context Escalation System (Extended Mode)

XML tags parsed mid-stream from the AI's response:

```xml
<chunk_request annotation_id="ANN_ID" document_id="DOC_ID">
Brief reason for requesting surrounding context
</chunk_request>

<context_request document_id="DOC_ID">
Reason for requesting broader context
</context_request>
```

- Regex: `/<(chunk_request|context_request)\b([^>]*)>([\s\S]*?)<\/\1>/gi`
- Parsed by `extractToolRequestsFromText()` after each stream completes
- Executed via `loadSurroundingChunks()` (annotation context) and `loadProjectSourcesTiered()` (full reload)
- SSE events sent to client: `context_loading`, `context_loaded`, `context_warning`
- Max 2 escalation rounds per turn (`MAX_CONTEXT_ESCALATIONS = 2`)
- Tag stream parser (`createDocumentStreamParser()`) separates chat text, document text, and tool tags in real-time

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

### Compile Flow

User clicks "Compile Paper" -> server reads full conversation -> assembles into polished paper.

| Aspect | Detail |
|--------|--------|
| Model | Mode-dependent (precision: Opus, extended: Sonnet) |
| Max tokens | 8192 (constant `COMPILE_MAX_TOKENS`) |
| Endpoint | `POST /api/chat/conversations/:id/compile` |

### Verify Flow

User clicks "Verify" -> server sends compiled paper + full source materials for review.

| Aspect | Detail |
|--------|--------|
| Model | Mode-dependent (precision: Opus, extended: Sonnet) |
| Max tokens | 8192 (constant `VERIFY_MAX_TOKENS`) |
| Endpoint | `POST /api/chat/conversations/:id/verify` |

### Settings (stored per conversation)

| Setting | Options | Effect |
|---------|---------|--------|
| Writing model | precision, extended | Selects Opus two-phase or Sonnet escalation mode |
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

---

## 11. Context Optimization System

Four modules work together to reduce token costs (~91% reduction) while maintaining writing quality.

### Source Roles (`server/sourceRoles.ts`)

Each project document has a `sourceRole` that controls how it is injected into context:

| Role | Constant | Context Treatment |
|------|----------|-------------------|
| `evidence` | Default | Full citation pipeline: quote directly, cite precisely. Shows annotation count and chunk count. |
| `style_reference` | Opt-in | Voice/style guide only. Never cited or quoted. Triggers `analyzeWritingStyle()` (Haiku one-shot). |
| `background` | Opt-in | Summary-level context. Light citation only, no direct quotes needed. |

**Key exports:**
- `SOURCE_ROLES = ["evidence", "style_reference", "background"]`
- `formatSourceStubByRole(source)` -- different formatting per role (evidence shows stats, style shows profile, background shows summary)
- `analyzeWritingStyle(anthropic, text, title)` -- Haiku one-shot that returns `StyleAnalysis` (avgSentenceLength, vocabularyLevel, paragraphStructure, toneMarkers, commonTransitions)
- `buildStyleSection(styleSources)` -- generates a "WRITING STYLE GUIDE" section for the system prompt
- `isSourceRole(value)` -- type guard

**UI:** `SourceRoleSelector.tsx` component for changing source roles.

### Evidence Clipboard (`server/evidenceClipboard.ts`)

Persistent per-conversation evidence accumulation stored in `conversations.evidenceClipboard` (JSON).

**`EvidenceClipboard` interface:**
```typescript
{
  version: number;           // Currently 1
  collectedAt: number;       // Timestamp
  thesis: string;
  evidence: Array<{
    sourceId: string;
    sourceTitle: string;
    items: Array<{
      type: "direct_quote" | "paraphrase" | "data_point" | "finding";
      text: string;
      citedInTurn: number;
      location?: string;
    }>;
  }>;
  styleProfile?: { sentenceLength, vocabulary, tone, transitions[] };
  writingProgress: Array<{ section, status: "drafted"|"revised"|"final", turnNumber }>;
  tokenEstimate: number;
}
```

**Key functions:**
- `createEmptyClipboard(thesis?)` -- initial clipboard
- `serializeClipboard(clipboard)` / `deserializeClipboard(json)` -- JSON persistence
- `mergeEvidence(clipboard, newEvidence, turnNumber)` -- adds new items with Jaccard deduplication (0.88 threshold). Substring containment yields 0.95 similarity.
- `updateProgress(clipboard, sections, turnNumber)` -- tracks writing section status
- `formatClipboardForPrompt(clipboard)` -- renders clipboard as markdown for system prompt
- `extractUsedEvidence(anthropic, response, evidence, clipboard, turn)` -- Haiku post-turn extraction. Analyzes what the assistant actually cited and merges into clipboard.

### Haiku Gatherer (`server/gatherer.ts`)

Phase 1 of precision mode's two-phase turn.

**`gatherEvidence(anthropic, userMessage, sourceStubs, clipboard, thesis, tools, toolExecutor)`:**
- Model: `claude-haiku-4-5-20251001`, max 4096 tokens
- Filters out `style_reference` sources (only gathers from `evidence` and `background`)
- System prompt includes: user message, thesis, current clipboard contents, available source stubs
- Iterative tool use: max 3 iterations (loop while `stop_reason === "tool_use"`)
- For `evidence` sources: finds specific quotes and data points via chunk tools
- For `background` sources: gets summary-level context only via `get_source_summary`
- Returns `EvidenceBrief`: `{ relevantSources[], styleNotes?, suggestedApproach?, tokenEstimate }`
- Formatted for Opus via `formatEvidenceBrief(brief)`

### Context Compaction (`server/contextCompaction.ts`)

Automatic conversation summarization to control token growth.

**`compactConversation(anthropic, messages, existingSummary, compactedAtTurn, threshold=6)`:**
- Model: `claude-haiku-4-5-20251001`, max 2048 tokens
- Triggers when user turn count exceeds `compactedAtTurn + threshold` (default threshold: 6)
- Summarizes old turns into 300-500 token summaries
- Preserves: thesis, argument structure, key decisions, section structure, student instructions
- Discards: raw source material, answered questions, superseded drafts, tool call details
- Incremental: appends to existing summary with `---` separator
- Stored in `conversations.compactionSummary` + `conversations.compactedAtTurn`

**`buildCompactedHistory(messages, clipboardFormatted, compactionSummary, compactedAtTurn, recentTurnCount=6)`:**
- Assembles the optimized message array for the AI:
  1. Evidence clipboard (if non-empty) as user/assistant pair
  2. Compaction summary (if exists) as user/assistant pair
  3. Recent messages (last `recentTurnCount * 2` messages)
- Strips tool results from old messages (`stripToolResults()`)

**`getToolResponseLimit(sourceCount)`:**
- Dynamic budget caps by source count:
  - ≤5 sources: 5000 chars
  - ≤10 sources: 3000 chars
  - ≤20 sources: 1500 chars
  - >20 sources: 800 chars
- `truncateToolResult(result, limit)` -- truncates with "[...truncated]" message

---

## 12. Research Agent

**File:** `server/researchAgent.ts`

Deep-dive source analysis triggered by `<research_request>` tags in extended mode.

| Aspect | Detail |
|--------|--------|
| Model | `claude-sonnet-4-5-20250929` (constant `RESEARCH_MODEL`) |
| Max tokens | 8192 |
| Max chars per call | 220,000 (splits large documents into overlapping chunks with 1,000 char overlap) |
| Max returned findings | 8 |

**`runResearchAgent(documentId, reason, projectContext)`:**
1. Loads document full text from storage
2. Splits into research chunks if > 220K chars
3. For each chunk, Sonnet analyzes the text against the research request and project context
4. Extracts findings with exact quotes and absolute character positions
5. Deduplicates findings across chunks
6. **Quote verification** (`verifyQuote()`): Each quote is verified against the source text:
   - Direct match in normalized text -> verified
   - Match at reported position -> verified
   - 5-word prefix match -> corrected with note
   - No match -> flagged as potentially fabricated
7. Returns sorted findings (verified first, then by position)

**`extractRecentWritingTopic(messages)`** -- Extracts the current writing context from recent messages for research targeting.

---

## 13. Writing System (One-Shot Pipeline)

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

### Deep Write Mode

When `deepWrite: true`:
- Uses `claude-sonnet-4-5-20241022` instead of Haiku
- Enables extended thinking (4096 budget tokens)
- Increases max output tokens to 8192+

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

## 14. Source Injection & Formatting

### How sources get into the AI's context

```
User selects project + sources (or web clips in standalone mode)
  |
loadConversationContext(conv, userId)
  |
  +-- If conv.projectId exists:
  |     loadProjectSourcesTiered(projectId, selectedSourceIds)     [chatRoutes.ts]
  |       | Fetches project_documents + full document text
  |       | Filters to selectedSourceIds
  |       | Distributes fulltext budget (150K total / N sources)
  |       | Checks sourceRole, triggers style analysis for style_reference
  |     projectStorage.getProject(projectId)
  |       | Fetches project thesis, scope, contextSummary
  |
  +-- If no projectId:
        loadStandaloneWebClipSources(userId, selectedSourceIds)    [chatRoutes.ts]
          | Fetches web clips by ID from web_clips table
          | Formats as WritingSource with kind: "web_clip"
  |
formatSourceForPromptTiered(source) or formatSourceForPrompt(source)
  | Formats each source based on sourceRole
  |
buildWritingSystemPrompt(sources, project, citationStyle, tone, humanize, noEnDashes)
  | Embeds project context + formatted sources + style section into system prompt
  |
anthropic.messages.stream({ system: prompt, ... })
```

### Source roles affect formatting

- **evidence** sources: Full formatted block with annotations, excerpts, and content snippet
- **style_reference** sources: Style profile only (via `formatSourceStubByRole()`), never in content
- **background** sources: Summary stub, light context only

### Size limits
- Excerpt: max 2,000 characters
- Per-source fulltext: max 30,000 characters
- Total fulltext budget: 150,000 characters across all sources
- Per-source limit dynamically computed: `min(30000, max(2000, 150000 / N))`

---

## 15. Citation System

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

## 16. Document Export (PDF / DOCX)

**Files:** `client/src/lib/documentExport.ts`, `client/src/lib/markdownToDocx.ts`

All export happens **client-side** -- no server round-trip needed. Both exporters parse the markdown AST for rich formatting.

### PDF (pdf-lib)

- Font: Times Roman (body 11pt), Times Roman Bold (heading 15pt)
- Page: Letter (612x792), margins 48px (~0.67")
- Line height: 15px
- Auto word-wrap based on font metrics
- Auto page breaks

### DOCX (docx library via markdownToDocx)

- Parses markdown AST via unified/remark-parse/remark-gfm
- Rich formatting: bold, italic, superscript footnote references, headings, lists, hyperlinks
- Footnotes rendered as Word footnotes
- Page: 8.5"x11" with 1" margins

---

## 17. Humanizer System

**Files:** `server/humanizer.ts`, `server/humanizerRoutes.ts`, `client/src/hooks/useHumanizer.ts`, `prompts/humanizer.txt`

Rewrites AI-generated text to sound more human/natural.

### Provider strategy
1. If `GEMINI_API_KEY` is set, try Google Gemini first (cheaper for this task)
2. If Gemini fails or key is absent, fall back to Anthropic (requires `ANTHROPIC_API_KEY`)
3. If neither key is configured, returns 503

### API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/humanize` | Yes | Humanize text |

---

## 18. Web Clips & Chrome Extension

**Files:** `server/webClipRoutes.ts`, `server/extensionRoutes.ts`

### Web Clips
- Store webpage highlights with URL, title, author, date
- Support categories and tags
- Optional project/document association
- Can be promoted to full project annotations

### Chrome Extension
- `POST /api/extension/save` -- saves highlight from browser
- Auto-generates citation data from webpage metadata
- Auth via Clerk session or API key

---

## 19. Analytics & OAuth Provider

### Analytics

**Files:** `server/analyticsLogger.ts`, `server/analyticsRoutes.ts`, `client/src/pages/AdminAnalytics.tsx`

Two analytics tables track context optimization performance:

- **`analytics_tool_calls`**: Every tool call during chat (tool name, document ID, escalation round, turn number, result size, success/failure)
- **`analytics_context_snapshots`**: Token estimates at each turn (estimated tokens, warning level, trigger event)

**Logging hooks in chatRoutes:**
- `logToolCall(event)` -- logs each tool invocation with metadata
- `logContextSnapshot(event)` -- logs context window size estimates
- `initAnalytics()` -- verifies tables exist at startup

**Admin dashboard** (`/admin/analytics`):
- Requires `requireAuth` + `requireAdmin` (checks `ADMIN_USER_IDS` env var or `max` tier)
- Endpoints:
  - `GET /api/admin/analytics/export` -- aggregated stats (tool frequency, token usage by turn, warning breakdown, top sources)
  - `GET /api/admin/analytics/conversations` -- conversation list with tool call counts, peak tokens, critical warnings
  - `GET /api/admin/analytics/conversation/:id` -- detailed timeline of tool calls and context snapshots for a single conversation

### OAuth Provider

**Files:** `server/oauthRoutes.ts`, `server/oauthStorage.ts`

OAuth 2.0 authorization server for MCP token issuance:

- **PKCE support** (S256 code challenge method)
- **Scopes:** `read`, `write`
- **Token types:** Access tokens (`mcp_sm_` prefix) with configurable TTL, refresh tokens
- **Client registration:** Dynamic via `createOAuthClient()`
- **Authorization code flow:** Clerk session -> authorization code -> token exchange
- **Token endpoint auth methods:** `none`, `client_secret_post`

**Environment variables:**
- `MCP_ACCESS_TOKEN_TTL_SECONDS` (default 3600)
- `MCP_REFRESH_TOKEN_TTL_SECONDS` (default 90 days)
- `MCP_AUTH_CODE_TTL_SECONDS` (default 600)

---

## 20. MCP Server

**Directory:** `mcp-server/`

A standalone Model Context Protocol server that exposes ScholarMark capabilities to Claude Desktop and other MCP clients.

| Aspect | Detail |
|--------|--------|
| Package | `scholarmark-mcp-server` |
| Port | 5002 (via `MCP_SERVER_PORT` env var) |
| Transport | Streamable HTTP + SSE fallback |
| Auth | Bearer token passthrough (MCP OAuth tokens, `mcp_sm_` prefix) |
| Backend | Proxies to main app at `SCHOLARMARK_BACKEND_URL` (default `http://127.0.0.1:5001`) |
| SDK | `@modelcontextprotocol/sdk` 1.27 |

**Source files:**
- `src/index.ts` -- Express server, transport setup, session management
- `src/mcp-tools.ts` -- Tool registration (proxies to main backend API)
- `src/backend-client.ts` -- `ScholarMarkBackendClient` HTTP client with SSE support
- `src/sse-buffer.ts` -- SSE stream consumption utility
- `src/discovery.ts` -- OAuth protected resource metadata (`/.well-known/oauth-protected-resource`)

**Endpoints:**
- `GET /healthz` -- health check
- `GET /.well-known/oauth-protected-resource` -- OAuth discovery metadata
- MCP transport endpoints (streamable HTTP + SSE)

---

## 21. Environment Variables

### Required

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude API key |
| `CLERK_SECRET_KEY` | Clerk backend key |
| `CLERK_PUBLISHABLE_KEY` | Clerk frontend key (exposed via `VITE_CLERK_PUBLISHABLE_KEY`) |

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
| `ADMIN_USER_IDS` | "" | Comma-separated Clerk user IDs for admin access |
| `MCP_SERVER_PORT` | 5002 | MCP server port |
| `SCHOLARMARK_BACKEND_URL` | `http://127.0.0.1:5001` | Backend URL for MCP server |
| `MCP_ACCESS_TOKEN_TTL_SECONDS` | 3600 | MCP OAuth access token TTL |
| `MCP_REFRESH_TOKEN_TTL_SECONDS` | 7776000 | MCP OAuth refresh token TTL (90 days) |
| `MCP_AUTH_CODE_TTL_SECONDS` | 600 | MCP OAuth authorization code TTL |
| `MCP_RESOURCE_URL` | auto-detected | MCP protected resource base URL |
| `MCP_AUTHORIZATION_SERVER` | `https://app.scholarmark.ai` | OAuth authorization server URL |

---

## 22. All API Endpoints

### Auth (`server/authRoutes.ts`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Sign in (legacy) |
| POST | `/api/auth/logout` | Sign out (client-side) |
| GET | `/api/auth/me` | Current user profile |
| PUT | `/api/auth/me` | Update profile |
| GET | `/api/auth/usage` | Token/storage usage |

### OAuth (`server/oauthRoutes.ts`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/.well-known/oauth-authorization-server` | OAuth server metadata |
| POST | `/oauth/register` | Dynamic client registration |
| GET | `/oauth/authorize` | Authorization endpoint (Clerk session required) |
| POST | `/oauth/authorize` | Authorization consent submission |
| POST | `/oauth/token` | Token exchange (code -> access + refresh) |
| POST | `/oauth/revoke` | Token revocation |

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
| PUT | `/api/project-documents/:id` | Update source role/metadata |
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

### Analytics (`server/analyticsRoutes.ts`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/analytics/export` | Aggregated analytics (tool frequency, token usage, warnings) |
| GET | `/api/admin/analytics/conversations` | Conversation list with analytics metrics |
| GET | `/api/admin/analytics/conversation/:id` | Single conversation timeline |

### MCP Server (port 5002)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/healthz` | Health check |
| GET | `/.well-known/oauth-protected-resource` | OAuth discovery metadata |
| POST | `/mcp` | Streamable HTTP MCP transport |
| GET | `/sse` | SSE MCP transport (legacy) |
| POST | `/message` | SSE message endpoint (legacy) |

---

## Model Usage Summary

| Feature | Model | Notes |
|---------|-------|-------|
| Precision chat | `claude-opus-4-6` | Two-phase: receives evidence brief, no tools |
| Extended chat | `claude-sonnet-4-5-20250929` | Single-phase with XML escalation |
| Precision compile | `claude-opus-4-6` | Full conversation -> paper |
| Extended compile | `claude-sonnet-4-5-20250929` | Full conversation -> paper |
| Precision verify | `claude-opus-4-6` | Source verification |
| Extended verify | `claude-sonnet-4-5-20250929` | Source verification |
| Evidence gathering | `claude-haiku-4-5-20251001` | Phase 1 of precision mode, max 3 tool iterations |
| Context compaction | `claude-haiku-4-5-20251001` | Summarizes old turns (300-500 tokens) |
| Evidence extraction | `claude-haiku-4-5-20251001` | Post-turn clipboard update |
| Style analysis | `claude-haiku-4-5-20251001` | One-shot per style_reference source |
| Research agent | `claude-sonnet-4-5-20250929` | Deep dive with quote verification |
| Auto-title | `claude-haiku-4-5-20251001` | Short title from first message |
| Planning (pipeline) | `claude-haiku-4-5-20251001` | One-shot pipeline outline |
| Planning (deep) | `claude-sonnet-4-5-20241022` | Extended thinking pipeline |
| Section writing (pipeline) | `claude-haiku-4-5-20251001` | Per section, one-shot pipeline |
| Section writing (deep) | `claude-sonnet-4-5-20241022` | Extended thinking pipeline |
| Stitching (pipeline) | `claude-haiku-4-5-20251001` | Final assembly, one-shot pipeline |
| Humanizer (primary) | `gemini-2.5-flash-lite` | Via Google Gemini REST API |
| Humanizer (fallback) | `claude-opus-4-6` | Via Anthropic SDK when Gemini unavailable |

---

## Key Architectural Patterns

1. **SSE Streaming** -- All AI responses streamed via Server-Sent Events with JSON payloads
2. **Two-phase precision turns** -- Haiku gathers evidence via source tools, Opus writes from the brief (no tools)
3. **XML tag escalation** -- `<chunk_request>`, `<context_request>` parsed mid-stream in extended mode
4. **Evidence clipboard** -- Persistent per-conversation evidence accumulation with Jaccard deduplication
5. **Context compaction** -- Automatic Haiku turn summarization after 6 turns, incremental
6. **Source role routing** -- evidence/style_reference/background affect context injection and tool behavior
7. **Triple auth** -- Clerk sessions (primary) + API keys (sk_sm_) + MCP OAuth tokens (mcp_sm_)
8. **Analytics hooks** -- Tool calls and context snapshots logged to SQLite for performance monitoring
9. **Two annotation layers** -- Document-global + project-scoped
10. **Per-conversation settings** -- Writing model, citation style, tone, humanize, source selection persist per chat
11. **Client-side export** -- PDF/DOCX generated in browser (pdf-lib for PDF, docx library with markdown AST for DOCX), no server needed
12. **React Query invalidation** -- Mutations automatically refresh related queries (`staleTime: Infinity` -- relies on explicit invalidation)
13. **V2 AI pipeline** -- Generator -> Hard Verifier -> Soft Verifier for annotation quality
14. **Multi-provider AI** -- Anthropic (chat/writing/verify), OpenAI (annotation pipeline/OCR), Gemini (humanizer) with fallback chains
15. **Chat component decomposition** -- WritingChat delegates to `chat/ChatInput`, `chat/ChatMessages`, `chat/ChatSidebar`, `chat/DocumentPanel`, `chat/DocumentStatusCard`
16. **MCP proxy architecture** -- Separate MCP server on port 5002 proxies to main backend via `ScholarMarkBackendClient`
