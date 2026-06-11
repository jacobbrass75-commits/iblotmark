#!/usr/bin/env python3
"""Build evidence packets from ScholarMark search endpoints.

Implements evidence-first retrieval with:
- multi-query lexical search across project annotations
- optional semantic snippet expansion per project document
- deterministic re-ranking
- machine-readable evidence JSON + markdown table
"""

from __future__ import annotations

import argparse
import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence

from common import (
    api_json,
    detect_ocr_artifact,
    ensure_dir,
    generate_query_variants,
    keyword_overlap_score,
    markdown_escape,
    runtime_config,
    sanitize_inline,
    stable_evidence_key,
    utc_now_iso,
    write_json,
)


@dataclass
class EvidenceOptions:
    sm: str
    pid: str
    question: str
    queries: List[str]
    limit_per_query: int
    include_semantic: bool
    semantic_per_doc: int
    max_semantic_docs: int
    top_n: int


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _annotation_priority(category: Optional[str]) -> float:
    if not category:
        return 0.0
    category = category.lower()
    if category == "evidence":
        return 0.12
    if category == "key_quote":
        return 0.10
    if category == "argument":
        return 0.08
    if category == "methodology":
        return 0.04
    return 0.02


def rerank_score(question: str, item: Dict[str, Any]) -> float:
    similarity = _safe_float(item.get("similarityScore"), 0.0)
    if similarity > 1.0:
        similarity = similarity / 100.0

    quote = str(item.get("highlightedText") or item.get("matchedText") or "")
    note = str(item.get("note") or "")
    context_text = f"{quote}\n{note}\n{item.get('documentFilename', '')}"

    relevance = keyword_overlap_score(question, context_text)
    citation_bonus = 0.08 if item.get("citationData") else 0.0
    note_bonus = 0.03 if note else 0.0
    category_bonus = _annotation_priority(item.get("category"))

    artifact, _ = detect_ocr_artifact(quote)
    artifact_penalty = 0.08 if artifact else 0.0

    score = (
        0.60 * similarity
        + 0.28 * relevance
        + citation_bonus
        + note_bonus
        + category_bonus
        - artifact_penalty
    )
    return round(score, 4)


def fetch_project_search(
    sm: str,
    pid: str,
    query: str,
    limit: int,
) -> Dict[str, Any]:
    return api_json(
        sm,
        "POST",
        f"/api/projects/{pid}/search",
        payload={"query": query, "limit": limit},
        expected_statuses=(200,),
    )


def fetch_project_docs(sm: str, pid: str) -> List[Dict[str, Any]]:
    payload = api_json(sm, "GET", f"/api/projects/{pid}/documents", expected_statuses=(200,))
    return payload if isinstance(payload, list) else []


def fetch_doc_semantic_search(
    sm: str,
    project_document_id: str,
    query: str,
) -> List[Dict[str, Any]]:
    payload = api_json(
        sm,
        "POST",
        f"/api/project-documents/{project_document_id}/search",
        payload={"query": query},
        expected_statuses=(200,),
    )
    return payload if isinstance(payload, list) else []


