# Implementation Handoff

## Recommended Routes

Core content:

- `/blog/ai-writing-with-real-sources`
- `/blog/avoid-hallucinated-quotes`
- `/blog/source-grounded-ai-writing`
- `/blog/citation-verification-ai`
- `/blog/best-ai-writing-tool-for-students`
- `/blog/how-to-organize-sources-for-research-paper`
- `/faq`

Comparison content:

- `/blog/scholarmark-vs-notebooklm`
- `/blog/scholarmark-vs-jenni-ai`
- `/blog/scholarmark-vs-grammarly-citation-finder`
- `/blog/scholarmark-vs-zotero`

Campaign:

- Link all relevant CTAs to `https://scholarmark.ai/summer`

## Metadata Fields

For each content page, store:

- `title`
- `metaDescription`
- `slug`
- `targetKeyword`
- `searchIntent`
- `audience`
- `recommendedInternalLinks`
- `recommendedVisualAsset`
- `academicIntegrityNote`
- `faqItems`
- `ctaText`
- `ctaUrl`

## Internal Link Rules

Every article should link to:

1. `https://scholarmark.ai/summer`
2. `/blog/source-grounded-ai-writing` or `/blog/ai-citations-research-papers`
3. One how-to guide, usually `/blog/how-to-start-a-thesis` or `/blog/how-to-organize-sources-for-research-paper`
4. One relevant bottom-funnel page when natural

Hub pages:

- `/blog/ai-writing-with-real-sources`
- `/blog/avoid-hallucinated-quotes`
- `/blog/source-grounded-ai-writing`
- `/faq`

## Visual Asset Map

- `summer-thesis-quote-context.png`: hallucinated quotes, quote bank, quote verification.
- `summer-thesis-large-source-base.png`: source organization, thesis source base, RAG/source grounding.
- `summer-thesis-source-grounded-ai.png`: AI writing with sources, source-grounded writing, comparison pages.
- `summer-thesis-evidence-to-paragraph-story.png`: outline, drafting, evidence-to-paragraph workflow.
- `summer-thesis-verification-workflow.png`: academic integrity, citation verification, claim review.
- Visual source page: https://scholarmark.ai/summer/visuals

## Product Proof To Show

If implementing as public pages, use UI proof that maps to real ScholarMark concepts:

- Project source list.
- Search across sources.
- Quote or annotation queue.
- Citation note panel.
- Draft with evidence/citation rail.
- Verification checklist.

Do not use fake university logos, fake testimonials, fake metrics, or claims that a citation is verified unless the UI proof supports that.

## Local Codebase Anchors

Use these local files when implementing:

- `/Users/yakub/Desktop/anotations-jan-26/ARCHITECTURE.md`
- `/Users/yakub/Desktop/anotations-jan-26/DESIGN.md`
- `/Users/yakub/Desktop/anotations-jan-26/AGENTS.md`

Feature areas from architecture:

- `server/projectRoutes.ts`: project documents, annotations, citation tools, project search.
- `server/chatRoutes.ts`: source-selected chat, compile, verify.
- `server/writingRoutes.ts`: SSE writing flow.
- `server/writingPipeline.ts`: planner/writer/stitcher pattern.
- `server/quoteJumpLinks.ts`: source-jump links in compiled markdown.
- `client/src/App.tsx`: route registration patterns.

## Build Order For ScholarMark Agent

1. Add content data model or markdown loader for blog/FAQ pages.
2. Create page templates for article, FAQ, and comparison pages.
3. Add the seven core routes first.
4. Add internal links and Summer CTA blocks.
5. Add FAQ schema if the site pipeline supports structured data.
6. Add comparison routes after the core trust pages are live.
7. Verify mobile/desktop layout and metadata.

## QA Checklist

- Page title includes target keyword naturally.
- Meta description is 140 to 160 characters when possible.
- No banned claims.
- CTA points to `https://scholarmark.ai/summer`.
- Academic integrity note appears where AI use, citations, or quotes are discussed.
- At least two internal links are included.
- External claims link to cited sources.
- No public page includes private lead data.
- No fake testimonials or fake institutional proof.

