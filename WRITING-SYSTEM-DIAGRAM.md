# iBolt Blog Generator — System Diagrams

Visual reference for how the writing system works end-to-end: keyword ingestion, context banking, photo selection, blog generation, and publishing.

---

## 1. Full System Overview

```mermaid
graph TB
    subgraph INPUT["INPUT SOURCES"]
        CSV["Ubersuggest CSV<br/>(keywords)"]
        SHOPIFY_SCRAPE["iboltmounts.com<br/>/products.json"]
        PDF["Product Catalog<br/>(PDF upload)"]
        PHOTOS["Product Photos<br/>(file upload)"]
        REDDIT["Reddit<br/>(public JSON API)"]
        YOUTUBE["YouTube<br/>(Data API v3)"]
        WEB["Web Sources<br/>(URL scraping)"]
    end

    subgraph PROCESSING["DATA PROCESSING"]
        KW_IMPORT["Keyword Import<br/>keywordManager.ts"]
        KW_CLUSTER["AI Clustering<br/>(Claude Sonnet)"]
        PROD_SCRAPE["Product Scraper<br/>productScraper.ts"]
        CATALOG["Catalog Importer<br/>catalogImporter.ts"]
        PHOTO_BANK["Photo Bank<br/>photoBank.ts"]
        RESEARCH["Research Orchestrator<br/>iboltResearchAgent.ts<br/>(up to 50 parallel agents)"]
    end

    subgraph KNOWLEDGE["KNOWLEDGE STORES (SQLite)"]
        KW_DB[("keywords<br/>keyword_clusters")]
        PROD_DB[("ibolt_products<br/>product_verticals")]
        CONTEXT_DB[("context_entries<br/>industry_verticals")]
        PHOTO_DB[("product_photos<br/>+ AI analysis")]
        CHUNKS[("pipeline_context_chunks<br/>(pre-tokenized)")]
    end

    subgraph PIPELINE["4-PHASE BLOG PIPELINE"]
        P1["Phase 1: PLANNER<br/>JSON outline + SEO meta"]
        P2["Phase 2: SECTION WRITER<br/>Per-section content"]
        P3["Phase 3: STITCHER<br/>Combine + smooth transitions"]
        P4["Phase 4: VERIFIER<br/>Quality scoring (0-100)"]
    end

    subgraph OUTPUT["OUTPUT"]
        MARKDOWN["Markdown<br/>(stored in blog_posts)"]
        HTML["Shopify-Ready HTML<br/>+ FAQ schema + meta tags"]
        REVIEW["Human Review UI<br/>PostReview.tsx"]
        SHOPIFY_PUB["Shopify Store<br/>(draft articles)"]
    end

    CSV --> KW_IMPORT --> KW_DB
    KW_DB --> KW_CLUSTER --> KW_DB
    SHOPIFY_SCRAPE --> PROD_SCRAPE --> PROD_DB
    PDF --> CATALOG --> PROD_DB
    PHOTOS --> PHOTO_BANK --> PHOTO_DB
    REDDIT --> RESEARCH --> CONTEXT_DB
    YOUTUBE --> RESEARCH
    WEB --> RESEARCH

    KW_DB --> P1
    PROD_DB --> P1
    CONTEXT_DB --> CHUNKS --> P1
    PHOTO_DB --> P2

    P1 -->|"plan JSON"| P2
    P2 -->|"sections[]"| P3
    P3 -->|"markdown"| P4
    P4 -->|"score < 70"| P3
    P4 -->|"score >= 70"| MARKDOWN

    MARKDOWN --> HTML
    HTML --> REVIEW
    REVIEW -->|"approve"| SHOPIFY_PUB
```

---

## 2. Blog Pipeline Detail (4 Phases)