def gather_evidence(options: EvidenceOptions) -> Dict[str, Any]:
    seen_keys = set()
    evidence_rows: List[Dict[str, Any]] = []

    raw_search_stats = []

    for query in options.queries:
        result = fetch_project_search(options.sm, options.pid, query, options.limit_per_query)
        results = result.get("results") if isinstance(result, dict) else []
        if not isinstance(results, list):
            results = []

        raw_search_stats.append(
            {
                "query": query,
                "totalResults": int(result.get("totalResults") or len(results)),
                "searchTime": result.get("searchTime"),
            }
        )

        for item in results:
            if not isinstance(item, dict):
                continue

            quote = item.get("highlightedText")
            if item.get("type") != "annotation" or not isinstance(quote, str) or not quote.strip():
                continue

            key = stable_evidence_key(item)
            if key in seen_keys:
                continue
            seen_keys.add(key)

            artifact, reasons = detect_ocr_artifact(quote)
            row = {
                "sourceType": "annotation",
                "query": query,
                "type": item.get("type"),
                "annotationId": item.get("annotationId"),
                "projectDocumentId": item.get("projectDocumentId"),
                "documentId": item.get("documentId"),
                "documentFilename": item.get("documentFilename"),
                "category": item.get("category"),
                "note": item.get("note"),
                "matchedText": item.get("matchedText"),
                "highlightedText": quote,
                "citationData": item.get("citationData"),
                "similarityScore": _safe_float(item.get("similarityScore"), 0.0),
                "relevanceLevel": item.get("relevanceLevel"),
                "startPosition": item.get("startPosition"),
                "hasOcrArtifact": artifact,
                "ocrArtifactReasons": reasons,
            }
            row["reRankScore"] = rerank_score(options.question, row)
            evidence_rows.append(row)

    if options.include_semantic:
        docs = fetch_project_docs(options.sm, options.pid)
        ranked_docs = docs[: options.max_semantic_docs]

        semantic_query = options.queries[0] if options.queries else options.question
        for doc in ranked_docs:
            pd_id = doc.get("id")
            if not pd_id:
                continue
            try:
                snippets = fetch_doc_semantic_search(options.sm, pd_id, semantic_query)
            except Exception:
                continue

            for snippet in snippets[: options.semantic_per_doc]:
                text = str(snippet.get("text") or "").strip()
                if not text:
                    continue

                pseudo = {
                    "sourceType": "semantic_chunk",
                    "query": semantic_query,
                    "type": "semantic_chunk",
                    "annotationId": None,
                    "projectDocumentId": pd_id,
                    "documentId": doc.get("documentId"),
                    "documentFilename": (doc.get("document") or {}).get("filename"),
                    "category": None,
                    "note": "Semantic retrieval candidate. Requires manual quote confirmation before citation.",
                    "matchedText": text,
                    "highlightedText": text,
                    "citationData": None,
                    "similarityScore": _safe_float(snippet.get("similarity"), 0.0),
                    "relevanceLevel": "medium",
                    "startPosition": snippet.get("startPosition"),
                    "hasOcrArtifact": detect_ocr_artifact(text)[0],
                    "ocrArtifactReasons": detect_ocr_artifact(text)[1],
                }
                key = stable_evidence_key(pseudo)
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                pseudo["reRankScore"] = rerank_score(options.question, pseudo)
                evidence_rows.append(pseudo)

    evidence_rows.sort(key=lambda r: r.get("reRankScore", 0.0), reverse=True)
    top_rows = evidence_rows[: options.top_n]

    for index, row in enumerate(top_rows, start=1):
        row["rank"] = index

    return {
        "generatedAt": utc_now_iso(),
        "projectId": options.pid,
        "question": options.question,
        "queries": options.queries,
        "searchStats": raw_search_stats,
        "counts": {
            "totalCollected": len(evidence_rows),
            "returned": len(top_rows),
            "annotationEvidence": sum(1 for r in top_rows if r.get("sourceType") == "annotation"),
            "semanticEvidence": sum(1 for r in top_rows if r.get("sourceType") == "semantic_chunk"),
            "ocrArtifactWarnings": sum(1 for r in top_rows if r.get("hasOcrArtifact")),
        },
        "evidence": top_rows,
    }


