#!/usr/bin/env python3
"""Shared utilities for ScholarMark thesis automation scripts."""

from __future__ import annotations

import json
import os
import re
import ssl
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

DEFAULT_TIMEOUT = 90
DEFAULT_SM = "http://89.167.10.34:5001"
DEFAULT_PID = "cf547e4d-712b-42a1-a33d-6cb67e68e670"


class ApiError(RuntimeError):
    def __init__(self, status: int, path: str, message: str):
        super().__init__(f"HTTP {status} for {path}: {message}")
        self.status = status
        self.path = path
        self.message = message


@dataclass
class RuntimeConfig:
    sm: str
    pid: str


def runtime_config(sm: Optional[str] = None, pid: Optional[str] = None) -> RuntimeConfig:
    return RuntimeConfig(
        sm=(sm or os.environ.get("SM") or DEFAULT_SM).rstrip("/"),
        pid=pid or os.environ.get("PID") or DEFAULT_PID,
    )


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ssl_context_for(url: str) -> Optional[ssl.SSLContext]:
    if url.startswith("https://"):
        return ssl.create_default_context()
    return None


def api_json(
    sm: str,
    method: str,
    path: str,
    payload: Optional[Dict[str, Any]] = None,
    timeout: int = DEFAULT_TIMEOUT,
    expected_statuses: Sequence[int] = (200,),
) -> Any:
    url = f"{sm}{path}"
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(url=url, method=method.upper(), data=data, headers=headers)

    try:
        with urllib.request.urlopen(request, timeout=timeout, context=_ssl_context_for(url)) as response:
            status = response.getcode()
            body_bytes = response.read()
            body_text = body_bytes.decode("utf-8", errors="replace")
            if status not in expected_statuses:
                raise ApiError(status, path, body_text[:500])
            if not body_text.strip():
                return None
            try:
                return json.loads(body_text)
            except json.JSONDecodeError as exc:
                raise ApiError(status, path, f"Invalid JSON response: {exc}") from exc
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        if exc.code not in expected_statuses:
            raise ApiError(exc.code, path, body[:500]) from exc
        if not body.strip():
            return None
        return json.loads(body)
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Request failed for {path}: {exc}") from exc


def tokenize(text: str) -> List[str]:
    return [t for t in re.split(r"[^a-zA-Z0-9]+", text.lower()) if len(t) >= 3]


def unique_preserve_order(items: Iterable[str]) -> List[str]:
    seen = set()
    ordered = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        ordered.append(item)
    return ordered


def keyword_overlap_score(a: str, b: str) -> float:
    a_tokens = set(tokenize(a))
    b_tokens = set(tokenize(b))
    if not a_tokens or not b_tokens:
        return 0.0
    inter = a_tokens.intersection(b_tokens)
    return len(inter) / max(len(a_tokens), 1)


def generate_query_variants(question: str) -> List[str]:
    q = " ".join(question.split())
    base_tokens = tokenize(q)
    variants = [q]

    if len(base_tokens) >= 4:
        variants.append(" ".join(base_tokens[:6]))
        variants.append(" ".join(base_tokens[-6:]))

    technical = [
        "primary source evidence",
        "counterargument evidence",
        "methodology limitations",
    ]
    variants.extend([f"{q} {t}" for t in technical])

    # Keep this deterministic and compact.
    return unique_preserve_order(v for v in variants if v.strip())[:6]


def sanitize_inline(text: str, limit: int = 240) -> str:
    compact = " ".join(text.replace("\n", " ").split())
    if len(compact) <= limit:
        return compact
    return compact[: limit - 1] + "…"


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def write_json(path: str, payload: Any) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)


def read_json(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def markdown_escape(text: str) -> str:
    return text.replace("|", "\\|")


def stable_evidence_key(item: Dict[str, Any]) -> str:
    ann = item.get("annotationId")
    if ann:
        return f"ann:{ann}"

    doc = item.get("documentId") or ""
    start = item.get("startPosition")
    quote = item.get("highlightedText") or item.get("matchedText") or ""
    return f"doc:{doc}:{start}:{quote[:80]}"


def extract_year_markers(text: str) -> List[str]:
    return re.findall(r"\b(1[89]\d{2}|20\d{2})\b", text)


def detect_ocr_artifact(text: str) -> Tuple[bool, List[str]]:
    if not text:
        return False, []

    reasons: List[str] = []

    if "�" in text:
        reasons.append("replacement-character")

    if re.search(r"\b[a-zA-Z]{1,2}-\s+[a-zA-Z]{2,}\b", text):
        reasons.append("line-break-hyphenation")

    if re.search(r"\b[A-Z](?:\s+[A-Z]){5,}\b", text):
        reasons.append("spaced-uppercase-run")

    if re.search(r"[^\x09\x0A\x0D\x20-\x7E]", text):
        reasons.append("non-ascii-glyphs")

    return bool(reasons), reasons


def parse_citation_markers(text: str) -> List[str]:
    markers = []
    markers.extend(re.findall(r"\[\^[^\]]+\]", text))
    markers.extend(re.findall(r"\((?:[^()]*\d{4}[^()]*)\)", text))
    markers.extend(re.findall(r"\[[0-9]{1,3}\]", text))
    return unique_preserve_order(markers)
