# Writing System Explainer — ScholarMark (March 2026)

## Overview

ScholarMark's chat-based writing system supports two modes, selected per-conversation via the `writingModel` setting: **Precision** (default) and **Extended**.

---

## Precision Mode — Two-Phase Turns

Each conversation turn runs in two phases to minimize token cost:

### Phase 1: Evidence Gathering (Haiku)

A cheap Haiku call reads the user's message, checks the thesis, scans the evidence clipboard, and calls source tools (chunk search, summaries) to gather only the evidence needed for this turn.

- **Model:** `claude-haiku-4-5-20251001`
- **File:** `server/gatherer.ts` — `gatherEvidence()`
- Skips `style_reference` sources (only gathers from `evidence` and `background`)
- Runs up to 3 tool-use iterations (loop while `stop_reason === "tool_use"`)
- For evidence sources: finds specific quotes and data points
- For background sources: gets summary-level context only
- **Output:** An `EvidenceBrief` containing relevant sources, findings, style notes, and suggested approach

### Phase 2: Writing (Opus)

Opus receives a compacted conversation history plus the evidence brief. It writes with **no tools** — purely from the gathered evidence. This keeps Opus focused on writing rather than retrieval.

- **Model:** `claude-opus-4-6`
- **Input:** Compacted history (clipboard + old turn summary + last 6 turns) + evidence brief
- System prompt includes "PRECISION MODE" directive
- The evidence brief is formatted by `formatEvidenceBrief()` and injected into the system prompt

### Post-Turn: Evidence Extraction (Haiku)

After Opus responds, Haiku analyzes what evidence was actually cited and merges it into the persistent evidence clipboard.

- **File:** `server/evidenceClipboard.ts` — `extractUsedEvidence()`
- Identifies direct quotes, paraphrases, data points, and findings that were used
- Merges into clipboard with Jaccard deduplication (0.88 similarity threshold)
- Tracks writing progress (which sections are drafted/revised/final)

---

## Extended Mode — Single-Phase with Escalation

Sonnet writes in a single phase with full source context. If it needs more information mid-stream, it outputs XML tags that are parsed from the SSE stream.

- **Model:** `claude-sonnet-4-5-20250929`
- **Escalation tags:**
  - `<chunk_request annotation_id="..." document_id="...">reason</chunk_request>` — request surrounding context for a specific annotation
  - `<context_request document_id="...">reason</context_request>` — request broader document context
- Tags are parsed by `extractToolRequestsFromText()` using the regex `/<(chunk_request|context_request)\b([^>]*)>([\s\S]*?)<\/\1>/gi`
- The server fulfills them via `loadSurroundingChunks()` and `loadProjectSourcesTiered()`, then re-runs the model with additional context
- **Max 2 escalation rounds per turn** (`MAX_CONTEXT_ESCALATIONS = 2`)
- SSE events sent to client: `context_loading`, `context_loaded`, `context_warning`

### Research Agent (Extended Mode Only)

Deep research requests trigger the Sonnet-based research agent with quote verification.

- **File:** `server/researchAgent.ts` — `runResearchAgent()`
- Model: `claude-sonnet-4-5-20250929`
- Splits large documents into overlapping chunks (220K chars per call, 1K overlap)
- Each quote is verified against the source text (direct match, position match, prefix match, or flagged)
- Returns up to 8 findings, sorted verified-first

---

## Context Optimization Stack

Four modules keep token costs down (~91% reduction from the pre-optimization baseline):

### 1. Source Roles (`server/sourceRoles.ts`)

Documents tagged as `evidence`, `style_reference`, or `background` get different context treatment:

| Role | Context Treatment |
|------|-------------------|
| `evidence` | Full citation pipeline — quote directly, cite precisely. Annotation count and chunk count shown. |
| `style_reference` | Voice/style guide only. Never cited or quoted. Triggers Haiku one-shot style analysis. |
| `background` | Summary-level context. Light citation only, no direct quotes. |

### 2. Evidence Clipboard (`server/evidenceClipboard.ts`)

Persistent per-conversation accumulation of cited evidence, stored in `conversations.evidenceClipboard` as JSON.

- Tracks: direct quotes, paraphrases, data points, findings — each with source ID, turn number, and location
- Deduplication: Jaccard similarity at 0.88 threshold; substring containment at 0.95
- Also tracks writing progress (section status: drafted/revised/final)
- Formatted for the system prompt via `formatClipboardForPrompt()`

### 3. Context Compaction (`server/contextCompaction.ts`)

Automatic Haiku turn summarization after 6 turns.

- Haiku summarizes old turns into 300-500 token summaries
- Preserves thesis, argument structure, key decisions, section structure, student instructions
- Discards raw source material, answered questions, superseded drafts, tool call details
- Incremental: appends to existing summary with `---` separator
- `buildCompactedHistory()` assembles: clipboard + summary + recent turns (last 6)

### 4. Tool Response Limits (`server/contextCompaction.ts`)

Dynamic caps on tool response sizes based on source count:

| Source Count | Max Response Size |
|--------------|-------------------|
| 1-5 | 5,000 chars |
| 6-10 | 3,000 chars |
| 11-20 | 1,500 chars |
| 21+ | 800 chars |

---

## 4-Phase Conversation Flow

The system prompt instructs the AI to follow a collaborative process for new writing tasks:

1. **Discovery** — Ask 2-3 focused questions about thesis, angle, scope, audience
2. **Source Review** — Review available sources and explain relevance
3. **Outline** — Propose structured outline with source assignments
4. **Drafting** — Write content in `<document>` tags after outline approval

Exceptions: skip phases when student says "just write it", when revising, when continuing an established thread, or for short edits.

---

## Model Summary

| Role | Model | Mode |
|------|-------|------|
| Chat writer | `claude-opus-4-6` | Precision |
| Chat writer | `claude-sonnet-4-5-20250929` | Extended |
| Evidence gatherer | `claude-haiku-4-5-20251001` | Precision phase 1 |
| Evidence extractor | `claude-haiku-4-5-20251001` | Precision post-turn |
| Context compaction | `claude-haiku-4-5-20251001` | Both modes |
| Style analysis | `claude-haiku-4-5-20251001` | Both modes |
| Research agent | `claude-sonnet-4-5-20250929` | Extended only |
| Compile | Mode-dependent (Opus or Sonnet) | Both |
| Verify | Mode-dependent (Opus or Sonnet) | Both |

---

## Key Files

| File | Purpose |
|------|---------|
| `server/chatRoutes.ts` | Main writing chat handler, model constants, escalation loop |
| `server/gatherer.ts` | Haiku evidence gathering (precision phase 1) |
| `server/evidenceClipboard.ts` | Evidence clipboard persistence and deduplication |
| `server/contextCompaction.ts` | Turn summarization and compacted history assembly |
| `server/sourceRoles.ts` | Source role types, style analysis, role-based formatting |
| `server/researchAgent.ts` | Deep research with quote verification |
| `server/writingPipeline.ts` | Source formatting utilities, tiered source types |
