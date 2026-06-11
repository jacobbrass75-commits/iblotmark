// Brand voice defaults and prompt builders for the blog pipeline.
// iBolt remains the seeded default, but every builder accepts a company profile.

export const BRAND_VOICE = {
  name: "iBolt Mounts",
  displayName: "iBolt Mounts",
  website: "https://iboltmounts.com",
  websiteUrl: "https://iboltmounts.com",
  blogUrl: "https://iboltmounts.com/blogs/news",
  productUrlPattern: "https://iboltmounts.com/products/{handle}",
  shortDescription:
    "Modular, industrial-grade mounting systems for warehouses, forklifts, restaurants, fleets, marine use, and work vehicles.",
  positioning:
    'iBOLT is the specialist for business and industrial mounting applications: purpose-built parts, industry-standard compatibility, and product guidance that helps buyers choose the right setup.',

  traits: [
    "Conversational expertise: friendly but credible, like a knowledgeable friend",
    "Education-first, sales-second: lead with helpful info, products are solutions to articulated problems",
    "Industry terminology used naturally without over-explaining (ELD Mandate, AMPS plates, etc.)",
    "Context-setting openings: relatable scenarios that make readers feel understood",
    "Specific tech specs: model numbers, dimensions, materials, compatibility info",
    "Multiple product options: not pushy, present alternatives so readers feel informed",
    "Invitational CTAs: 'explore our selection' not 'buy now'",
  ],

  targetWordCount: { min: 800, max: 1400 },

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
    "budget option",
    "affordable alternative",
    "cheaper than RAM",
    "cost-effective alternative",
    "economical choice",
  ],

  keyMessaging: [
    "300+ modular parts in industry-standard sizes",
    "Purpose-built for specific industries, not generic mounts adapted for business",
    "Industrial-grade: heavy-gauge steel, aluminum construction, powder coating",
    "Compatible with industry-standard ball sizes (17mm, 20mm, 25mm/B size, 38mm/C size)",
    "Ships within 24 business hours, 2-year warranty",
    "Cross-compatible with RAM and other industry-standard mounts",
  ],

  preferredCTAs: [
    "Explore our selection of {product_type}",
    "Check out the full {product_type} lineup",
    "See which {product_type} works best for your setup",
    "Browse {product_type} options",
    "Find the right mount for your {use_case}",
  ],

  requiredTerms: ["iBOLT"],
  forbiddenClaims: [
    "Do not frame iBOLT as a budget, cheap, or lower-quality alternative to competitors",
    "Do not invent product specs, compatibility claims, certifications, or availability",
  ],
} as const;

const GENERIC_BRAND_VOICE = {
  displayName: "Brand",
  websiteUrl: "",
  blogUrl: "",
  productUrlPattern: "/products/{handle}",
  shortDescription: "An ecommerce brand with products, customer expertise, and educational content.",
  positioning:
    "Helpful, specific product guidance that helps customers understand their options and choose the right solution.",
  traits: [
    "Clear, practical expertise without hype",
    "Education-first, sales-second: lead with helpful context before product mentions",
    "Use customer language naturally and avoid over-explaining basic terms",
    "Specific details over vague claims",
    "Invitational CTAs, not pushy sales copy",
  ],
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
  keyMessaging: [
    "Use only verified product facts, specs, availability, and claims",
    "Explain tradeoffs clearly so buyers can choose confidently",
    "Connect product mentions to specific customer needs and use cases",
  ],
  preferredCTAs: [
    "Explore the full {product_type} selection",
    "Compare options for your setup",
    "Find the right option for your {use_case}",
  ],
  requiredTerms: [] as string[],
  forbiddenClaims: [
    "Do not invent product specs, compatibility claims, certifications, pricing, inventory, or availability",
    "Do not make competitor superiority claims unless the source data supports them",
  ],
  targetWordCount: { min: 800, max: 1400 },
} as const;

