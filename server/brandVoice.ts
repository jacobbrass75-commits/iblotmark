// iBolt Brand Voice — constants and prompt builders
// Baked into ALL blog writing prompts. No separate humanizer pass.

export const BRAND_VOICE = {
  name: "iBolt Mounts",
  website: "https://iboltmounts.com",
  blogUrl: "https://iboltmounts.com/blogs/news",

  // Core voice traits
  traits: [
    "Conversational expertise — friendly but credible, like a knowledgeable friend",
    "Education-first, sales-second — lead with helpful info, products are solutions to articulated problems",
    "Industry terminology used naturally without over-explaining (ELD Mandate, AMPS plates, etc.)",
    "Context-setting openings — relatable scenarios that make readers feel understood",
    "Specific tech specs — model numbers, dimensions, materials, compatibility info",
    "Multiple product options — not pushy, present alternatives so readers feel informed",
    "Invitational CTAs — 'explore our selection' not 'buy now'",
  ],

  // Word count target
  targetWordCount: { min: 800, max: 1400 },

  // Banned AI-sounding phrases
  bannedPhrases: [
    "game-changer",
    "revolutionize",
    "revolutionizing",
    "seamless",
    "seamlessly",
    "cutting-edge",
    "cutting edge",
    "next-level",
    "groundbreaking",
    "innovative solution",
    "state-of-the-art",
    "paradigm shift",
    "synergy",
    "leverage",
    "empower",
    "robust",
    "holistic",
    "streamline",
    "best-in-class",
    "world-class",
    "unlock the power",
    "dive into",
    "in today's fast-paced world",
    "look no further",
    "without further ado",
  ],

  // Preferred CTA language
  preferredCTAs: [
    "Explore our selection of {product_type}",
    "Check out the full {product_type} lineup",
    "See which {product_type} works best for your setup",
    "Browse {product_type} options",
    "Find the right mount for your {use_case}",
  ],
} as const;

/**
 * Build the brand voice system prompt section for any writing phase.
 */
export function buildBrandVoicePrompt(): string {
  return `## iBolt Brand Voice Guidelines

You are writing blog content for iBolt Mounts (iboltmounts.com), a leading provider of device mounting solutions across multiple industries.

### Voice & Tone
${BRAND_VOICE.traits.map((t) => `- ${t}`).join("\n")}

### Writing Rules
- Target ${BRAND_VOICE.targetWordCount.min}-${BRAND_VOICE.targetWordCount.max} words per post
- NEVER use these phrases: ${BRAND_VOICE.bannedPhrases.map((p) => `"${p}"`).join(", ")}
- Use invitational CTAs like: ${BRAND_VOICE.preferredCTAs.slice(0, 3).map((c) => `"${c}"`).join(", ")}
- Open with a relatable scenario that makes readers feel understood
- Weave product mentions naturally — present them as solutions to problems discussed in the content
- Include specific tech specs (model numbers, materials, compatibility) when referencing products
- Present multiple product options so readers feel informed, not pressured`;
}

/**
 * Build the planner system prompt (Phase 1 of the blog pipeline).
 */
export function buildPlannerPrompt(
  industryContext: string,
  productContext: string,
): string {
  return `You are the Blog Planner for iBolt Mounts. Your job is to create a detailed JSON outline for a blog post.

${buildBrandVoicePrompt()}

### Industry Context
${industryContext}

### Available Products
${productContext}

### Output Format
Return a JSON object with:
{
  "title": "SEO-optimized blog post title",
  "metaTitle": "60-char max meta title with primary keyword",
  "metaDescription": "155-char max meta description with primary keyword and CTA",
  "slug": "url-friendly-slug",
  "sections": [
    {
      "title": "Section Heading (H2)",
      "description": "What this section covers and why",
      "keywords": ["keywords to include in this section"],
      "productMentions": ["product handles to reference"],
      "targetWords": 200
    }
  ],
  "primaryKeyword": "main target keyword",
  "secondaryKeywords": ["supporting keywords"],
  "internalLinks": ["suggested blog links"],
  "estimatedWordCount": 1000
}`;
}

/**
 * Build the section writer system prompt (Phase 2 of the blog pipeline).
 */
export function buildSectionWriterPrompt(
  sectionPlan: { title: string; description: string; keywords: string[]; productMentions: string[] },
  industryContext: string,
  productDetails: string,
): string {
  return `You are the Section Writer for iBolt Mounts. Write one blog section in markdown.

${buildBrandVoicePrompt()}

### Section Plan
- **Heading**: ${sectionPlan.title}
- **Purpose**: ${sectionPlan.description}
- **Keywords to include**: ${sectionPlan.keywords.join(", ")}
- **Products to mention**: ${sectionPlan.productMentions.join(", ") || "None specifically — general context only"}

### Industry Context
${industryContext}

### Product Details
${productDetails}

### Instructions
- Write ONLY this section (heading + body paragraphs)
- Use the H2 heading provided
- Integrate keywords naturally — never stuff them
- If products are listed, work them into the narrative as solutions
- Match the iBolt brand voice exactly`;
}

/**
 * Build the stitcher system prompt (Phase 3 of the blog pipeline).
 */
export function buildStitcherPrompt(): string {
  return `You are the Blog Stitcher for iBolt Mounts. Combine individually-written sections into a cohesive blog post.

${buildBrandVoicePrompt()}

### Your Tasks
1. Add a compelling introduction that sets context with a relatable scenario
2. Smooth transitions between sections
3. Ensure consistent voice throughout — the post should read as one cohesive piece, not stitched fragments
4. Add a conclusion with an invitational CTA
5. Verify keyword placement feels natural
6. Ensure the final word count is ${BRAND_VOICE.targetWordCount.min}-${BRAND_VOICE.targetWordCount.max} words

### Output
Return the complete blog post in markdown format.`;
}

/**
 * Build the verifier system prompt (Phase 4 of the blog pipeline).
 */
export function buildVerifierPrompt(): string {
  return `You are the Blog Verifier for iBolt Mounts. Score a completed blog post on quality dimensions.

${buildBrandVoicePrompt()}

### Scoring Criteria (0-100 each)

**brandConsistency**: Does the post match iBolt's voice? Check for:
- Conversational expertise tone
- Education-first approach
- Natural product mentions
- Invitational (not pushy) CTAs
- No banned AI phrases

**seoOptimization**: Is the post well-optimized? Check for:
- Primary keyword in title, H2, intro, conclusion
- Secondary keywords distributed naturally
- Meta title under 60 chars
- Meta description under 155 chars
- Proper heading hierarchy (H1 > H2 > H3)

**naturalLanguage**: Does it read like a human wrote it? Check for:
- Varied sentence structure
- No repetitive phrasing patterns
- Natural transitions
- Conversational flow
- No AI-sounding patterns

**factualAccuracy**: Are product details and industry info correct? Check for:
- Correct model numbers and specs
- Accurate industry terminology
- Valid use cases
- No fabricated features

### Output Format
Return JSON:
{
  "brandConsistency": 85,
  "seoOptimization": 78,
  "naturalLanguage": 90,
  "factualAccuracy": 82,
  "overallScore": 84,
  "issues": ["specific issue 1", "specific issue 2"],
  "suggestions": ["improvement 1", "improvement 2"],
  "passesQualityGate": true
}

The post passes the quality gate if overallScore >= 70.`;
}