```mermaid
sequenceDiagram
    participant UI as BatchGenerator.tsx
    participant API as blogRoutes.ts
    participant PL as Planner
    participant SW as Section Writer
    participant ST as Stitcher
    participant VR as Verifier
    participant HR as htmlRenderer.ts
    participant DB as SQLite

    UI->>API: POST /api/blog/generate {clusterId}
    API->>DB: Load cluster keywords + vertical context
    API->>PL: buildPlannerPrompt() + context (3000 token budget)

    Note over PL: Claude Sonnet generates<br/>JSON outline with:<br/>- SEO meta title/desc<br/>- sections[]: title, keywords, products<br/>- keyword distribution plan

    PL-->>API: SSE: plan JSON
    API-->>UI: SSE: "plan" event

    loop For each section
        API->>SW: buildSectionWriterPrompt() + section context (1500 tokens)
        Note over SW: Claude writes section<br/>with brand voice baked in<br/>+ product mentions
        SW-->>API: SSE: section content
        API-->>UI: SSE: "section" event
    end

    API->>API: photoSelector.selectPhotosForPost()
    Note over API: Deterministic scoring:<br/>+3 product mention<br/>+2 vertical relevance<br/>+0-1 quality score<br/>-2 diversity penalty

    API->>ST: buildStitcherPrompt() + all sections + photo placements (800 tokens)
    Note over ST: Claude combines sections<br/>smooths transitions<br/>places photo markers<br/>ensures voice consistency
    ST-->>API: SSE: stitched markdown
    API-->>UI: SSE: "stitched" event

    API->>VR: buildVerifierPrompt() + markdown + plan (500 tokens)
    Note over VR: Scores 0-100 each:<br/>brandConsistency<br/>seoOptimization<br/>naturalLanguage<br/>factualAccuracy

    alt Overall score < 70
        VR-->>API: Low score + feedback
        API->>ST: Re-run with verifier notes
        ST-->>API: Improved markdown
    end

    VR-->>API: SSE: verification scores
    API->>HR: markdownToHtml() + autoLinkProducts() + extractFaqSchema()
    HR-->>API: Shopify-ready HTML
    API->>DB: Save blog_posts (markdown, html, scores, status=draft)
    API-->>UI: SSE: "complete" event
```

---

## 3. How Photos Are Found and Selected

```mermaid
graph LR
    subgraph SOURCES["Photo Sources"]
        UPLOAD["Manual Upload<br/>(drag & drop)"]
        DIR["Directory Import<br/>(batch from folder)"]
        CDN["Shopify CDN<br/>(product image_url)"]
    end

    subgraph STORE["Photo Bank"]
        SHARP["sharp processing<br/>normalize + thumbnail"]
        ASSOC["Auto-associate<br/>(filename matching)"]
        GPT4V["GPT-4V Analysis<br/>- angle_type<br/>- context_type<br/>- quality_score (0-1)<br/>- setting_description<br/>- vertical_relevance"]
    end

    subgraph SELECT["Photo Selection (per blog post)"]
        SCORE["Deterministic Scoring"]
        HERO["Hero Photo<br/>(highest overall)"]
        SECTION["Per-Section Photos<br/>(1 per section)"]
    end

    UPLOAD --> SHARP
    DIR --> SHARP
    CDN --> SHARP
    SHARP --> ASSOC --> GPT4V

    GPT4V --> SCORE
    SCORE --> HERO
    SCORE --> SECTION

    SCORE ---|"+3 product mention in section"| SCORE
    SCORE ---|"+2 vertical relevance"| SCORE
    SCORE ---|"+0.5-2 context_type match"| SCORE
    SCORE ---|"+0-1 quality_score"| SCORE
    SCORE ---|"-2 diversity penalty"| SCORE
```

---

## 4. How Product Info Is Verified and Enriched

```mermaid
graph TB
    subgraph SCRAPE["Primary Source: Shopify"]
        PRODUCTS_JSON["iboltmounts.com/products.json<br/>(paginated, 250/page)"]
        SHOPIFY_DATA["title, handle, description,<br/>product_type, vendor, tags,<br/>image_url, price, url"]
    end

    subgraph CATALOG["Enrichment: PDF Catalogs"]
        PDF_UPLOAD["Upload Product Catalog PDF"]
        PDF_PARSE["pdf-parse text extraction"]
        CHUNK["Smart chunking<br/>(page boundaries)"]
        AI_EXTRACT["Claude extracts:<br/>product name, description,<br/>page reference, specs"]
        MATCH["3-Tier Matching:<br/>1. Exact title match<br/>2. Fuzzy string match<br/>3. LLM similarity scoring"]
    end

    subgraph MAPPING["Vertical Mapping"]
        AI_MAP["Claude assigns products<br/>to industry verticals<br/>with relevance_score"]
    end

    subgraph VERIFY["Verification in Pipeline"]
        CONTEXT_INJECT["Product data injected<br/>into Planner prompt"]
        WRITER_CHECK["Section Writer references<br/>actual product specs"]
        VERIFIER_CHECK["Verifier Phase checks:<br/>- factualAccuracy score<br/>- product specs correct?<br/>- pricing accurate?<br/>- model numbers right?"]
    end

    PRODUCTS_JSON --> SHOPIFY_DATA --> AI_MAP
    PDF_UPLOAD --> PDF_PARSE --> CHUNK --> AI_EXTRACT --> MATCH
    MATCH -->|"catalog_description<br/>catalog_page_ref"| SHOPIFY_DATA

    AI_MAP --> CONTEXT_INJECT
    CONTEXT_INJECT --> WRITER_CHECK
    WRITER_CHECK --> VERIFIER_CHECK
    VERIFIER_CHECK -->|"score < 70"| WRITER_CHECK
```