export interface BrandVoiceInput {
  displayName?: string | null;
  websiteUrl?: string | null;
  blogUrl?: string | null;
  productUrlPattern?: string | null;
  shortDescription?: string | null;
  positioning?: string | null;
  toneTraits?: string[] | null;
  traits?: string[] | null;
  bannedPhrases?: string[] | null;
  preferredCtas?: string[] | null;
  preferredCTAs?: string[] | null;
  keyMessaging?: string[] | null;
  requiredTerms?: string[] | null;
  requiredClaims?: string[] | null;
  forbiddenClaims?: string[] | null;
  writingSamples?: string[] | null;
  targetWordCount?: {
    min?: number | null;
    max?: number | null;
  } | null;
}

export interface ResolvedBrandVoice {
  displayName: string;
  websiteUrl: string;
  blogUrl: string;
  productUrlPattern: string;
  shortDescription: string;
  positioning: string;
  traits: string[];
  bannedPhrases: string[];
  preferredCTAs: string[];
  keyMessaging: string[];
  requiredTerms: string[];
  requiredClaims: string[];
  forbiddenClaims: string[];
  writingSamples: string[];
  targetWordCount: {
    min: number;
    max: number;
  };
}

function fallbackArray(value: readonly string[] | string[] | null | undefined, fallback: readonly string[]): string[] {
  return Array.isArray(value) && value.length > 0 ? [...value] : [...fallback];
}

export function resolveBrandVoice(profile?: BrandVoiceInput | null): ResolvedBrandVoice {
  const fallback = profile ? GENERIC_BRAND_VOICE : BRAND_VOICE;
  const displayName = profile?.displayName || fallback.displayName;
  const websiteUrl = profile?.websiteUrl || fallback.websiteUrl;
  const targetMin = profile?.targetWordCount?.min || fallback.targetWordCount.min;
  const targetMax = profile?.targetWordCount?.max || fallback.targetWordCount.max;

  return {
    displayName,
    websiteUrl,
    blogUrl: profile?.blogUrl || fallback.blogUrl,
    productUrlPattern: profile?.productUrlPattern || (websiteUrl ? `${websiteUrl.replace(/\/$/, "")}/products/{handle}` : fallback.productUrlPattern),
    shortDescription: profile?.shortDescription || fallback.shortDescription,
    positioning: profile?.positioning || fallback.positioning,
    traits: fallbackArray(profile?.toneTraits || profile?.traits, fallback.traits),
    bannedPhrases: fallbackArray(profile?.bannedPhrases, fallback.bannedPhrases),
    preferredCTAs: fallbackArray(profile?.preferredCtas || profile?.preferredCTAs, fallback.preferredCTAs),
    keyMessaging: fallbackArray(profile?.keyMessaging, fallback.keyMessaging),
    requiredTerms: fallbackArray(profile?.requiredTerms, fallback.requiredTerms),
    requiredClaims: Array.isArray(profile?.requiredClaims) ? [...profile.requiredClaims] : [],
    forbiddenClaims: fallbackArray(profile?.forbiddenClaims, fallback.forbiddenClaims),
    writingSamples: Array.isArray(profile?.writingSamples) ? [...profile.writingSamples] : [],
    targetWordCount: {
      min: targetMin,
      max: Math.max(targetMax, targetMin),
    },
  };
}

export function buildProductUrl(handle: string, profile?: BrandVoiceInput | null): string {
  const voice = resolveBrandVoice(profile);
  return voice.productUrlPattern.replace("{handle}", handle);
}

function formatList(items: string[], fallback = "- None specified"): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : fallback;
}

export function buildBrandVoicePrompt(profile?: BrandVoiceInput | null): string {
  const voice = resolveBrandVoice(profile);
  const writingSamples = voice.writingSamples.length > 0
    ? `\n### Writing Samples\n${voice.writingSamples.map((sample) => `- ${sample}`).join("\n")}`
    : "";

  return `## ${voice.displayName} Brand Voice Guidelines

You are writing blog content for ${voice.displayName} (${voice.websiteUrl}).

### Brand Positioning
${voice.positioning}

### Brand Description
${voice.shortDescription}

### Key Facts to Weave In Naturally
${formatList(voice.keyMessaging)}

### Voice & Tone
${formatList(voice.traits)}

### Required Terms and Claims
${formatList([...voice.requiredTerms, ...voice.requiredClaims])}

### Claims and Phrases to Avoid
${formatList([...voice.forbiddenClaims, ...voice.bannedPhrases.map((phrase) => `Never use "${phrase}"`)])}

### Writing Rules
- Target ${voice.targetWordCount.min}-${voice.targetWordCount.max} words per post
- Do not use em dashes or en dashes. Use commas, periods, semicolons, or colons instead.
- Use invitational CTAs like: ${voice.preferredCTAs.slice(0, 3).map((cta) => `"${cta}"`).join(", ")}
- Open with a relatable scenario that makes readers feel understood
- Weave product mentions naturally as solutions to problems discussed in the content
- Include specific tech specs, model numbers, materials, and compatibility when referencing products
- Present multiple product options so readers feel informed, not pressured${writingSamples}`;
}