def evidence_to_markdown(payload: Dict[str, Any]) -> str:
    lines = []
    lines.append("# Evidence Table")
    lines.append("")
    lines.append(f"Question: {payload.get('question', '')}")
    lines.append(f"Generated: {payload.get('generatedAt', '')}")
    lines.append("")

    counts = payload.get("counts", {})
    lines.append("## Retrieval Summary")
    lines.append("")
    lines.append(f"- Total collected: {counts.get('totalCollected', 0)}")
    lines.append(f"- Returned: {counts.get('returned', 0)}")
    lines.append(f"- Annotation evidence: {counts.get('annotationEvidence', 0)}")
    lines.append(f"- Semantic evidence: {counts.get('semanticEvidence', 0)}")
    lines.append(f"- OCR artifact warnings: {counts.get('ocrArtifactWarnings', 0)}")
    lines.append("")

    lines.append("## Ranked Evidence")
    lines.append("")
    lines.append("| Rank | Score | Category | Quote | Source | Annotation ID |")
    lines.append("|---:|---:|---|---|---|---|")

    for row in payload.get("evidence", []):
        quote = markdown_escape(sanitize_inline(str(row.get("highlightedText") or ""), 180))
        source = markdown_escape(str(row.get("documentFilename") or "Unknown"))
        category = markdown_escape(str(row.get("category") or row.get("sourceType") or ""))
        ann_id = markdown_escape(str(row.get("annotationId") or "-"))
        lines.append(
            f"| {row.get('rank', '-')} | {row.get('reRankScore', 0):.3f} | {category} | {quote} | {source} | {ann_id} |"
        )

    lines.append("")
    lines.append("## Usage Rules")
    lines.append("")
    lines.append("- Use direct quotes only from rows where `sourceType=annotation`.")
    lines.append("- Treat `semantic_chunk` rows as discovery hints, not citation-ready quotes.")
    lines.append("- Run `quote_gate.py` before finalizing any draft.")
    lines.append("- If `hasOcrArtifact=true`, flag it in prose rather than silently correcting.")

    return "\n".join(lines) + "\n"


def run_pipeline(
    question: str,
    queries: Optional[Sequence[str]],
    sm: str,
    pid: str,
    limit_per_query: int = 25,
    include_semantic: bool = True,
    semantic_per_doc: int = 2,
    max_semantic_docs: int = 8,
    top_n: int = 40,
) -> Dict[str, Any]:
    picked_queries = [q.strip() for q in (queries or []) if str(q).strip()]
    if not picked_queries:
        picked_queries = generate_query_variants(question)

    options = EvidenceOptions(
        sm=sm,
        pid=pid,
        question=question.strip(),
        queries=picked_queries,
        limit_per_query=limit_per_query,
        include_semantic=include_semantic,
        semantic_per_doc=semantic_per_doc,
        max_semantic_docs=max_semantic_docs,
        top_n=top_n,
    )
    return gather_evidence(options)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build evidence table for ScholarMark project research")
    parser.add_argument("--question", required=True, help="Research question or section target")
    parser.add_argument("--query", action="append", default=[], help="Manual query variant (can repeat)")
    parser.add_argument("--sm", default=None, help="ScholarMark base URL")
    parser.add_argument("--pid", default=None, help="Project ID")
    parser.add_argument("--limit-per-query", type=int, default=25)
    parser.add_argument("--top", type=int, default=40)
    parser.add_argument("--no-semantic", action="store_true", help="Disable per-document semantic expansion")
    parser.add_argument("--semantic-per-doc", type=int, default=2)
    parser.add_argument("--max-semantic-docs", type=int, default=8)
    parser.add_argument("--out-json", required=True)
    parser.add_argument("--out-md", default=None)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    cfg = runtime_config(sm=args.sm, pid=args.pid)

    payload = run_pipeline(
        question=args.question,
        queries=args.query,
        sm=cfg.sm,
        pid=cfg.pid,
        limit_per_query=max(1, args.limit_per_query),
        include_semantic=not args.no_semantic,
        semantic_per_doc=max(1, args.semantic_per_doc),
        max_semantic_docs=max(1, args.max_semantic_docs),
        top_n=max(1, args.top),
    )

    out_json = os.path.abspath(args.out_json)
    ensure_dir(os.path.dirname(out_json))
    write_json(out_json, payload)

    out_md = os.path.abspath(args.out_md) if args.out_md else os.path.splitext(out_json)[0] + ".md"
    ensure_dir(os.path.dirname(out_md))
    with open(out_md, "w", encoding="utf-8") as fh:
        fh.write(evidence_to_markdown(payload))

    counts = payload.get("counts", {})
    print(
        "Built evidence table: "
        f"{counts.get('returned', 0)} rows "
        f"({counts.get('annotationEvidence', 0)} annotation, "
        f"{counts.get('semanticEvidence', 0)} semantic)"
    )
    print(f"JSON: {out_json}")
    print(f"MD:   {out_md}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
