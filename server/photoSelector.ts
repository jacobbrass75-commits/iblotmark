// Photo Selector — Deterministic scoring to pick the best photos for blog posts
// No AI call needed — uses pre-analyzed photo metadata to score and rank.

import { db } from "./db";
import { eq, isNotNull } from "drizzle-orm";
import {
  productPhotos,
  blogPostPhotos,
  type ProductPhoto,
  type BlogPost,
} from "@shared/schema";
import type { BlogPlan, BlogPlanSection } from "./blogPipeline";

export interface PhotoSelection {
  photoId: string;
  sectionIndex: number;
  placement: "hero" | "inline" | "product-spotlight";
  altText: string;
  score: number;
  photoPath: string;
  thumbnailPath: string | null;
}

/**
 * Score a photo's relevance for a specific blog section context.
 */
function scorePhoto(
  photo: ProductPhoto,
  section: BlogPlanSection,
  verticalSlug: string | null,
  alreadySelected: Set<string>,
): number {
  let score = 0;

  // +3 if the photo's product is mentioned in this section
  if (section.productMentions?.length > 0) {
    // Check if photo filename or product association matches any mentioned product
    const mentionLower = section.productMentions.map((m) => m.toLowerCase());
    const photoNameLower = photo.originalFilename.toLowerCase();
    for (const mention of mentionLower) {
      if (photoNameLower.includes(mention.replace(/-/g, " ").slice(0, 15))) {
        score += 3;
        break;
      }
    }
  }

  // +2 if context type matches the section's nature
  if (photo.contextType === "in-use") score += 2; // In-use photos are always preferred for blogs
  if (photo.contextType === "lifestyle") score += 1.5;
  if (photo.contextType === "studio") score += 0.5;

  // +2 if vertical relevance matches
  if (verticalSlug && photo.verticalRelevance) {
    const relevance = photo.verticalRelevance as string[];
    if (relevance.includes(verticalSlug)) score += 2;
  }

  // +0-1 for quality
  if (photo.qualityScore) score += photo.qualityScore;

  // +0.5 for hero candidates
  if (photo.isHero) score += 0.5;

  // -2 diversity penalty if already selected for another section
  if (alreadySelected.has(photo.id)) score -= 2;

  return score;
}

/**
 * Select the best photos for a blog post plan.
 * Returns one photo per section + a hero photo.
 */
export async function selectPhotosForPost(
  plan: BlogPlan,
  verticalId: string | null,
  productIds: string[],
  verticalSlug: string | null,
): Promise<PhotoSelection[]> {
  // Get all analyzed photos for the relevant products
  let candidatePhotos: ProductPhoto[] = [];

  if (productIds.length > 0) {
    // Get photos for specific products
    const allPhotos = await db.select().from(productPhotos)
      .where(isNotNull(productPhotos.analyzedAt));
    candidatePhotos = allPhotos.filter((p) =>
      p.productId && productIds.includes(p.productId)
    );
  }

  // If not enough product-specific photos, include all analyzed photos
  if (candidatePhotos.length < plan.sections.length) {
    candidatePhotos = await db.select().from(productPhotos)
      .where(isNotNull(productPhotos.analyzedAt));
  }

  if (candidatePhotos.length === 0) return [];

  const selections: PhotoSelection[] = [];
  const alreadySelected = new Set<string>();

  // Select hero photo (best overall quality + in-use)
  const heroScored = candidatePhotos
    .map((p) => ({ photo: p, score: (p.qualityScore || 0) + (p.isHero ? 2 : 0) + (p.contextType === "in-use" ? 1 : 0) }))
    .sort((a, b) => b.score - a.score);

  if (heroScored.length > 0) {
    const hero = heroScored[0].photo;
    selections.push({
      photoId: hero.id,
      sectionIndex: -1, // -1 = hero
      placement: "hero",
      altText: `${hero.settingDescription || hero.originalFilename} - iBolt Mounts`,
      score: heroScored[0].score,
      photoPath: hero.filePath,
      thumbnailPath: hero.thumbnailPath,
    });
    alreadySelected.add(hero.id);
  }

  // Select best photo per section
  for (let i = 0; i < plan.sections.length; i++) {
    const section = plan.sections[i];

    const scored = candidatePhotos
      .map((p) => ({ photo: p, score: scorePhoto(p, section, verticalSlug, alreadySelected) }))
      .sort((a, b) => b.score - a.score);

    if (scored.length > 0 && scored[0].score > 0) {
      const pick = scored[0].photo;
      selections.push({
        photoId: pick.id,
        sectionIndex: i,
        placement: "inline",
        altText: `${pick.settingDescription || section.title} - iBolt Mounts`,
        score: scored[0].score,
        photoPath: pick.filePath,
        thumbnailPath: pick.thumbnailPath,
      });
      alreadySelected.add(pick.id);
    }
  }

  return selections;
}

/**
 * Save photo selections to the blog_post_photos table.
 */
export async function savePhotoSelections(
  blogPostId: string,
  selections: PhotoSelection[],
): Promise<void> {
  for (const sel of selections) {
    await db.insert(blogPostPhotos).values({
      blogPostId,
      photoId: sel.photoId,
      sectionIndex: sel.sectionIndex >= 0 ? sel.sectionIndex : null,
      placement: sel.placement,
      altText: sel.altText,
      selectionReason: `Score: ${sel.score.toFixed(1)}`,
    });
  }
}

/**
 * Format photo selections as markdown image references for the stitcher.
 */
export function formatPhotoPlacementsForPrompt(selections: PhotoSelection[]): string {
  if (selections.length === 0) return "";

  const lines: string[] = ["### Image Placements"];
  const hero = selections.find((s) => s.placement === "hero");
  if (hero) {
    lines.push(`Hero image (place after title): ![${hero.altText}](/api/blog/photos/serve/${hero.photoId})`);
  }

  const sectionPhotos = selections.filter((s) => s.placement !== "hero").sort((a, b) => a.sectionIndex - b.sectionIndex);
  for (const photo of sectionPhotos) {
    lines.push(`After section ${photo.sectionIndex + 1}: ![${photo.altText}](/api/blog/photos/serve/${photo.photoId})`);
  }

  return lines.join("\n");
}