export function buildPlannerPrompt(
  industryContext: string,
  productContext: string,
  profile?: BrandVoiceInput | null,
): string {
  const voice = resolveBrandVoice(profile);

  return `You are the Blog Planner for ${voice.displayName}. Create a detailed JSON outline for a blog post.

${buildBrandVoicePrompt(profile)}

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

export function buildSectionWriterPrompt(
  sectionPlan: { title: string; description: string; keywords: string[]; productMentions: string[] },
  industryContext: string,
  productDetails: string,
  profile?: BrandVoiceInput | null,
): string {
  const voice = resolveBrandVoice(profile);
  const productUrlExample = voice.productUrlPattern.replace("{handle}", "product-handle");

  return `You are the Section Writer for ${voice.displayName}. Write one blog section in markdown.

${buildBrandVoicePrompt(profile)}

### Section Plan
- **Heading**: ${sectionPlan.title}
- **Purpose**: ${sectionPlan.description}
- **Keywords to include**: ${sectionPlan.keywords.join(", ")}
- **Products to mention**: ${sectionPlan.productMentions.join(", ") || "None specifically; use general context only"}

### Industry Context
${industryContext}

### Product Details
${productDetails}

### Instructions
- Write only this section, including the provided H2 heading and body paragraphs
- Integrate keywords naturally without stuffing them
- If products are listed, work them into the narrative as solutions
- When mentioning a specific product, link to it using markdown: [Product Name](${productUrlExample})
- Match the ${voice.displayName} brand voice exactly`;
}

export function buildStitcherPrompt(profile?: BrandVoiceInput | null): string {
  const voice = resolveBrandVoice(profile);

  return `You are the Blog Stitcher for ${voice.displayName}. Combine individually written sections into a cohesive blog post.

${buildBrandVoicePrompt(profile)}

### Your Tasks
1. Add a compelling introduction that sets context with a relatable scenario
2. Smooth transitions between sections
3. Ensure consistent voice throughout so the post reads as one cohesive piece
4. Add a conclusion with an invitational CTA
5. Verify keyword placement feels natural
6. Ensure the final word count is ${voice.targetWordCount.min}-${voice.targetWordCount.max} words
7. Add an FAQ section at the end, before the conclusion CTA, with 4-6 questions and answers that target common search queries related to the post's topic. Format as:

## Frequently Asked Questions

**Q: Question here?**

A: Answer here in 2-3 sentences.

The FAQ questions should be the kind of things people search for on Google and ask AI assistants. Make answers concise but genuinely helpful.

### Output
Return the complete blog post in markdown format.`;
}

export function buildVerifierPrompt(
  profile?: BrandVoiceInput | null,
  productFacts = "No product catalog facts were provided.",
  qualityGate = 80,
): string {
  const voice = resolveBrandVoice(profile);

  return `You are the Blog Verifier for ${voice.displayName}. Score a completed blog post on quality dimensions.

${buildBrandVoicePrompt(profile)}

### Product Catalog Facts (ground truth - verify all product claims against this)
${productFacts}

Any product name, price, spec, or URL in the post that contradicts or does not appear in this catalog must be listed in "issues" with the exact incorrect claim.

### Scoring Criteria (0-100 each)

**brandConsistency**: Does the post match ${voice.displayName}'s voice? Check for:
- Conversational expertise tone
- Education-first approach
- Natural product mentions
- Invitational, not pushy, CTAs
- No banned phrases

**seoOptimization**: Is the post well optimized? Check for:
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
- No generic AI-sounding patterns

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

The post passes the quality gate if overallScore >= ${qualityGate}.`;
}
