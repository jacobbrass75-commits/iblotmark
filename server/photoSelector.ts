// Photo Selector — Deterministic scoring to pick the best photos for blog posts
// No AI call needed — uses pre-analyzed photo metadata to score and rank.

import { db } from "./db";
import { and, eq, isNotNull } from "drizzle-orm";
import {
  productPhotos,
  blogPostPhotos,
  type ProductPhoto,
} from "@shared/schema";
import type { BlogPlan, BlogPlanSection } from "./blogPipeline";
import { parseBrollLabel, scoreBrollLabelForText } from "./brollLabelContract";

export interface PhotoSelection {
  photoId: string;
  sectionIndex: number;
  placement: "hero" | "inline" | "product-spotlight";
  altText: string;
  score: number;
  photoPath: string;
  thumbnailPath: string | null;
}

export interface PostPhotoSelectionInput {
  photoId: string;
  sectionIndex?: number | null;
  placement?: "hero" | "inline" | "product-spotlight";
  altText?: string | null;
  caption?: string | null;
  selectionReason?: string | null;
}

function isManuallyUsablePhoto(photo: ProductPhoto): boolean {
  return photo.assetStatus !== "archived" && photo.rightsStatus !== "restricted";
}

function isAutomaticallyUsablePhoto(photo: ProductPhoto): boolean {
  return isManuallyUsablePhoto(photo) && photo.assetStatus === "approved";
}

