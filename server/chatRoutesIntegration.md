# chatRoutes.ts Integration Patch

This patch document targets the current `dev` version of `server/chatRoutes.ts`. Do not apply it until the parallel merge into `chatRoutes.ts` is complete.

## 1. Imports

At the top of [`server/chatRoutes.ts`](/Users/Jacob/Documents/Playground/anotations-jan-26/server/chatRoutes.ts), add these new module imports alongside the existing route imports:

```ts
import { gatherEvidence, formatEvidenceBrief, type SourceStub, type EvidenceBrief } from "./gatherer";
import {
  type EvidenceClipboard,
  createEmptyClipboard,
  deserializeClipboard,
  serializeClipboard,
  formatClipboardForPrompt,
  extractUsedEvidence,
} from "./evidenceClipboard";
import { compactConversation, buildCompactedHistory } from "./contextCompaction";
import { formatSourceStubByRole, buildStyleSection, analyzeWritingStyle, type SourceRole } from "./sourceRoles";
```

Also extend the existing `chatStorage` import so the chat handler can load and save the new conversation state:

```ts
import {
  chatStorage,
  getConversationClipboard,
  updateConversationClipboard,
  getConversationCompaction,
  updateConversationCompaction,
} from "./chatStorage";
```

## 2. Source Loading Changes

Update `loadProjectSourcesTiered()` around `server/chatRoutes.ts:394` so each tiered source carries the new role metadata:

1. Include `sourceRole`, `styleAnalysis`, and `chunkCount` when pushing each `TieredSource`.
2. Read `projectDoc.sourceRole` and default it to `"evidence"` when empty.
3. For style-reference documents, lazily generate `styleAnalysis` if it is missing:
   - Call `analyzeWritingStyle(anthropic, fullDoc.fullText, citationData?.title || projectDoc.document.filename)`.
   - Persist the JSON string back to `project_documents.style_analysis`.
   - Reuse the stored value on later turns.

The object you push into `sources` should end up with these extra fields:

```ts
sourceRole: (projectDoc.sourceRole as SourceRole) || "evidence",
styleAnalysis: projectDoc.styleAnalysis || null,
chunkCount: fullDoc.chunkCount,
```

## 3. Source Stub Formatting

Update `buildSourceBlock()` around `server/chatRoutes.ts:171`:

1. Leave the existing `formatSourceForPromptTiered()` / `formatSourceForPrompt()` split in place.
2. When the source is tiered, let the new `formatSourceForPromptTiered()` output carry the role-aware stub text.
3. If you keep any ad hoc source-summary formatting inside `chatRoutes.ts`, replace that formatting with `formatSourceStubByRole(...)` so source roles are described consistently everywhere.

## 4. Writing Style Guide Block

Inside `buildWritingSystemPrompt()` around `server/chatRoutes.ts:534`:

1. Split `sources` into normal sources and style-reference sources.
2. Build a style section from the style-reference subset:

```ts
const styleSection = buildStyleSection(
  sources
    .filter((source): source is TieredSource => isTieredSource(source) && source.sourceRole === "style_reference")
    .map((source) => ({
      title: source.title,
      styleAnalysis: source.styleAnalysis ? JSON.parse(source.styleAnalysis) : null,
    }))
);
```

3. Inject `styleSection` into the system prompt immediately after the `SOURCE MATERIALS` block.
4. Add one explicit instruction near the writing rules that style-reference documents guide voice only and must never be cited or quoted.

## 5. Precision-Mode Two-Phase Flow

Replace the single-call precision flow inside the main chat endpoint at `server/chatRoutes.ts:844`. Keep the current extended-mode path intact.

### 5a. Before the Anthropic call

Right after:

```ts
let history = await chatStorage.getMessagesForConversation(conv.id);
let anthropicMessages = toAnthropicMessages(history);
const mode = getWritingMode(conv);
```

add:

1. Load persisted state:

```ts
const rawClipboard = await getConversationClipboard(conv.id);
const clipboard = rawClipboard ? deserializeClipboard(rawClipboard) : createEmptyClipboard(project?.thesis || "");
const { compactionSummary, compactedAtTurn } = await getConversationCompaction(conv.id);
```

2. Run compaction only when `mode === "precision"`:

