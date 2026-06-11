#!/usr/bin/env python3
"""Draft quality auditor.

Checks claim-to-evidence coverage, citation presence, and contradiction risk.
"""

from __future__ import annotations

import argparse
import os
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Tuple

from common import (
    ensure_dir,
    keyword_overlap_score,
    parse_citation_markers,
    read_json,
    sanitize_inline,
    tokenize,
    write_json,
)


ABSOLUTE_TERMS = {"always", "never", "only", "all", "none", "must", "cannot"}
CONTRAST_TERMS = {"however", "although", "but", "yet", "nevertheless", "some", "many", "often"}


@dataclass
class ClaimAudit:
    sentence: str
    paragraph_index: int
    has_citation_marker: bool
    support_score: float
    support_refs: List[str]
    severity: str
    issues: List[str]


def split_paragraphs(text: str) -> List[str]:
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    cleaned = []
    for p in paras:
        if p.startswith("#"):
            continue
        if p.startswith("```"):
            continue
        cleaned.append(p)
    return cleaned


def split_sentences(paragraph: str) -> List[str]:
    parts = re.split(r"(?<=[.!?])\s+", paragraph)
    return [" ".join(p.split()) for p in parts if len(" ".join(p.split())) >= 25]


def looks_like_claim(sentence: str) -> bool:
    if sentence.startswith('"') or sentence.startswith("“"):
        return False
    words = tokenize(sentence)
    return len(words) >= 6


