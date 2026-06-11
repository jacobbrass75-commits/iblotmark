# New AI Search Benchmark Prompt Candidates

Date: 2026-05-13

Purpose: expand iBOLT benchmark coverage beyond the current forklift, warehouse, ELD, restaurant, delivery-driver, and heavy-duty phone set.

Execution note: run these through Computer Use in the actual consumer UIs, not the API benchmark runner, when measuring ranking. Browser-based observations are the benchmark source of truth because they include logged-in product/search surfaces and shopping-style answer behavior. The API runner remains useful for storage/scoring after manual observations are collected.

These are candidates, not yet activated in the DB, because the benchmark runner currently executes every `active` query by default.

Existing prompts avoided:
- `best forklift tablet mount`
- `best tablet mount for warehouse`
- `best phone mount for delivery drivers`
- `best restaurant tablet mount`
- `ibolt vs ram mount`
- `best ELD mount for trucks`
- `best heavy duty vehicle phone mount`
- `best fish finder mount for small boat`
- `best budget fish finder mount`
- `best kayak fish finder mount`
- `best barcode scanner mount for forklift`
- `best tablet mount for food truck`
- Current delivery, restaurant, and fleet gap-post prompts already in the DB.

## Recommended 20-Prompt Expansion

| Priority | Prompt | Category | Persona | Why It Matters | iBOLT Product Angle | Status |
|---:|---|---|---|---|---|---|
| 1 | best VESA monitor mount for forklift | Enterprise / Warehouse | Warehouse ops or IT manager adding fixed screens to forklifts | Expands beyond tablet mounts into higher-ticket industrial display installs | VESA 75/100 monitor pillar mounts, 38mm and 57mm ball joints, VESA triMag magnetic monitor mount | Content-worthy |
| 2 | best rugged tablet mount for field service vans | Enterprise / Fleet | Field service fleet manager for HVAC, utility, telecom, or maintenance vans | Adjacent to ELD and delivery, but broader and more enterprise | TabDock AMPS, FixedPro 360, FlexPro Seat Rail, wedge, suction, drill-base options | Content-worthy |
| 3 | best tablet mount for utility truck crews | Enterprise / Fleet | Utility, municipal, or field-crew fleet buyer | Tests public-sector and crew-vehicle visibility where RAM and Tackform may dominate | TabDock IncrediBOLT AMPS, Dock'n Lock AMPS, seat-rail and FlexPro hardware | Content-worthy |
| 4 | best locking tablet mount for classrooms | Education / Schools | School IT director securing shared classroom tablets | Existing vertical has education/security context but no benchmark coverage | Dock'n Lock tablet holders, LockPro drill base, TabDock stands | Content-worthy |
| 5 | best tablet mount for school bus or transportation fleet | Education / Fleet | School transportation director | Institutional fleet buyer with security, visibility, and rugged-use needs | Locking tablet holders, headrest/seat rail, AMPS and drill-base mounts | Product-gap-audit-first |
| 6 | best tablet mount for tractor cab precision agriculture | Agriculture / Farming | Farm operator or precision-ag manager | Agriculture is thin in mapped products, but valuable if product pages can prove the use case | TabDock BizMount AMPS/clamp, 20mm ATV/UTV/ag clamp, AMPS bases | Product-gap-audit-first |
| 7 | best Garmin Striker 4 mount for kayak fishing | Fishing / Boating | Kayak angler with a Garmin Striker 4 | More specific and product-backed than the existing generic kayak fish finder prompt | Garmin Striker 4 handlebar/rail mounts, dual arm, IncrediBOLT 360 clamp | Content-worthy |
| 8 | best fish finder mount for pontoon boat rail | Fishing / Boating | Pontoon owner or weekend angler | Different rail geometry and buyer language than kayak/small-boat prompts | Universal Marine Fish Finder rail mounts, 25mm and 38mm marine plates | Content-worthy |
| 9 | best marine electronics AMPS mounting plate | Fishing / Boating | DIY boat electronics installer | Tests technical AMPS intent where iBOLT has many adapter products | Universal Marine & Electronics Mounting Plate, 25mm and 38mm AMPS plates | Benchmark-only first |
| 10 | best boat phone mount for rough water | Fishing / Boating | Boater using phone for navigation, music, or fishing apps | Useful crossover query, but corrosion and rough-water proof need product-page support | Moto-Vise phone rail mounts, clamp/handlebar/rail hardware | Product-gap-audit-first |
| 11 | best phone mount for Jeep Wrangler off road trails | Off-Road / Jeep | Jeep owner using trail maps and off-road navigation | Core off-road consumer query likely dominated by Bulletpoint, RAM, and 67 Designs | Moto-Vise, seat rail, clamp, suction, AMPS parts, but Jeep-specific proof looks thin | Product-gap-audit-first |
| 12 | best tablet mount for overlanding navigation | Off-Road / Recreation | Overlanding driver using Gaia, onX, or tablet navigation | Higher-ticket recreation query with tablet plus rugged install angle | TabDock AMPS, wedge, seat rail, suction, clamp mounts | Content-worthy |
| 13 | best GoPro mount for UTV roll bar | Off-Road / Content Creation | UTV rider filming trail footage | Product lineup has clear GoPro/action-camera clamp and rail SKUs | GoPro/action camera handlebar/rail mounts, IncrediBOLT clamp, 88mm magnetic bases | Content-worthy |
| 14 | best overhead phone mount for cooking videos | Content Creation / Kitchen | Food creator, cooking instructor, or recipe blogger | Strong match to Stream-Cast and likely AI currently defaults to generic Amazon stands | Stream-Cast clamp and stand adjustable overhead phone mounts | Content-worthy |
| 15 | best overhead camera rig for product photography | Content Creation / Ecommerce | Ecommerce seller, studio creator, or tutorial producer | Upscale creator/commercial use tied to higher-priced Stream-Cast products | Stream-Cast overhead camera rig desk mount, wall/ceiling drill-base rigs | Content-worthy |
| 16 | best multi camera phone mount for live streaming | Content Creation / Streaming | Streamer, tutor, church/media volunteer, or seller | Tests multi-device creator hardware, not just single phone stands | 3-camera slide bars, Stream-Cast dual phone/tablet stands, creator custom kit | Content-worthy |
| 17 | best tablet mount for trade show kiosk booth | Enterprise / Events | Event marketer or sales ops lead | Commercial kiosk intent adjacent to POS but not restaurant-specific | TabDock POS tablet stand, Dock'n Lock drill-base tablet stand, Tablet Tower | Content-worthy |
| 18 | best Nintendo Switch headrest mount for road trips | Recreation / Travel | Parent planning long car trips | Product-specific route into family travel where iBOLT has visible headrest products | Switch Headrest, sPro2 Headrest Viewer, LockPro headrest tablet mount | Content-worthy |
| 19 | best phone mount for exercise bike or treadmill | Recreation / Fitness | Home gym user or gym operator | Catalog mentions exercise equipment and has post/pole/rail hardware, but benchmark coverage is absent | sPro2 AccessiBOLT, TabDock AccessiBOLT, post/pole/rail/handlebar clamps | Content-worthy |
| 20 | best wheelchair tablet mount for communication device | Accessibility / Healthcare | Wheelchair user, caregiver, rehab clinic, or AAC user | Specialized high-trust category with strong named AccessiBOLT product family | AccessiBOLT Dock'n Lock wheelchair tablet mounts, ArmTrack, Seat Track, miniProXL | Content-worthy |

## First Batch To Actually Run

Start with these 8 in browser-based benchmarks because the product evidence is strongest and the upside is closest to iBOLT's commercial positioning:

1. `best VESA monitor mount for forklift`
2. `best rugged tablet mount for field service vans`
3. `best tablet mount for utility truck crews`
4. `best Garmin Striker 4 mount for kayak fishing`
5. `best fish finder mount for pontoon boat rail`
6. `best overhead phone mount for cooking videos`
7. `best overhead camera rig for product photography`
8. `best wheelchair tablet mount for communication device`

## Audit Before Content

Do not generate content immediately for these until product pages are checked for explicit use-case language, in-stock status, images, and compatibility proof:

- `best tablet mount for school bus or transportation fleet`
- `best tablet mount for tractor cab precision agriculture`
- `best boat phone mount for rough water`
- `best phone mount for Jeep Wrangler off road trails`
- `best GoPro mount for UTV roll cage`

These are useful benchmark probes, but content can backfire if the product pages do not make the use case obvious to AI retrieval systems.