function imageMarkdown(photoId: string, altText: string, companyId?: string): string {
  const query = companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";
  return `![${altText}](/api/public/blog/photos/serve/${photoId}${query})`;
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
  if (photo.assetStatus === "approved") score += 0.75;

  // +0.5 for hero candidates
  if (photo.isHero) score += 0.5;

  if (photo.aiAnalysis) {
    try {
      const label = parseBrollLabel(photo.aiAnalysis);
      score += scoreBrollLabelForText(label, [
        section.title,
        ...(section.keywords || []),
        ...(section.productMentions || []),
      ]);
      if (!label.cropSuitability.inline) score -= 2;
    } catch {
      // Legacy photo analysis remains valid; richer scoring is optional.
    }
  }

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
  companyId: string,
  brandName: string,
): Promise<PhotoSelection[]> {
  // Get all analyzed photos for the relevant products
  let candidatePhotos: ProductPhoto[] = [];

  if (productIds.length > 0) {
    // Get photos for specific products
    const allPhotos = await db.select().from(productPhotos)
      .where(and(eq(productPhotos.companyId, companyId), isNotNull(productPhotos.analyzedAt)));
    candidatePhotos = allPhotos.filter((p) =>
      isAutomaticallyUsablePhoto(p) && p.productId && productIds.includes(p.productId)
    );
  }

  // If not enough product-specific photos, include all analyzed photos
  if (candidatePhotos.length < plan.sections.length) {
    const allAnalyzedPhotos = await db.select().from(productPhotos)
      .where(and(eq(productPhotos.companyId, companyId), isNotNull(productPhotos.analyzedAt)));
    candidatePhotos = allAnalyzedPhotos.filter(isAutomaticallyUsablePhoto);
  }

  if (candidatePhotos.length === 0) return [];

  const selections: PhotoSelection[] = [];
  const alreadySelected = new Set<string>();

  // Select hero photo (best overall quality + in-use)
  const heroScored = candidatePhotos
    .map((p) => {
      let score = (p.qualityScore || 0) + (p.isHero ? 2 : 0) + (p.contextType === "in-use" ? 1 : 0);
      if (verticalSlug && p.verticalRelevance) {
        const relevance = p.verticalRelevance as string[];
        if (relevance.includes(verticalSlug)) score += 3;
      }
      if (p.aiAnalysis) {
        try {
          const label = parseBrollLabel(p.aiAnalysis);
          if (!label.cropSuitability.hero) score -= 3;
          if (label.needsReview || label.reviewFlags.length > 0) score -= 2;
        } catch {
          // Legacy analysis does not have crop metadata.
        }
      }
      return { photo: p, score };
    })
    .sort((a, b) => b.score - a.score);

  if (heroScored.length > 0) {
    const hero = heroScored[0].photo;
    selections.push({
      photoId: hero.id,
      sectionIndex: -1, // -1 = hero
      placement: "hero",
      altText: hero.altText || `${hero.settingDescription || hero.originalFilename} - ${brandName}`,
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
        altText: pick.altText || `${pick.settingDescription || section.title} - ${brandName}`,
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
  companyId: string,
): Promise<void> {
  for (const sel of selections) {
    await db.insert(blogPostPhotos).values({
      companyId,
      blogPostId,
      photoId: sel.photoId,
      sectionIndex: sel.sectionIndex >= 0 ? sel.sectionIndex : null,
      placement: sel.placement,
      altText: sel.altText,
      selectionReason: `Score: ${sel.score.toFixed(1)}`,
    });
  }
}

export async function listPostPhotoSelections(blogPostId: string, companyId: string) {
  return db
    .select({
      selection: blogPostPhotos,
      photo: productPhotos,
    })
    .from(blogPostPhotos)
    .innerJoin(productPhotos, eq(blogPostPhotos.photoId, productPhotos.id))
    .where(and(
      eq(blogPostPhotos.companyId, companyId),
      eq(blogPostPhotos.blogPostId, blogPostId),
      eq(productPhotos.companyId, companyId),
    ));
}

export async function addPostPhotoSelection(
  blogPostId: string,
  input: PostPhotoSelectionInput,
  companyId: string,
) {
  const [photo] = await db
    .select()
    .from(productPhotos)
    .where(and(eq(productPhotos.companyId, companyId), eq(productPhotos.id, input.photoId)))
    .limit(1);
  if (!photo) throw new Error("Photo not found for this company");
  if (!isManuallyUsablePhoto(photo)) throw new Error("Restricted or archived assets cannot be selected for posts");

  const [selection] = await db.insert(blogPostPhotos).values({
    companyId,
    blogPostId,
    photoId: input.photoId,
    sectionIndex: input.sectionIndex ?? null,
    placement: input.placement || "inline",
    altText: input.altText?.trim() || photo.altText || photo.settingDescription || photo.originalFilename,
    caption: input.caption?.trim() || photo.caption || null,
    selectionReason: input.selectionReason?.trim() || "Manual review selection",
  }).returning();

  return selection;
}

export async function updatePostPhotoSelection(
  id: string,
  blogPostId: string,
  updates: Partial<PostPhotoSelectionInput>,
  companyId: string,
) {
  const values: Partial<typeof blogPostPhotos.$inferInsert> = {};
  if (updates.sectionIndex !== undefined) values.sectionIndex = updates.sectionIndex;
  if (updates.placement !== undefined) values.placement = updates.placement;
  if (updates.altText !== undefined) values.altText = updates.altText?.trim() || null;
  if (updates.caption !== undefined) values.caption = updates.caption?.trim() || null;
  if (updates.selectionReason !== undefined) values.selectionReason = updates.selectionReason?.trim() || null;

  const [selection] = await db
    .update(blogPostPhotos)
    .set(values)
    .where(and(
      eq(blogPostPhotos.companyId, companyId),
      eq(blogPostPhotos.blogPostId, blogPostId),
      eq(blogPostPhotos.id, id),
    ))
    .returning();

  return selection;
}

export async function deletePostPhotoSelection(id: string, blogPostId: string, companyId: string): Promise<void> {
  await db.delete(blogPostPhotos).where(and(
    eq(blogPostPhotos.companyId, companyId),
    eq(blogPostPhotos.blogPostId, blogPostId),
    eq(blogPostPhotos.id, id),
  ));
}

/**
 * Format photo selections as markdown image references for the stitcher.
 */
export function formatPhotoPlacementsForPrompt(selections: PhotoSelection[], companyId?: string): string {
  if (selections.length === 0) return "";

  const lines: string[] = ["### Image Placements"];
  const hero = selections.find((s) => s.placement === "hero");
  if (hero) {
    lines.push(`Hero image (place after title): ${imageMarkdown(hero.photoId, hero.altText, companyId)}`);
  }

  const sectionPhotos = selections.filter((s) => s.placement !== "hero").sort((a, b) => a.sectionIndex - b.sectionIndex);
  for (const photo of sectionPhotos) {
    lines.push(`After section ${photo.sectionIndex + 1}: ${imageMarkdown(photo.photoId, photo.altText, companyId)}`);
  }

  return lines.join("\n");
}
