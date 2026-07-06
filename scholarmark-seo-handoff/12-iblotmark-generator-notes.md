# iBoltMark Generator Notes For ScholarMark Content

The local iBoltMark repo includes a real blog generation subsystem:

- `server/blogPipeline.ts`
- `server/brandVoice.ts`
- `server/htmlRenderer.ts`
- `/api/blog/generate`
- `/api/blog/posts`
- `/api/blog/queue`

It uses a 4-phase generation engine:

1. Planner
2. Section Writer
3. Stitcher
4. Verifier

## Can It Generate ScholarMark Blog Posts?

Yes, as a framework. But do not run it with the default iBolt configuration for ScholarMark content.

The pipeline was originally built for ecommerce/Shopify blog generation. It expects company context, keywords, product/context data, and a brand profile. If it falls back to defaults, it can pull in iBolt Mounts assumptions, product language, Shopify product-link behavior, and ecommerce CTAs.

For ScholarMark, use one of these safe approaches:

## Safe Approach A: Use This Folder As The Generated Output

The `content/` folder already contains ready-to-publish ScholarMark posts and FAQ pages in the same practical shape the blog generator expects:

- SEO title
- meta description
- slug
- target keyword
- search intent
- audience
- internal links
- visual asset recommendation
- markdown body
- FAQ
- CTA
- academic integrity note

This is the recommended immediate path. Import or copy these files into the ScholarMark content system and render them as blog/FAQ pages.

## Safe Approach B: Configure A ScholarMark Company Profile

If the next agent wants to use `/api/blog/generate`, first create or seed a ScholarMark company profile with:

- display name: ScholarMark
- website: `https://scholarmark.ai`
- blog URL: `https://scholarmark.ai/blog`
- positioning: source-grounded academic writing workspace for serious students
- target word count: 800 to 1400
- banned phrases and forbidden claims from `01-positioning-guardrails.md`
- preferred CTA: Start your Summer Thesis Head Start
- no Shopify product URL pattern unless publishing pipeline requires a placeholder

Then create keyword clusters from `03-keyword-strategy.csv`.

Run generation only after confirming:

- no iBolt brand voice is used
- no product gallery is injected
- no Shopify product links are inserted
- no ecommerce CTA appears
- verifier checks academic-integrity claims

## Safe Approach C: Adapt The Prompt Builders

The repo's `server/brandVoice.ts` already accepts a generic company brand profile. For high-quality ScholarMark output, add a ScholarMark seed/profile and ensure every blog prompt uses that profile.

Prompt requirements:

- Build from sources and evidence.
- Do not position ScholarMark as writing assignments for students.
- Do not promise no hallucinations.
- Require quote/citation verification reminders.
- Use student-aware, premium, non-hype language.

## Recommended Next-Agent Job

The next agent should not spend time regenerating the first six pages unless implementation needs a different format. It should:

1. Read this handoff.
2. Create content routes or import markdown.
3. Add FAQ/schema metadata if supported.
4. Add Summer Thesis CTA blocks.
5. Verify pages render.

## Why This Package Was Generated Outside The Live Pipeline

The current request is ScholarMark-specific and trust-sensitive. The live iBoltMark generator is useful, but the default repo identity and many operational screens are still iBolt/ecommerce shaped. Writing and packaging the posts directly avoids accidental iBolt product language, Shopify assumptions, and unsupported claims.

