# AI Test Area Coverage Audit

## Summary

- Expanded prompts: 207
- Provider requests: 621
- Categories covered: 14
- High-gap categories: 8
- No-mapped prompt categories: 13
- Product families audited: 10
- Product families with weak prompt coverage: 2
- Top under-tested categories: warehouse 100, amps/modular 100, fishing 90, travel 90, delivery 87, streaming 80, education 74, fleet 70
- Top weak product families: AMPS, adapters, balls, and bases 100, Creator, camera, and streaming mounts 75, Charging and magnetic phone docks 31, Cycling, motorcycle, and powersports 7, Travel and headrest mounts 1, Fleet, delivery, and vehicle phone mounts 0, Forklift and warehouse mounts 0, Barcode scanner and warehouse scanning 0

## Category Coverage

1. warehouse: Needs new solution pages before testing, gap 100, prompts 15, pages 17.
2. amps/modular: Needs new solution pages before testing, gap 100, prompts 13, pages 29.
3. fishing: Needs new solution pages before testing, gap 90, prompts 36, pages 17.
4. travel: Needs new solution pages before testing, gap 90, prompts 5, pages 0.
5. delivery: Needs new solution pages before testing, gap 87, prompts 23, pages 11.
6. streaming: Needs new solution pages before testing, gap 80, prompts 11, pages 16.
7. education: Needs new solution pages before testing, gap 74, prompts 6, pages 4.
8. fleet: Needs new solution pages before testing, gap 70, prompts 42, pages 25.
9. cycling: Add prompts after page cleanup, gap 58, prompts 6, pages 0.
10. restaurant: Add prompts after page cleanup, gap 50, prompts 31, pages 17.
11. agriculture: Adequate, monitor after expanded run, gap 44, prompts 4, pages 2.
12. offroad: Adequate, monitor after expanded run, gap 24, prompts 8, pages 4.

## Product Family Coverage

- AMPS, adapters, balls, and bases: test coverage 12, unlinked products 39, action: Add product-family prompts and map them to exact product modules before the next expanded run..
- Creator, camera, and streaming mounts: test coverage 14, unlinked products 26, action: Add product-family prompts and map them to exact product modules before the next expanded run..
- Charging and magnetic phone docks: test coverage 4, unlinked products 5, action: Keep existing category prompts, then retest after product modules are live..
- Cycling, motorcycle, and powersports: test coverage 10, unlinked products 8, action: Keep existing category prompts, then retest after product modules are live..
- Travel and headrest mounts: test coverage 5, unlinked products 1, action: Keep existing category prompts, then retest after product modules are live..
- Fleet, delivery, and vehicle phone mounts: test coverage 68, unlinked products 11, action: Keep existing category prompts, then retest after product modules are live..
- Forklift and warehouse mounts: test coverage 21, unlinked products 8, action: Keep existing category prompts, then retest after product modules are live..
- Barcode scanner and warehouse scanning: test coverage 21, unlinked products 8, action: Keep existing category prompts, then retest after product modules are live..
- Restaurant POS and tablet security: test coverage 26, unlinked products 7, action: Keep existing category prompts, then retest after product modules are live..
- Marine electronics and fish finder mounts: test coverage 35, unlinked products 7, action: Keep existing category prompts, then retest after product modules are live..

## First Prompt Rows To Protect In The Next Run

1. best barcode scanner mount for forklift (warehouse), refresh then retest, priority 96.
2. best budget fish finder mount (fishing), refresh then retest, priority 96.
3. best ELD mount for trucks (fleet), refresh then retest, priority 96.
4. best fish finder mount for small boat (fishing), canonical review before retest, priority 96.
5. best heavy duty vehicle phone mount (fleet), refresh then retest, priority 96.
6. best kayak fish finder mount (fishing), refresh then retest, priority 96.
7. best locking phone mount for shared delivery vehicles (delivery), canonical review before retest, priority 96.
8. best locking tablet stand for food trucks and quick service restaurants (restaurant), canonical review before retest, priority 96.
9. best multi tablet mount (restaurant), refresh then retest, priority 96.
10. best phone mount for Amazon Flex and delivery vans (delivery), canonical review before retest, priority 96.
11. best phone mount for construction vehicles and work trucks (fleet), canonical review before retest, priority 96.
12. best phone mount for delivery drivers (fleet), canonical review before retest, priority 96.
13. best phone mount for Instacart and grocery delivery drivers (delivery), canonical review before retest, priority 96.
14. best restaurant tablet mount (restaurant), refresh then retest, priority 96.
15. best tablet mount (tablet), refresh then retest, priority 96.

## Interpretation

The expanded benchmark is broad enough to run, but it is not evenly balanced against the site. Fleet, fishing, restaurant, delivery, and warehouse are high-pressure categories and should stay in the benchmark. AMPS/modular and streaming have many pages and product-family gaps, so they need more prompts if the goal is full product spread instead of only current competitor displacement.