def evidence_pool(evidence_payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    pool = []
    for item in evidence_payload.get("evidence", []):
        text = str(item.get("highlightedText") or item.get("matchedText") or "").strip()
        if not text:
            continue
        pool.append(
            {
                "annotationId": item.get("annotationId"),
                "documentFilename": item.get("documentFilename"),
                "text": text,
                "note": str(item.get("note") or ""),
                "category": item.get("category"),
            }
        )
    return pool


def supporting_evidence(sentence: str, pool: List[Dict[str, Any]], top_n: int = 3) -> Tuple[float, List[str]]:
    scored = []
    for entry in pool:
        score = keyword_overlap_score(sentence, f"{entry['text']}\n{entry['note']}")
        if score <= 0:
            continue
        ref = f"{entry.get('annotationId') or 'n/a'} @ {entry.get('documentFilename') or 'Unknown'}"
        scored.append((score, ref))

    scored.sort(key=lambda t: t[0], reverse=True)
    top = scored[:top_n]
    if not top:
        return 0.0, []
    avg = sum(s for s, _ in top) / len(top)
    return avg, [r for _, r in top]


def contradiction_risk(sentence: str, pool: List[Dict[str, Any]]) -> bool:
    sent_lower = sentence.lower()
    has_absolute = any(term in sent_lower for term in ABSOLUTE_TERMS)
    if not has_absolute:
        return False

    related = [
        entry
        for entry in pool
        if keyword_overlap_score(sentence, f"{entry['text']}\n{entry['note']}") >= 0.22
    ]
    if not related:
        return False

    contrast_hits = 0
    for entry in related:
        merged = f"{entry['text']} {entry['note']}".lower()
        if any(term in merged for term in CONTRAST_TERMS):
            contrast_hits += 1
    return contrast_hits >= 1


def audit(draft_text: str, evidence_payload: Dict[str, Any]) -> Dict[str, Any]:
    paragraphs = split_paragraphs(draft_text)
    pool = evidence_pool(evidence_payload)

    claim_audits: List[ClaimAudit] = []

    for p_index, paragraph in enumerate(paragraphs):
        markers = parse_citation_markers(paragraph)
        has_marker = bool(markers)
        sentences = split_sentences(paragraph)

        for sentence in sentences:
            if not looks_like_claim(sentence):
                continue

            support_score, refs = supporting_evidence(sentence, pool)
            issues: List[str] = []

            if not has_marker:
                issues.append("missing_citation_marker")
            if support_score < 0.16:
                issues.append("weak_or_missing_evidence")
            if contradiction_risk(sentence, pool):
                issues.append("potential_contradiction")

            if not issues:
                severity = "ok"
            elif "weak_or_missing_evidence" in issues:
                severity = "high"
            else:
                severity = "medium"

            claim_audits.append(
                ClaimAudit(
                    sentence=sentence,
                    paragraph_index=p_index,
                    has_citation_marker=has_marker,
                    support_score=round(support_score, 3),
                    support_refs=refs,
                    severity=severity,
                    issues=issues,
                )
            )

    high = [c for c in claim_audits if c.severity == "high"]
    medium = [c for c in claim_audits if c.severity == "medium"]

    return {
        "claimsChecked": len(claim_audits),
        "highSeverity": len(high),
        "mediumSeverity": len(medium),
        "status": "fail" if high else "warn" if medium else "pass",
        "claims": [
            {
                "sentence": c.sentence,
                "paragraphIndex": c.paragraph_index,
                "hasCitationMarker": c.has_citation_marker,
                "supportScore": c.support_score,
                "supportRefs": c.support_refs,
                "severity": c.severity,
                "issues": c.issues,
            }
            for c in claim_audits
        ],
    }


def to_markdown(report: Dict[str, Any]) -> str:
    lines = []
    lines.append("## Claim-Evidence Audit")
    lines.append("")
    lines.append(f"- Status: **{report.get('status', 'unknown').upper()}**")
    lines.append(f"- Claims checked: {report.get('claimsChecked', 0)}")
    lines.append(f"- High severity: {report.get('highSeverity', 0)}")
    lines.append(f"- Medium severity: {report.get('mediumSeverity', 0)}")
    lines.append("")

    lines.append("### Findings")
    lines.append("")

    issues_found = False
    for idx, claim in enumerate(report.get("claims", []), start=1):
        if claim.get("severity") == "ok":
            continue
        issues_found = True
        lines.append(
            f"- [{claim.get('severity').upper()}] Claim {idx} (paragraph {claim.get('paragraphIndex')}): "
            f"\"{sanitize_inline(claim.get('sentence', ''), 170)}\""
        )
        lines.append(f"  Issues: {', '.join(claim.get('issues') or [])}")
        lines.append(f"  Support score: {claim.get('supportScore')}")
        refs = claim.get("supportRefs") or []
        if refs:
            lines.append(f"  Candidate refs: {', '.join(refs)}")

    if not issues_found:
        lines.append("- No major claim-evidence issues detected by heuristic audit.")

    lines.append("")
    lines.append("### Notes")
    lines.append("")
    lines.append("- This is a heuristic QA gate. Human review is still required for interpretation-level rigor.")
    lines.append("- High severity means claims likely need additional direct evidence before final draft submission.")

    return "\n".join(lines) + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit draft for claim-to-evidence integrity")
    parser.add_argument("--draft", required=True)
    parser.add_argument("--evidence", required=True)
    parser.add_argument("--out-md", required=True)
    parser.add_argument("--out-json", default=None)
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    with open(args.draft, "r", encoding="utf-8") as fh:
        draft_text = fh.read()
    evidence_payload = read_json(args.evidence)

    report = audit(draft_text, evidence_payload)

    out_md = os.path.abspath(args.out_md)
    ensure_dir(os.path.dirname(out_md))
    with open(out_md, "w", encoding="utf-8") as fh:
        fh.write(to_markdown(report))

    if args.out_json:
        out_json = os.path.abspath(args.out_json)
        ensure_dir(os.path.dirname(out_json))
        write_json(out_json, report)

    print(
        "Draft audit complete: "
        f"status={report.get('status')} "
        f"claims={report.get('claimsChecked')} "
        f"high={report.get('highSeverity')}"
    )
    print(f"Report: {out_md}")

    return 1 if report.get("status") == "fail" else 0


if __name__ == "__main__":
    raise SystemExit(main())
