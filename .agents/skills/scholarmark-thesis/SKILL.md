---
name: scholarmark-thesis
# prettier-ignore
description: "Use when Yakub asks to find evidence, verify quotes, build thesis drafts, run multi-prompt analysis, or audit academic writing quality in ScholarMark."
version: 2.0.0
category: research
triggers:
  - "scholarmark"
  - "thesis section"
  - "find quotes"
  - "find evidence"
  - "annotations"
  - "citation"
  - "research prompt"
  - "academic writing"
---

<objective>
Produce high-rigor, source-grounded academic writing from ScholarMark data with strict quote fidelity and auditable QA.

Operational rule: evidence first, writing second.
</objective>

<runtime-config>
```bash
SM="${SM:-http://89.167.10.34:5001}"
PID="${PID:-cf547e4d-712b-42a1-a33d-6cb67e68e670}"
```

- Auth: none
- Responses: JSON
- Prefer project-level endpoints for thesis work
</runtime-config>

<contract-preflight>
Run before major research/writing jobs:

```bash
bash scripts/preflight.sh
```

Preflight validates:
- Read/search endpoints
- Project create/delete
- Upload endpoints
- Prompt template create/list/delete
- Multi-prompt analyze endpoint validation

If preflight fails, stop and report the failing check.
</contract-preflight>

<core-endpoints>
```bash
# Projects
GET  "$SM/api/projects"
POST "$SM/api/projects"                          # create project
GET  "$SM/api/projects/$PID"
PUT  "$SM/api/projects/$PID"

# Uploads
POST "$SM/api/upload"                             # single PDF/TXT/image/HEIC
POST "$SM/api/upload-group"                       # multi-image => one combined document

# Attach uploaded docs to project
POST "$SM/api/projects/$PID/documents"            # {documentId, folderId?}
POST "$SM/api/projects/$PID/documents/batch"      # {documentIds[], folderId?}
GET  "$SM/api/projects/$PID/documents"

# Search and analysis
POST "$SM/api/projects/$PID/search"               # lexical global search
POST "$SM/api/project-documents/$PDID/search"     # semantic per-document search
POST "$SM/api/project-documents/$PDID/analyze"    # single intent
POST "$SM/api/project-documents/$PDID/analyze-multi" # multi-prompt

# Prompt templates (Codex-generated research prompt sets)
POST "$SM/api/projects/$PID/prompt-templates"
GET  "$SM/api/projects/$PID/prompt-templates"
PUT  "$SM/api/prompt-templates/$TEMPLATE_ID"
DELETE "$SM/api/prompt-templates/$TEMPLATE_ID"

# Annotations / citations
GET  "$SM/api/project-documents/$PDID/annotations"
POST "$SM/api/project-documents/$PDID/annotations"
POST "$SM/api/project-annotations/$ANN_ID/footnote"
POST "$SM/api/citations/generate"
```
</core-endpoints>

<prompt-generation>
Generate Codex-ready research prompt sets and optionally save them to the project:

```bash
python3 scripts/generate_prompt_set.py \
  --topic "Korean War brainwashing acceleration" \
  --thesis "Korea accelerated pre-existing programs" \
  --section-goal "Section 4 institutional acceleration" \
  --template-name "Section 4 Prompt Set" \
  --save-template \
  --out-json /tmp/prompt_set.json
```
</prompt-generation>

<academic-controller>
Use the role-separated controller workflow:

1. Planner
2. Researcher
3. Writer
4. Verifier

Command:

```bash
python3 scripts/research_controller.py \
  --question "How did Korean War panic accelerate existing programs?" \
  --section-goal "Draft Section 4 argument paragraph set" \
  --out-dir /tmp/scholarmark_run
```

Artifacts produced:
- `planner_brief.md`
- `evidence.json`
- `evidence.md`
- `writer_packet.md`
- optional QA reports when `--draft` is provided
</academic-controller>

<evidence-first-retrieval>
Build the evidence table first. Do not draft argument prose until this exists.

```bash
python3 scripts/build_evidence_table.py \
  --question "Show pre-Korea institutional mind-control interest" \
  --query "BLUEBIRD origins before Korean War" \
  --query "CIA hypnosis research 1940s" \
  --query "ARTICHOKE predecessor evidence" \
  --out-json /tmp/evidence.json \
  --out-md /tmp/evidence.md
```

Retrieval behavior:
- runs multiple lexical project searches
- optionally expands with semantic per-document snippets
- re-ranks by similarity + thesis relevance + citation availability + category
- flags potential OCR artifacts
</evidence-first-retrieval>

<quote-fidelity-gate>
Never quote from memory. Use only annotation-backed quote text.

Required quote QA:

```bash
python3 scripts/quote_gate.py \
  --draft /tmp/draft.md \
  --evidence /tmp/evidence.json \
  --out-md /tmp/quote_report.md \
  --out-json /tmp/quote_report.json
```

Pass statuses:
- `EXACT_MATCH`
- `TRUNCATED_OK` (must use explicit omission markers)

Fail statuses:
- `MISMATCH`
- `EXPANDED_ERROR`
- `SOURCE_MISMATCH`

If any quote fails, revise and rerun until all pass.
</quote-fidelity-gate>

<claim-evidence-audit>
Require every major claim to have evidence support and citation markers.

```bash
python3 scripts/audit_draft.py \
  --draft /tmp/draft.md \
  --evidence /tmp/evidence.json \
  --out-md /tmp/claim_audit.md \
  --out-json /tmp/claim_audit.json
```

Audit checks:
- missing citation markers
- weak/no matching evidence
- potential contradiction risk for absolute claims
</claim-evidence-audit>

<project-memory>
Maintain rolling context so multi-day writing remains coherent.

```bash
# Refresh from live project state
python3 scripts/project_memory.py snapshot --memory-file ./memory/project-memory.json

# Merge run updates (claims made, open questions, source notes)
python3 scripts/project_memory.py update --input-json /tmp/memory_update.json --memory-file ./memory/project-memory.json

# View current memory summary
python3 scripts/project_memory.py show --memory-file ./memory/project-memory.json
```
</project-memory>

<evaluation-harness>
Benchmark retrieval quality over fixed test cases.

```bash
python3 scripts/evaluate_pipeline.py \
  --suite benchmarks/suite.template.json \
  --out-json /tmp/eval.json \
  --out-md /tmp/eval.md
```

Track over time:
- evidence count per case
- required-term recall
- average rerank score
- pass/fail per benchmark case
</evaluation-harness>

<writing-rules>
1. Evidence first, draft second.
2. Direct quotes must be exact `highlightedText` from annotation evidence rows.
3. Semantic snippet rows are discovery hints, not citation-ready quotes.
4. If OCR artifacts appear, flag them explicitly.
5. Every major claim must map to at least one evidence row.
6. Drafts with quotes must include quote verification output.
7. Report search gaps transparently.
</writing-rules>
