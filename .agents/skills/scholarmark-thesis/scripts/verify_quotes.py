#!/usr/bin/env python3
import json
import re
import sys
from typing import Any, Dict, List


def normalize_truncation_markers(text: str) -> str:
    stripped = (
        text.replace("[...]", "")
        .replace("...", "")
        .replace("…", "")
        .replace("[…]", "")
        .strip()
    )
    return " ".join(stripped.split())


def is_truncated_match(draft_text: str, source_text: str) -> bool:
    if not source_text or not draft_text:
        return False

    # Split on common ellipsis markers and ensure segments appear in order.
    parts = [
        " ".join(part.split())
        for part in re.split(r"\[\.\.\.\]|\.{3}|\[\u2026\]|\u2026", draft_text)
        if part.strip()
    ]
    if not parts:
        return False

    cursor = 0
    for part in parts:
        idx = source_text.find(part, cursor)
        if idx < 0:
            return False
        cursor = idx + len(part)
    return True


def best_similarity(a: str, b: str) -> float:
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    overlap = sum(1 for x, y in zip(a, b) if x == y)
    return overlap / max(len(a), len(b), 1)


def detect_ocr_artifact(text: str) -> List[str]:
    reasons: List[str] = []
    if not text:
        return reasons

    if "�" in text:
        reasons.append("replacement-character")
    if re.search(r"\b[a-zA-Z]{1,2}-\s+[a-zA-Z]{2,}\b", text):
        reasons.append("line-break-hyphenation")
    if re.search(r"\b[A-Z](?:\s+[A-Z]){5,}\b", text):
        reasons.append("spaced-uppercase-run")
    if re.search(r"[^\x09\x0A\x0D\x20-\x7E]", text):
        reasons.append("non-ascii-glyphs")
    return reasons


def verify(draft_quotes: List[Dict[str, Any]], source_quotes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    results: List[Dict[str, Any]] = []

    for idx, draft in enumerate(draft_quotes):
        draft_text = str(draft.get("text", ""))
        draft_source_id = draft.get("sourceAnnotationId")
        matched = False

        for source in source_quotes:
            source_text = str(source.get("highlightedText", ""))
            source_id = source.get("annotationId")

            if draft_source_id and source_id and str(draft_source_id) != str(source_id):
                continue

            if draft_text == source_text:
                ocr_reasons = detect_ocr_artifact(source_text)
                results.append(
                    {
                        "quote_index": idx,
                        "status": "EXACT_MATCH",
                        "draft": draft_text[:120],
                        "sourceAnnotationId": source_id,
                        "ocrArtifactWarning": bool(ocr_reasons),
                        "ocrArtifactReasons": ocr_reasons,
                    }
                )
                matched = True
                break

            trimmed = normalize_truncation_markers(draft_text)
            if trimmed and trimmed in source_text:
                ocr_reasons = detect_ocr_artifact(source_text)
                results.append(
                    {
                        "quote_index": idx,
                        "status": "TRUNCATED_OK",
                        "draft": draft_text[:120],
                        "sourceAnnotationId": source_id,
                        "ocrArtifactWarning": bool(ocr_reasons),
                        "ocrArtifactReasons": ocr_reasons,
                    }
                )
                matched = True
                break

            if is_truncated_match(draft_text, source_text):
                ocr_reasons = detect_ocr_artifact(source_text)
                results.append(
                    {
                        "quote_index": idx,
                        "status": "TRUNCATED_OK",
                        "draft": draft_text[:120],
                        "sourceAnnotationId": source_id,
                        "ocrArtifactWarning": bool(ocr_reasons),
                        "ocrArtifactReasons": ocr_reasons,
                    }
                )
                matched = True
                break

            if source_text and source_text in draft_text:
                results.append(
                    {
                        "quote_index": idx,
                        "status": "EXPANDED_ERROR",
                        "draft": draft_text[:120],
                        "source": source_text[:120],
                        "sourceAnnotationId": source_id,
                        "note": "Draft appears to include extra text outside the source quote.",
                    }
                )
                matched = True
                break

        if matched:
            continue

        if draft_source_id:
            results.append(
                {
                    "quote_index": idx,
                    "status": "SOURCE_MISMATCH",
                    "draft": draft_text[:120],
                    "note": f"Draft requires sourceAnnotationId={draft_source_id}, but no matching source quote was found.",
                }
            )
            continue

        best = ""
        best_ratio = 0.0
        for source in source_quotes:
            source_text = str(source.get("highlightedText", ""))
            ratio = best_similarity(draft_text, source_text)
            if ratio > best_ratio:
                best_ratio = ratio
                best = source_text

        results.append(
            {
                "quote_index": idx,
                "status": "MISMATCH",
                "draft": draft_text[:120],
                "closest_source": best[:120],
                "similarity": round(best_ratio, 3),
                "note": "Quote does not match any source quote exactly.",
            }
        )

    return results


def main() -> int:
    payload = json.load(sys.stdin)
    draft_quotes = payload.get("draft_quotes", [])
    source_quotes = payload.get("source_quotes", [])

    if not isinstance(draft_quotes, list) or not isinstance(source_quotes, list):
        print("FAIL input must contain arrays: draft_quotes and source_quotes")
        return 1

    results = verify(draft_quotes, source_quotes)

    has_fail = False
    for result in results:
        status = result["status"]
        ok = status in ("EXACT_MATCH", "TRUNCATED_OK")
        if not ok:
            has_fail = True
        icon = "PASS" if ok else "FAIL"
        print(f"{icon} Quote {result['quote_index']}: {status}")
        print(f"  Draft: \"{result.get('draft', '')}\"")
        if "closest_source" in result:
            print(f"  Closest Source: \"{result['closest_source']}\"")
            print(f"  Similarity: {result.get('similarity')}")
        if "source" in result:
            print(f"  Source: \"{result['source']}\"")
        if "note" in result:
            print(f"  Note: {result['note']}")
        if result.get("ocrArtifactWarning"):
            print(f"  OCR Warning: {', '.join(result.get('ocrArtifactReasons') or [])}")
        print()

    return 1 if has_fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
