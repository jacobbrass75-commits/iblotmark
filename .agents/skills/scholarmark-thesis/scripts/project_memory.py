#!/usr/bin/env python3
"""Rolling project memory manager.

Maintains a compact context file so long-running thesis work stays coherent.
"""

from __future__ import annotations

import argparse
import os
from collections import Counter
from typing import Any, Dict, List

from common import api_json, ensure_dir, read_json, runtime_config, utc_now_iso, write_json


def default_memory(pid: str) -> Dict[str, Any]:
    return {
        "projectId": pid,
        "updatedAt": utc_now_iso(),
        "project": {},
        "claimsMade": [],
        "openQuestions": [],
        "sourceNotes": [],
        "recentRuns": [],
        "stats": {},
    }


def load_memory(path: str, pid: str) -> Dict[str, Any]:
    if os.path.exists(path):
        payload = read_json(path)
        if isinstance(payload, dict):
            return payload
    return default_memory(pid)


def save_memory(path: str, payload: Dict[str, Any]) -> None:
    payload["updatedAt"] = utc_now_iso()
    ensure_dir(os.path.dirname(path))
    write_json(path, payload)


def cmd_snapshot(args: argparse.Namespace) -> int:
    cfg = runtime_config(sm=args.sm, pid=args.pid)
    memory = load_memory(args.memory_file, cfg.pid)

    project = api_json(cfg.sm, "GET", f"/api/projects/{cfg.pid}", expected_statuses=(200,))
    docs = api_json(cfg.sm, "GET", f"/api/projects/{cfg.pid}/documents", expected_statuses=(200,))

    annotation_counts = Counter()
    doc_annotation_counts = []

    for doc in docs[: args.max_docs]:
        pdid = doc.get("id")
        if not pdid:
            continue
        annotations = api_json(
            cfg.sm,
            "GET",
            f"/api/project-documents/{pdid}/annotations",
            expected_statuses=(200,),
        )
        count = 0
        for ann in annotations:
            category = ann.get("category") or "unknown"
            annotation_counts[category] += 1
            count += 1
        doc_annotation_counts.append(
            {
                "projectDocumentId": pdid,
                "documentId": doc.get("documentId"),
                "filename": (doc.get("document") or {}).get("filename"),
                "annotationCount": count,
            }
        )

    doc_annotation_counts.sort(key=lambda x: x["annotationCount"], reverse=True)

    memory["project"] = {
        "id": project.get("id"),
        "name": project.get("name"),
        "description": project.get("description"),
        "thesis": project.get("thesis"),
        "scope": project.get("scope"),
        "contextSummary": project.get("contextSummary"),
    }
    memory["stats"] = {
        "documentsInProject": len(docs),
        "documentsProfiled": len(doc_annotation_counts),
        "annotationCategoryCounts": dict(annotation_counts),
        "topDocumentsByAnnotations": doc_annotation_counts[:10],
    }

    memory.setdefault("recentRuns", [])
    memory["recentRuns"].append(
        {
            "type": "snapshot",
            "at": utc_now_iso(),
            "details": {
                "documentsInProject": len(docs),
                "categories": dict(annotation_counts),
            },
        }
    )
    memory["recentRuns"] = memory["recentRuns"][-20:]

    save_memory(args.memory_file, memory)
    print(f"Snapshot saved: {args.memory_file}")
    return 0


def merge_unique_list(existing: List[Any], additions: List[Any], limit: int = 200) -> List[Any]:
    merged = list(existing)
    seen = {str(item) for item in merged}
    for item in additions:
        key = str(item)
        if key in seen:
            continue
        seen.add(key)
        merged.append(item)
    return merged[-limit:]


def cmd_update(args: argparse.Namespace) -> int:
    cfg = runtime_config(sm=args.sm, pid=args.pid)
    memory = load_memory(args.memory_file, cfg.pid)

    payload = read_json(args.input_json)
    if not isinstance(payload, dict):
        raise ValueError("Update payload must be a JSON object")

    for key in ["claimsMade", "openQuestions", "sourceNotes"]:
        additions = payload.get(key)
        if isinstance(additions, list):
            memory[key] = merge_unique_list(memory.get(key, []), additions)

    if isinstance(payload.get("project"), dict):
        memory["project"] = {**memory.get("project", {}), **payload["project"]}

    run_note = payload.get("runNote")
    if run_note:
        memory.setdefault("recentRuns", [])
        memory["recentRuns"].append({"type": "update", "at": utc_now_iso(), "note": run_note})
        memory["recentRuns"] = memory["recentRuns"][-20:]

    save_memory(args.memory_file, memory)
    print(f"Memory updated: {args.memory_file}")
    return 0


def cmd_show(args: argparse.Namespace) -> int:
    cfg = runtime_config(sm=args.sm, pid=args.pid)
    memory = load_memory(args.memory_file, cfg.pid)

    print("# Project Memory")
    print()
    proj = memory.get("project", {})
    print(f"Project: {proj.get('name', '(unknown)')} ({cfg.pid})")
    if proj.get("thesis"):
        print(f"Thesis: {proj.get('thesis')}")
    if proj.get("scope"):
        print(f"Scope: {proj.get('scope')}")
    print()

    stats = memory.get("stats", {})
    print("## Stats")
    print(f"- Documents in project: {stats.get('documentsInProject', 0)}")
    print(f"- Documents profiled: {stats.get('documentsProfiled', 0)}")

    category_counts = stats.get("annotationCategoryCounts", {})
    if category_counts:
        print("- Annotation categories:")
        for category, count in sorted(category_counts.items(), key=lambda x: str(x[0])):
            print(f"  - {category}: {count}")
    print()

    print("## Claims Made")
    for claim in memory.get("claimsMade", [])[-10:]:
        print(f"- {claim}")
    print()

    print("## Open Questions")
    for question in memory.get("openQuestions", [])[-10:]:
        print(f"- {question}")
    print()

    print("## Source Notes")
    for note in memory.get("sourceNotes", [])[-10:]:
        print(f"- {note}")

    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Manage rolling ScholarMark project memory")
    parser.add_argument("--sm", default=None)
    parser.add_argument("--pid", default=None)
    parser.add_argument(
        "--memory-file",
        default=os.path.join(os.path.dirname(__file__), "..", "memory", "project-memory.json"),
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    p_snapshot = subparsers.add_parser("snapshot", help="Refresh project memory from API")
    p_snapshot.add_argument("--max-docs", type=int, default=20)

    p_update = subparsers.add_parser("update", help="Merge updates into memory")
    p_update.add_argument("--input-json", required=True)

    subparsers.add_parser("show", help="Print human-readable memory summary")

    return parser.parse_args()


def main() -> int:
    args = parse_args()
    args.memory_file = os.path.abspath(args.memory_file)

    if args.command == "snapshot":
        return cmd_snapshot(args)
    if args.command == "update":
        return cmd_update(args)
    if args.command == "show":
        return cmd_show(args)
    raise ValueError(f"Unknown command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
