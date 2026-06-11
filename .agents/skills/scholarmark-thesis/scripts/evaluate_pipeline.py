#!/usr/bin/env python3
"""Benchmark harness for ScholarMark thesis workflow quality."""

from __future__ import annotations

import argparse
import os
from datetime import datetime, timezone
from statistics import mean
from typing import Any, Dict, List

from build_evidence_table import run_pipeline
from common import ensure_dir, keyword_overlap_score, read_json, runtime_config, sanitize_inline, write_json


def term_recall(evidence_rows: List[Dict[str, Any]], terms: List[str]) -> float:
    if not terms:
        return 1.0

    corpus = "\n".join(
        f"{row.get('highlightedText', '')}\n{row.get('note', '')}\n{row.get('documentFilename', '')}"
        for row in evidence_rows
    ).lower()

    hits = sum(1 for term in terms if term.lower() in corpus)
    return hits / max(len(terms), 1)


def evaluate_case(sm: str, pid: str, case: Dict[str, Any]) -> Dict[str, Any]:
    name = str(case.get("name") or "unnamed-case")
    question = str(case.get("question") or "").strip()
    if not question:
        raise ValueError(f"Case {name}: question is required")

    queries = case.get("queries") or []
    if not isinstance(queries, list):
        raise ValueError(f"Case {name}: queries must be array")

    payload = run_pipeline(
        question=question,
        queries=[str(q) for q in queries],
        sm=sm,
        pid=case.get("projectId") or pid,
        top_n=int(case.get("top") or 30),
        include_semantic=bool(case.get("includeSemantic", True)),
    )

    rows = payload.get("evidence", [])
    min_evidence = int(case.get("minEvidence") or 5)
    required_terms = [str(t) for t in case.get("mustIncludeTerms") or []]

    recall = term_recall(rows, required_terms)
    evidence_count = len(rows)
    avg_score = mean([float(r.get("reRankScore") or 0.0) for r in rows]) if rows else 0.0
    top_quote = sanitize_inline(str(rows[0].get("highlightedText") if rows else ""), 140)

    pass_threshold = float(case.get("minRecall") or 0.5)

    passed = evidence_count >= min_evidence and recall >= pass_threshold

    return {
        "name": name,
        "question": question,
        "passed": passed,
        "evidenceCount": evidence_count,
        "minEvidence": min_evidence,
        "requiredTermRecall": round(recall, 3),
        "minRecall": pass_threshold,
        "avgReRankScore": round(avg_score, 3),
        "topQuote": top_quote,
        "counts": payload.get("counts", {}),
    }


def markdown_report(results: List[Dict[str, Any]]) -> str:
    lines = []
    lines.append("# Evaluation Report")
    lines.append("")
    passed = sum(1 for r in results if r.get("passed"))
    lines.append(f"- Cases: {len(results)}")
    lines.append(f"- Passed: {passed}")
    lines.append(f"- Failed: {len(results) - passed}")
    lines.append("")

    lines.append("| Case | Status | Evidence | Recall | Avg Score |")
    lines.append("|---|---|---:|---:|---:|")
    for row in results:
        status = "PASS" if row.get("passed") else "FAIL"
        lines.append(
            f"| {row.get('name')} | {status} | {row.get('evidenceCount')} | "
            f"{row.get('requiredTermRecall'):.3f} | {row.get('avgReRankScore'):.3f} |"
        )

    lines.append("")
    lines.append("## Case Notes")
    lines.append("")
    for row in results:
        lines.append(f"- **{row.get('name')}** ({'PASS' if row.get('passed') else 'FAIL'})")
        lines.append(f"  Top quote: \"{row.get('topQuote')}\"")
    lines.append("")
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run benchmark evaluation for scholarmark-thesis workflow")
    parser.add_argument("--suite", required=True, help="Path to benchmark suite JSON")
    parser.add_argument("--sm", default=None)
    parser.add_argument("--pid", default=None)
    parser.add_argument("--out-json", required=True)
    parser.add_argument("--out-md", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    cfg = runtime_config(sm=args.sm, pid=args.pid)

    suite = read_json(args.suite)
    cases = suite.get("cases") if isinstance(suite, dict) else None
    if not isinstance(cases, list) or not cases:
        raise ValueError("Suite must contain non-empty `cases` array")

    results = [evaluate_case(cfg.sm, cfg.pid, case) for case in cases]

    out_json = os.path.abspath(args.out_json)
    out_md = os.path.abspath(args.out_md)
    ensure_dir(os.path.dirname(out_json))
    ensure_dir(os.path.dirname(out_md))

    summary = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "suite": os.path.abspath(args.suite),
        "projectId": cfg.pid,
        "results": results,
        "totals": {
            "cases": len(results),
            "passed": sum(1 for r in results if r.get("passed")),
            "failed": sum(1 for r in results if not r.get("passed")),
        },
    }

    write_json(out_json, summary)
    with open(out_md, "w", encoding="utf-8") as fh:
        fh.write(markdown_report(results))

    print(f"Evaluation complete: {summary['totals']['passed']}/{summary['totals']['cases']} cases passed")
    print(f"JSON: {out_json}")
    print(f"MD:   {out_md}")

    return 0 if summary["totals"]["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
