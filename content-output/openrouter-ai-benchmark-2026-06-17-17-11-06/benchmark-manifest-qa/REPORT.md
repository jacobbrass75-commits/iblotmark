# iBOLT Benchmark Manifest QA

## QA Result

Ready for controlled live run. No duplicate provider rows, no missing provider rows, and provider counts are balanced.

## Summary

- Selected prompts: 483
- Provider rows: 1449
- Provider balance: chatgpt 483; gemini_plain 483; claude 483
- Blocker flags: 0
- Review flags: 30
- Duplicate selected prompts: 0
- Duplicate provider requests: 0
- Missing provider requests: 0

## Recommended Run Order

- 1. Dry-run full manifest: 1449 requests. Verifies exact selection and output files without spending provider calls.
- 2. Live priority packet: 204 requests. Validates the highest-risk 204 requests before the full 1,449-request run.
- 3. Live high-risk category subset: 933 requests. Focuses on categories with the most competitor-only and zero-mention pressure.
- 4. Live full manifest: 1449 requests. Runs the complete all-blog coverage benchmark after the first waves look sane.