```ts
const compactionResult =
  mode === "precision"
    ? await compactConversation(anthropic, history, compactionSummary, compactedAtTurn)
    : null;

if (compactionResult) {
  await updateConversationCompaction(conv.id, compactionResult);
}
```

3. Build compacted history for the writer:

```ts
const effectiveCompactionSummary = compactionResult?.summary ?? compactionSummary;
const effectiveCompactedAtTurn = compactionResult?.compactedAtTurn ?? compactedAtTurn;
const compactedHistory =
  mode === "precision"
    ? buildCompactedHistory(
        history,
        formatClipboardForPrompt(clipboard),
        effectiveCompactionSummary,
        effectiveCompactedAtTurn,
      )
    : anthropicMessages;
```

### 5b. Phase 1: Haiku gatherer

Before `runTurn()` is invoked, build role-aware source stubs from the selected project sources:

```ts
const sourceStubs: SourceStub[] = sources
  .filter((source): source is TieredSource => isTieredSource(source))
  .map((source) => ({
    docId: source.documentId,
    title: source.title,
    role: source.sourceRole || "evidence",
    summary: source.summary,
    annotationCount: source.annotations.length,
    chunkCount: source.chunkCount,
  }));
```

Only in precision mode, call:

```ts
const evidenceBrief: EvidenceBrief = await gatherEvidence(
  anthropic,
  content,
  sourceStubs,
  clipboard,
  project?.thesis || "",
  tools,
  toolExecutor,
);
const evidenceBriefText = formatEvidenceBrief(evidenceBrief);
```

Use Haiku only for this phase. Keep the existing Sonnet/extended chat path single-pass.

### 5c. Phase 2: Opus writer

Change `runTurn()` so it accepts the already-built message history instead of always using the raw `anthropicMessages` array.

For precision mode:

1. Keep the current `systemPrompt`.
2. Insert the current-turn evidence brief into the message history before the latest user turn:

```ts
const writerMessages = [
  ...compactedHistory,
  { role: "user", content: `[EVIDENCE GATHERED THIS TURN]\n${evidenceBriefText}` },
  { role: "assistant", content: "I have the evidence gathered for this turn and will use it selectively." },
  anthropicMessages[anthropicMessages.length - 1],
];
```

3. Stream Opus with `writerMessages`.

For extended mode, keep the current `runTurn(anthropicMessages)` behavior.

## 6. Tool Execution Notes

The gatherer expects the same underlying source tools you already use, but routed through a small executor wrapper:

```ts
const toolExecutor = async (name: string, input: unknown): Promise<string> => {
  switch (name) {
    case "get_source_summary":
      // call existing source-summary loader
    case "get_source_chunks":
      // call existing chunk/context loader
    default:
      return `[TOOL ERROR] Unknown tool: ${name}`;
  }
};
```

Budget the returned tool text with `truncateToolResult()` / `getToolResponseLimit()` from `contextCompaction.ts` before sending tool results back to Haiku.

## 7. After Streaming Completes

In the success path after the assistant stream finishes and before `done` is emitted:

1. Only in precision mode, extract actually used evidence:

```ts
const updatedClipboard = await extractUsedEvidence(
  anthropic,
  turn.fullText,
  evidenceBriefText,
  clipboard,
  history.filter((message) => message.role === "user").length,
);
await updateConversationClipboard(conv.id, serializeClipboard(updatedClipboard));
```

2. Keep the existing `chatStorage.createMessage(...)` call for the assistant response.
3. Emit the same final `done` SSE event as today.

## 8. Control-Flow Guardrails

Apply these rules while merging:

1. Only use the Haiku gatherer plus compaction flow when `mode === "precision"`.
2. Preserve the current extended-mode single-call behavior.
3. Preserve the current chunk-request and context-request escalation loop for extended mode until the parallel branch settles.
4. In precision mode, do not append raw tool output back into long-term chat history; only persist the final assistant response plus the compacted clipboard/summary state.

## 9. Expected Result

After the patch:

1. Style-reference sources influence tone but are not cited.
2. Old turns collapse into a summary instead of replaying raw tool output forever.
3. Accumulated evidence is stored in `conversations.evidence_clipboard`.
4. Precision mode becomes a Haiku gatherer plus Opus writer pipeline.
5. Extended mode remains on the current single-call Sonnet behavior.
