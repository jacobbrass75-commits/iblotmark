#!/usr/bin/env python3
"""Academic writing controller.

Orchestrates planner -> researcher -> writer packet -> verifier gates.
"""

from __future__ import annotations

import argparse
import os
from typing import List

from build_evidence_table import evidence_to_markdown, run_pipeline
from common import ensure_dir, generate_query_variants, runtime_config, write_json
from quote_gate import extract_quotes, result_to_markdown
from verify_quotes import verify
from audit_draft import audit, to_markdown as audit_to_markdown


def build_planner_brief(question: str, section_goal: str, queries: List[str]) -> str:
    lines = []
    lines.append("# Planner Brief")
    lines.append("")
    lines.append(f"Research Question: {question}")
    lines.append(f"Section Goal: {section_goal}")
    lines.append("")
    lines.append("## Required Claim Types")
    lines.append("")
    lines.append("- Core thesis-support claim")
    lines.append("- At least one methodological/limitations claim")
    lines.append("- At least one counterevidence or qualification claim")
    lines.append("")
    lines.append("## Query Set")
    lines.append("")
    for query in queries:
        lines.append(f"- {query}")
    lines.append("")
    lines.append("## Writing Constraints")
    lines.append("")
    lines.append("- Do not draft argument paragraphs until evidence packet is built.")
    lines.append("- Every major claim must map to at least one annotation-backed quote.")
    lines.append("- Run quote gate and claim-evidence audit before final output.")
    return "\n".join(lines) + "\n"


def build_writer_packet(question: str, section_goal: str, evidence_json_path: str, evidence_md_path: str) -> str:
    lines = []
    lines.append("# Writer Packet")
    lines.append("")
    lines.append(f"Question: {question}")
    lines.append(f"Section Goal: {section_goal}")
    lines.append("")
    lines.append("## Inputs")
    lines.append("")
    lines.append(f"- Evidence JSON: `{evidence_json_path}`")
    lines.append(f"- Evidence Table: `{evidence_md_path}`")
    lines.append("")
    lines.append("## Writer Rules")
    lines.append("")
    lines.append("- Use direct quotes only from annotation rows in evidence JSON.")
    lines.append("- Preserve exact quote text (or clearly mark omissions with `[...]`).")
    lines.append("- Attach citation marker to each major claim paragraph.")
    lines.append("- If a quote contains OCR artifacts, flag it instead of silently correcting.")
    lines.append("")
    lines.append("## Required QA")
    lines.append("")
    lines.append("- Run `quote_gate.py` on the draft.")
    lines.append("- Run `audit_draft.py` and resolve high-severity issues.")
    return "\n".join(lines) + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run ScholarMark thesis controller workflow")
    parser.add_argument("--question", required=True)
    parser.add_argument("--section-goal", required=True)
    parser.add_argument("--query", action="append", default=[])
    parser.add_argument("--sm", default=None)
    parser.add_argument("--pid", default=None)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--draft", default=None, help="Optional draft path for QA gates")
    parser.add_argument("--no-semantic", action="store_true")
    parser.add_argument("--top", type=int, default=40)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    cfg = runtime_config(sm=args.sm, pid=args.pid)

    out_dir = os.path.abspath(args.out_dir)
    ensure_dir(out_dir)

    queries = [q for q in args.query if q.strip()] or generate_query_variants(args.question)

    planner_path = os.path.join(out_dir, "planner_brief.md")
    with open(planner_path, "w", encoding="utf-8") as fh:
        fh.write(build_planner_brief(args.question, args.section_goal, queries))

    evidence_payload = run_pipeline(
        question=args.question,
        queries=queries,
        sm=cfg.sm,
        pid=cfg.pid,
        include_semantic=not args.no_semantic,
        top_n=args.top,
    )

    evidence_json = os.path.join(out_dir, "evidence.json")
    evidence_md = os.path.join(out_dir, "evidence.md")
    write_json(evidence_json, evidence_payload)
    with open(evidence_md, "w", encoding="utf-8") as fh:
        fh.write(evidence_to_markdown(evidence_payload))

    writer_packet = os.path.join(out_dir, "writer_packet.md")
    with open(writer_packet, "w", encoding="utf-8") as fh:
        fh.write(build_writer_packet(args.question, args.section_goal, evidence_json, evidence_md))

    status_code = 0

    if args.draft:
        draft_path = os.path.abspath(args.draft)
        with open(draft_path, "r", encoding="utf-8") as fh:
            draft_text = fh.read()

        # Quote gate.
        source_quotes = [
            {
                "annotationId": item.get("annotationId"),
                "highlightedText": item.get("highlightedText"),
            }
            for item in evidence_payload.get("evidence", [])
            if item.get("sourceType") == "annotation" and item.get("highlightedText")
        ]
        draft_quotes = [{"text": q} for q in extract_quotes(draft_text)]
        verify_results = verify(draft_quotes, source_quotes)
        quote_report_md = os.path.join(out_dir, "quote_verification_report.md")
        with open(quote_report_md, "w", encoding="utf-8") as fh:
            fh.write(result_to_markdown(verify_results))

        quote_fail = any(r.get("status") not in ("EXACT_MATCH", "TRUNCATED_OK") for r in verify_results)

        # Claim audit.
        audit_report = audit(draft_text, evidence_payload)
        audit_json_path = os.path.join(out_dir, "claim_audit.json")
        write_json(audit_json_path, audit_report)
        audit_md_path = os.path.join(out_dir, "claim_audit.md")
        with open(audit_md_path, "w", encoding="utf-8") as fh:
            fh.write(audit_to_markdown(audit_report))

        if quote_fail or audit_report.get("status") == "fail":
            status_code = 1

    print("Controller run complete")
    print(f"- Planner: {planner_path}")
    print(f"- Evidence JSON: {evidence_json}")
    print(f"- Evidence MD: {evidence_md}")
    print(f"- Writer Packet: {writer_packet}")
    if args.draft:
        print(f"- Quote Report: {os.path.join(out_dir, 'quote_verification_report.md')}")
        print(f"- Claim Audit: {os.path.join(out_dir, 'claim_audit.md')}")

    return status_code


if __name__ == "__main__":
    raise SystemExit(main())
