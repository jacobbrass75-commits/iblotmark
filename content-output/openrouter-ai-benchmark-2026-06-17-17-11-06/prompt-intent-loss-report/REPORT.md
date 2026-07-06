# iBOLT Prompt Intent Loss Report

This classifies the benchmark by buyer question type, so retests can run one small prompt at a time instead of treating all prompts the same.

## Summary

- Intent types: 8
- Baseline queries: 31
- All-blog selected prompts: 483
- Provider request rows: 1449
- Priority retest rows: 204

## Intent Loss Summary

1. best/recommendation: 57 competitor-only answers, 122 selected prompts, 366 provider requests. Add answer-first blocks that directly name iBOLT, the best-fit product family, ideal buyer, and why it belongs in the recommendation set.
2. category discovery: 3 competitor-only answers, 0 selected prompts, 0 provider requests. Create clearer category answer blocks and map the prompt to the closest live page before retesting.
3. setup/how-to: 2 competitor-only answers, 37 selected prompts, 111 provider requests. Add installation steps, mount pattern/ball-size clarity, compatibility notes, and HowTo-style structure where appropriate.
4. competitor comparison: 2 competitor-only answers, 177 selected prompts, 531 provider requests. Add fair comparison sections beside RAM, Arkon, iOttie, CTA Digital, ProClip, or Mount-It without budget framing.
5. product recall: 0 competitor-only answers, 25 selected prompts, 75 provider requests. Add exact product names, model/fit details, specs, product modules, and internal links from the relevant guide to the product page.
6. citation/source: 0 competitor-only answers, 16 selected prompts, 48 provider requests. After page edits, add FAQ/Article/Product schema, concise source-ready answer blocks, and off-site citations to the exact page.
7. shopping advice: 0 competitor-only answers, 106 selected prompts, 318 provider requests. Add decision trees by use case, surface one primary recommendation, and keep product modules clear without repeated cart CTAs.
8. brand/direct: 0 competitor-only answers, 0 selected prompts, 0 provider requests. Make branded pages reinforce iBOLT's specialist position: 300+ modular parts, AMPS compatibility, industrial materials, and workflow-specific kits.

## Highest Intent/Category Gaps

1. best/recommendation / fleet: 14 competitor-only answers, mention rate 7%. Sample: best phone mount for construction vehicles and work trucks
2. best/recommendation / restaurant: 14 competitor-only answers, mention rate 7%. Sample: best tablet mount for restaurant POS and delivery apps
3. best/recommendation / fishing: 10 competitor-only answers, mention rate 0%. Sample: best fish finder mount for small boat
4. best/recommendation / delivery: 9 competitor-only answers, mention rate 0%. Sample: best phone mount for Instacart and grocery delivery drivers
5. best/recommendation / warehouse: 7 competitor-only answers, mention rate 22%. Sample: best barcode scanner mount for forklift
6. category discovery / delivery: 3 competitor-only answers, mention rate 0%. Sample: commercial grade phone mount for delivery drivers
7. best/recommendation / tablet: 3 competitor-only answers, mention rate 0%. Sample: best tablet mount
8. competitor comparison / delivery: 2 competitor-only answers, mention rate 50%. Sample: magnetic vs clamp phone mounts for delivery work
9. setup/how-to / restaurant: 2 competitor-only answers, mention rate 0%. Sample: set up multiple tablets for DoorDash Uber Eats and Grubhub
10. competitor comparison / fleet: 0 competitor-only answers, mention rate 100%. Sample: iBolt vs RAM for fleet phone mounting
11. competitor comparison / amps/modular: 0 competitor-only answers, mention rate 0%. Sample: magnetic vs clamp phone mounts for delivery work
12. best/recommendation / amps/modular: 0 competitor-only answers, mention rate 0%. Sample: best 5 useful tablet mount for your kitchen

## First Retest Rows

- claude / best/recommendation / restaurant: best tablet mount for restaurant POS and delivery apps
- claude / best/recommendation / fleet: best phone mount for construction vehicles and work trucks
- chatgpt / best/recommendation / restaurant: best tablet mount for restaurant POS and delivery apps
- chatgpt / best/recommendation / fleet: best phone mount for construction vehicles and work trucks
- claude / best/recommendation / delivery: best phone mount for Instacart and grocery delivery drivers
- gemini_plain / best/recommendation / restaurant: best tablet mount for restaurant POS and delivery apps
- gemini_plain / best/recommendation / fleet: best phone mount for construction vehicles and work trucks
- chatgpt / best/recommendation / delivery: best phone mount for Instacart and grocery delivery drivers
- gemini_plain / best/recommendation / delivery: best phone mount for Instacart and grocery delivery drivers
- claude / competitor comparison / restaurant: RAM Mounts vs iBOLT for tablet mount for restaurant pos and delivery apps
- claude / competitor comparison / fleet: RAM Mounts vs iBOLT for phone mount for construction vehicles and work trucks
- chatgpt / competitor comparison / restaurant: RAM Mounts vs iBOLT for tablet mount for restaurant pos and delivery apps
