#!/usr/bin/env python3
"""Generate and optionally persist multi-prompt research sets."""

from __future__ import annotations

import argparse
import os
from typing import Any, Dict, List

from common import api_json, ensure_dir, runtime_config, write_json

DEFAULT_COLORS = ["#60a5fa", "#34d399", "#f59e0b", "#f472b6", "#a78bfa", "#f87171"]


def build_prompt_set(topic: str, thesis: str, section_goal: str) -> List[Dict[str, str]]:
    root = topic.strip()
    thesis_line = thesis.strip() if thesis else ""
    goal_line = section_goal.strip() if section_goal else ""

    prompts = [
        f"Find direct evidence supporting this thesis claim: {thesis_line or root}",
        f"Find counterevidence or limitations related to: {goal_line or root}",
        f"Extract methodology-relevant passages connected to: {root}",
        f"Find passages that establish chronology and causal sequence for: {root}",
        f"Find high-quality quotation candidates suitable for Chicago-style citation on: {root}",
    ]

    structured = []
    for idx, text in enumerate(prompts):
        structured.append({"text": text, "color": DEFAULT_COLORS[idx % len(DEFAULT_COLORS)]})
    return structured


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate and optionally save research prompt sets")
    parser.add_argument("--topic", required=True)
    parser.add_argument("--thesis", default="")
    parser.add_argument("--section-goal", default="")
    parser.add_argument("--template-name", default="Auto Prompt Set")
    parser.add_argument("--sm", default=None)
    parser.add_argument("--pid", default=None)
    parser.add_argument("--save-template", action="store_true", help="Persist prompt set via API")
    parser.add_argument("--out-json", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    cfg = runtime_config(sm=args.sm, pid=args.pid)

    prompts = build_prompt_set(args.topic, args.thesis, args.section_goal)
    payload: Dict[str, Any] = {
        "projectId": cfg.pid,
        "templateName": args.template_name,
        "prompts": prompts,
    }

    if args.save_template:
        created = api_json(
            cfg.sm,
            "POST",
            f"/api/projects/{cfg.pid}/prompt-templates",
            payload={"name": args.template_name, "prompts": prompts},
            expected_statuses=(201,),
        )
        payload["savedTemplate"] = created

    out_json = os.path.abspath(args.out_json)
    ensure_dir(os.path.dirname(out_json))
    write_json(out_json, payload)

    print(f"Generated {len(prompts)} prompts")
    if args.save_template:
        print(f"Saved template: {payload['savedTemplate'].get('id')}")
    print(f"Output: {out_json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