---

## 5. Research Agent Architecture

```mermaid
graph TB
    subgraph TRIGGER["Research Triggers"]
        MANUAL["Manual: UI button<br/>/blog/context page"]
        SCHEDULER["Autonomous Scheduler<br/>scheduler.ts"]
    end

    subgraph ORCHESTRATOR["ResearchOrchestrator<br/>(max 50 concurrent)"]
        QUEUE["Task Queue"]
    end

    subgraph AGENTS["Parallel Research Agents"]
        REDDIT_AGENT["Reddit Agent<br/>Pre-configured subreddits per vertical<br/>e.g. fishing → r/fishing, r/kayakfishing, r/boating"]
        YT_AGENT["YouTube Agent<br/>YouTube Data API v3<br/>+ youtube-transcript package"]
        WEB_AGENT["Web Agent<br/>URL fetch + HTML parsing"]
    end

    subgraph EXTRACTION["AI Extraction"]
        CLAUDE_EXT["Claude Sonnet extracts:<br/>- terminology<br/>- pain_points<br/>- user_language<br/>- trends<br/>- competitive_landscape"]
    end

    subgraph STORE["Context Bank"]
        CONTEXT_DB[("context_entries table<br/>isVerified: false")]
        HUMAN["Human Review<br/>(verify/delete in UI)"]
        VERIFIED[("Verified Entries<br/>isVerified: true")]
    end

    MANUAL --> QUEUE
    SCHEDULER --> QUEUE
    QUEUE --> REDDIT_AGENT
    QUEUE --> YT_AGENT
    QUEUE --> WEB_AGENT

    REDDIT_AGENT -->|"raw text"| CLAUDE_EXT
    YT_AGENT -->|"transcripts"| CLAUDE_EXT
    WEB_AGENT -->|"page content"| CLAUDE_EXT

    CLAUDE_EXT --> CONTEXT_DB
    CONTEXT_DB --> HUMAN --> VERIFIED
    VERIFIED -->|"formatContextForPrompt()"| PIPELINE["Blog Pipeline"]
```

---

## 6. Keyword → Blog Post Flow

```mermaid
graph LR
    CSV["Ubersuggest CSV"] --> IMPORT["Import + Deduplicate<br/>keywordManager.ts"]
    IMPORT --> SCORE["Opportunity Score<br/>volume(0.4) + difficulty(0.3)<br/>+ position(0.3)"]
    SCORE --> CLUSTER["AI Clustering<br/>(Claude, batch 10)"]
    CLUSTER --> MAP["Auto-Map to Vertical<br/>verticalCreator.ts"]

    MAP --> SELECT["User selects clusters<br/>in BatchGenerator.tsx"]
    SELECT --> GENERATE["Blog Pipeline<br/>(4 phases)"]
    GENERATE --> DRAFT["Draft Post<br/>(status: draft)"]
    DRAFT --> REVIEW["Human Review<br/>PostReview.tsx"]
    REVIEW -->|"approve"| PUBLISH["Status: approved<br/>Ready for Shopify"]

    style CSV fill:#e1f5fe
    style PUBLISH fill:#c8e6c9
```

---

## 7. Data Flow Summary

```mermaid
graph TD
    subgraph INPUTS["Data Inputs"]
        A["Keywords (CSV)"]
        B["Products (Shopify scrape)"]
        C["Catalogs (PDF)"]
        D["Photos (upload)"]
        E["Research (Reddit/YT/Web)"]
    end

    subgraph DB["SQLite Database (31 tables)"]
        F["keywords + clusters"]
        G["ibolt_products"]
        H["context_entries"]
        I["product_photos"]
        J["pipeline_context_chunks"]
    end

    subgraph AI["AI Processing"]
        K["Claude Sonnet<br/>(generation)"]
        L["GPT-4V<br/>(photo analysis)"]
    end

    subgraph OUT["Outputs"]
        M["blog_posts<br/>(markdown + HTML)"]
        N["Shopify Drafts"]
        O["content-output/<br/>(24 files)"]
    end

    A --> F
    B --> G
    C --> G
    D --> I
    E --> H

    F --> J
    G --> J
    H --> J
    I --> K
    J --> K
    L --> I

    K --> M
    M --> N
    M --> O
```
