# iBOLT Retest Execution Gate

## Summary

- Priority requests: 204
- Blocked by survivor consolidation: 198
- Conditional after refresh/source cleanup: 6
- Smallest gated micro-run: 6
- OPENROUTER_API_KEY present in this shell: no

## Gate Summary

- Consolidate first: 198 requests, blocked_by_survivor_merge. Gate: Do not run yet. Confirm survivor URL, merge useful answer blocks and product modules, preserve benchmark prompts, then retest the survivor URL.
- Rewrite or refresh: 5 requests, conditional_after_rewrite. Gate: Run only after refreshed answer block, comparison language, product modules, FAQ/schema, and image alt proof are live.
- Source cleanup first: 1 requests, conditional_after_source_cleanup. Gate: Run only after schema, FAQ, quick answer, image alt text, product proof, and internal links are live.

## Smallest Safe Retest

- claude, W3 citation probe: which brands are cited for live streaming phone and camera mount -> Best Multi-Camera Phone Mount for Live Streaming. Gate: Refresh the page around the buyer query, then verify product names, comparison blocks, FAQ/schema, and CTA density before retest.
- claude, W3 citation probe: which brands are cited for offroad phone and camera mount -> Mounts to take off-roading in your Jeep Wrangler. Gate: Refresh the page around the buyer query, then verify product names, comparison blocks, FAQ/schema, and CTA density before retest.
- claude, W3 citation probe: which brands are cited for school tablet mount -> TOP TABLET STANDS FOR STUDENTS GOING BACK TO SCHOOL. Gate: Refresh the page around the buyer query, then verify product names, comparison blocks, FAQ/schema, and CTA density before retest.
- claude, W3 citation probe: which brands are cited for tractor and farm equipment tablet mount -> Best Tablet Mount for Tractor Cab Precision Agriculture. Gate: Add answer-first copy, FAQPage or Article schema, exact product modules, image alt text, and internal links before retest.
- chatgpt, W3 citation probe: which brands are cited for live streaming phone and camera mount -> Best Multi-Camera Phone Mount for Live Streaming. Gate: Refresh the page around the buyer query, then verify product names, comparison blocks, FAQ/schema, and CTA density before retest.
- chatgpt, W3 citation probe: which brands are cited for offroad phone and camera mount -> Mounts to take off-roading in your Jeep Wrangler. Gate: Refresh the page around the buyer query, then verify product names, comparison blocks, FAQ/schema, and CTA density before retest.

## Generated Files

- unblocked-provider-manifest.csv
- unblocked-retest-queue.csv
- blocked-consolidation-retest-queue.csv
- gate-summary.csv
- run-command-gates.csv
- top-blocked-pages.csv
- retest-execution-gate-data.json
- requests-by-gate-status.svg
- unblocked-by-provider.svg
