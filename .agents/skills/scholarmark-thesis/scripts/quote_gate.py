#!/usr/bin/env python3
"""Quote gate for draft validation.

Checks draft quotes against evidence packet and emits a verification report.
Exit non-zero if any quote fails exact/truncated validation.
"""

from __future__ import annotations

import argparse
import os
import re
from typing import Any, Dict, List

from common import ensure_dir, read_json, sanitize_inline, write_json
from verify_quotes import verify


def extract_quotes(markdown_text: str) -> List[str]:
    quotes: List[str] = []

    # Curly and straight double quotes.
    patterns = [
        r'"([^"\n]{8,}?)"',
        r"“([^”\n]{8,}?)”",
    ]
    for pattern in patterns:
        for match in re.findall(pattern, markdown_text, flags=re.MULTILINE):
            cleaned = " ".join(match.split())
            if len(cleaned) >= 8:
                quotes.append(cleaned)

    # Unique while preserving order.
    seen = set()
    ordered = []
    for quote in quotes:
        if quote in seen:
            continue
        seen.add(quote)
        ordered.append(quote)
    return ordered


def build_draft_quotes(draft_text: str) -> List[Dict[str, Any]]:
    return [{"text": q} for q in extract_quotes(draft_text)]


def build_source_quotes(evidence_payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    quotes: List[Dict[str, Any]] = []
    for item in evidence_payload.get("evidence", []):
        if item.get("sourceType") != "annotation":
            continue
        text = str(item.get("highlightedText") or "").strip()
        if not text:
            continue
        quotes.append(
            {
                "annotationId": item.get("annotationId"),
                "documentId": item.get("documentId"),
                "documentFilename": item.get("documentFilename"),
                "highlightedText": text,
                "hasOcrArtifact": item.get("hasOcrArtifact"),
            }
        )

    # Dedupe by annotationId or text.
    deduped = []
    seen = set()
    for quote in quotes:
        key = quote.get("annotationId") or quote.get("highlightedText")
        if key in seen:
            continue
        seen.add(key)
        deduped.append(quote)
    return deduped


def result_to_markdown(results: List[Dict[str, Any]]) -> str:
    lines = []
    lines.append("## Quote Verification Report")
    lines.append("")

    pass_count = 0
    fail_count = 0
    for result in results:
        status = result.get("status")
        ok = status in ("EXACT_MATCH", "TRUNCATED_OK")
        if ok:
            pass_count += 1
        else:
            fail_count += 1

        icon = "PASS" if ok else "FAIL"
        lines.append(f"- {icon} Quote {result.get('quote_index')}: {status}")
        lines.append(f"  Draft: \"{sanitize_inline(result.get('draft', ''), 140)}\"")

        if result.get("source"):
            lines.append(f"  Source: \"{sanitize_inline(result.get('source', ''), 140)}\"")
        if result.get("closest_source"):
            lines.append(f"  Closest Source: \"{sanitize_inline(result.get('closest_source', ''), 140)}\"")
            lines.append(f"  Similarity: {result.get('similarity')}")
        if result.get("note"):
            lines.append(f"  Note: {result.get('note')}")
        if result.get("ocrArtifactWarning"):
            reasons = ", ".join(result.get("ocrArtifactReasons") or [])
            lines.append(f"  OCR Warning: {reasons}")

    lines.append("")
    lines.append(f"Summary: {pass_count} passed, {fail_count} failed")
    return "\n".join(lines) + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run quote-fidelity gate against a draft")
    parser.add_argument("--evidence", required=True, help="Path to evidence JSON from build_evidence_table.py")
    parser.add_argument("--draft", default=None, help="Path to markdown/text draft")
    parser.add_argument("--draft-quotes-json", default=None, help="Optional JSON with draft_quotes array")
    parser.add_argument("--out-md", required=True, help="Output markdown report path")
    parser.add_argument("--out-json", default=None, help="Optional output JSON report path")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    evidence = read_json(args.evidence)
    source_quotes = build_source_quotes(evidence)

    if args.draft_quotes_json:
        payload = read_json(args.draft_quotes_json)
        draft_quotes = payload.get("draft_quotes", [])
        if not isinstance(draft_quotes, list):
            raise ValueError("draft_quotes_json must contain a draft_quotes array")
    elif args.draft:
        with open(args.draft, "r", encoding="utf-8") as fh:
            draft_quotes = build_draft_quotes(fh.read())
    else:
        raise ValueError("Provide either --draft or --draft-quotes-json")

    results = verify(draft_quotes, source_quotes)

    out_md = os.path.abspath(args.out_md)
    ensure_dir(os.path.dirname(out_md))
    with open(out_md, "w", encoding="utf-8") as fh:
        fh.write(result_to_markdown(results))

    if args.out_json:
        out_json = os.path.abspath(args.out_json)
        ensure_dir(os.path.dirname(out_json))
        write_json(
            out_json,
            {
                "draftQuotes": draft_quotes,
                "sourceQuotes": source_quotes,
                "results": results,
            },
        )

    has_failures = any(r.get("status") not in ("EXACT_MATCH", "TRUNCATED_OK") for r in results)
    print(f"Quote gate complete: {len(results)} quotes checked; failures={int(has_failures)}")
    print(f"Report: {out_md}")
    return 1 if has_failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
