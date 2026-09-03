# iBOLT B-roll library plan

## Outcome

Build a reusable, review-gated library of authentic iBOLT lifestyle photography that can be selected by the blog generator and matched to older posts without silently changing Shopify content.

## Source inventory

- Google Drive source: `iBOLT PRODUCT CONTENT - LIFESTYLE`
- 51 folders, 2,177 files, 54,404,257,882 bytes
- 942 blog-ready JPEG/PNG images
- 594 Sony ARW originals
- 66 MP4 videos
- 574 supporting/opaque files and one PDF
- Canonical inventory: `assets/broll/drive-manifest.json`

The working library starts with the 942 JPEG/PNG files. RAW files and videos remain represented in the manifest and can be archived locally, but they are not sent to the labeler or imported into the blog photo bank by default.

## Directory layout

```text
assets/broll/
  drive-manifest.json       private local source inventory (ignored)
  label-schema.json         tracked Luna output contract
  source/                   ignored downloaded originals
  derivatives/              ignored normalized web images/thumbnails
  labels/pending/           private local deterministic batch manifests (ignored)
  labels/completed/         private local reviewed Luna results (ignored)
  catalog.json              generated local catalog
  labels-index.json         generated merged label index
```

The repository is public. Obtain the source inventory, media, and completed labels
through an approved private transfer; they are not included in a fresh clone.

## Workflow

1. Download and extract the Drive folders under `assets/broll/source/` while preserving their folder names.
2. Run `npm run broll:prepare`. This hashes every JPEG/PNG, detects duplicate bytes, joins files to the Drive manifest, and creates deterministic 20-image Luna batches.
3. Give one pending batch at a time to a Codex task using GPT-5.6 Luna. The task views each image and returns JSON that conforms to `assets/broll/label-schema.json`. No Shopify or database writes occur during labeling.
4. Put completed batch JSON in `assets/broll/labels/completed/`, then run `npm run broll:merge`. Invalid or incomplete labels fail closed and remain review items.
5. Import approved labels/photos into the existing `product_photos` bank. Assets start as `needs_review`; AI labels never establish usage rights or auto-approve an image.
6. Update selection scoring to use vertical, setting, device, mounting surface, use-case, topic, quality, and crop metadata. Existing restricted/archive rules remain authoritative.
7. Run a read-only retrofit planner against existing blog posts. It should produce candidate placements, reasons, and confidence, not mutate posts or Shopify.
8. A human reviews the proposed hero/inline placements. Only a separate explicit approval may update hidden drafts or live Shopify articles.

## Safety and quality gates

- SHA-256 is the asset identity; filenames are not unique enough.
- Batch order and IDs are deterministic, so interrupted runs resume without relabeling completed images.
- A label is keyed by asset hash plus contract and prompt version.
- Do not label RAW/video files until a separate derivative policy exists.
- Do not infer ownership or release status from Drive access. Keep `rightsStatus=unknown` until reviewed.
- Faces, minors, license plates, third-party logos, unsafe installation geometry, unreadable screens, blur, and heavy cropping are explicit review flags.
- Product matches are candidates with confidence, never assertions based only on appearance.
- Retrofits are dry-run only until reviewed, with no automatic publishing.

## Luna task prompt

For each batch manifest, ask Luna to inspect every local image and emit one result per asset. Require exact `assetId`, `sha256`, and `contractVersion`; concise factual captions; useful alt text; controlled taxonomy values; conservative product candidates; and `needsReview=true` whenever product identity, rights, people/privacy, image quality, or installation safety is uncertain.
