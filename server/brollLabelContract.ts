import { z } from "zod";

const uniqueStrings = z.array(z.string().trim().min(1)).transform((items) => Array.from(new Set(items)));

export const brollLabelSchema = z.object({
  contractVersion: z.literal("broll.v1"),
  assetId: z.string().trim().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  altText: z.string().trim().min(8).max(180),
  caption: z.string().trim().min(8).max(240),
  scene: z.string().trim().min(3).max(300),
  contextType: z.enum(["studio", "in-use", "lifestyle", "packaging", "technical"]),
  angleType: z.enum(["front", "back", "side", "top", "detail", "full", "in-use"]),
  orientation: z.enum(["landscape", "portrait", "square"]),
  verticals: uniqueStrings,
  useCases: uniqueStrings,
  devices: uniqueStrings,
  mountingSurfaces: uniqueStrings,
  blogTopics: uniqueStrings,
  keywords: uniqueStrings,
  productCandidates: z.array(z.object({
    name: z.string().trim().min(1),
    confidence: z.number().min(0).max(1),
    evidence: z.string().trim().min(1).max(240),
  }).strict()),
  cropSuitability: z.object({
    hero: z.boolean(),
    inline: z.boolean(),
    social: z.boolean(),
    notes: z.string().max(240),
  }).strict(),
  quality: z.object({
    score: z.number().min(0).max(1),
    sharp: z.boolean(),
    wellLit: z.boolean(),
    usableComposition: z.boolean(),
  }).strict(),
  reviewFlags: uniqueStrings,
  confidence: z.number().min(0).max(1),
  needsReview: z.boolean(),
}).strict();

export type BrollLabel = z.infer<typeof brollLabelSchema>;

export function parseBrollLabel(value: unknown): BrollLabel {
  return brollLabelSchema.parse(value);
}

function tokens(values: string[]): Set<string> {
  return new Set(values.join(" ").toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4));
}

export function scoreBrollLabelForText(label: BrollLabel, values: string[]): number {
  const query = tokens(values);
  const metadata = tokens([
    label.scene,
    label.caption,
    ...label.verticals,
    ...label.useCases,
    ...label.devices,
    ...label.mountingSurfaces,
    ...label.blogTopics,
    ...label.keywords,
    ...label.productCandidates.map((candidate) => candidate.name),
  ]);
  let overlaps = 0;
  for (const token of Array.from(query)) if (metadata.has(token)) overlaps += 1;
  const relevance = Math.min(2.5, overlaps * 0.35);
  const reviewPenalty = label.needsReview || label.reviewFlags.length > 0 ? 1.5 : 0;
  return relevance - reviewPenalty;
}
