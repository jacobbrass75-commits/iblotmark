import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../server/db";
import { parseBrollLabel, scoreBrollLabelForText } from "../server/brollLabelContract";
import { blogPostPhotos, blogPosts } from "../shared/schema";

const labelsPath = resolve(process.env.IBOLT_BROLL_LABELS_INDEX || "assets/broll/labels-index.json");
const catalogPath = resolve(process.env.IBOLT_BROLL_CATALOG || "assets/broll/catalog.json");
const outputDir = resolve(process.env.IBOLT_BROLL_RETROFIT_OUTPUT || "content-output/broll-retrofit-latest");
const minimumScore = Number(process.env.IBOLT_BROLL_RETROFIT_MIN_SCORE || 0.7);
const maxPerPost = Math.max(1, Number(process.env.IBOLT_BROLL_RETROFIT_MAX_PER_POST || 3));

const [labelsFile, catalogFile, posts, existingSelections] = await Promise.all([
  readFile(labelsPath, "utf8").then(JSON.parse),
  readFile(catalogPath, "utf8").then(JSON.parse),
  db.select().from(blogPosts),
  db.select().from(blogPostPhotos),
]);

const catalogByHash = new Map(catalogFile.assets.map((asset: any) => [asset.sha256, asset]));
const postsWithSelections = new Set(existingSelections.map((selection) => selection.blogPostId));
const labels = labelsFile.labels.map(parseBrollLabel).filter((label: ReturnType<typeof parseBrollLabel>) =>
  !label.needsReview &&
  label.reviewFlags.length === 0 &&
  label.quality.score >= 0.65 &&
  label.cropSuitability.inline
);

const proposals = posts.map((post) => {
  const context = [post.title, post.metaTitle || "", post.metaDescription || "", post.markdown.slice(0, 12000)];
  const candidates = labels
    .map((label: ReturnType<typeof parseBrollLabel>) => ({
      label,
      asset: catalogByHash.get(label.sha256) || null,
      score: scoreBrollLabelForText(label, context),
    }))
    .filter((candidate: any) => candidate.asset && candidate.score >= minimumScore)
    .sort((a: any, b: any) => b.score - a.score || b.label.quality.score - a.label.quality.score)
    .slice(0, maxPerPost)
    .map((candidate: any) => ({
      assetId: candidate.label.assetId,
      sha256: candidate.label.sha256,
      score: Number(candidate.score.toFixed(2)),
      sourcePath: candidate.asset.sourcePath,
      localPath: candidate.asset.localPath,
      altText: candidate.label.altText,
      caption: candidate.label.caption,
      suggestedPlacement: candidate.label.cropSuitability.hero ? "hero-or-inline" : "inline",
      matchingTopics: candidate.label.blogTopics,
      matchingKeywords: candidate.label.keywords,
    }));
  return {
    blogPostId: post.id,
    title: post.title,
    slug: post.slug,
    status: post.status,
    alreadyHasPhotoSelection: postsWithSelections.has(post.id),
    candidates,
  };
}).filter((proposal) => proposal.candidates.length > 0);

const report = {
  generatedAt: new Date().toISOString(),
  dryRun: true,
  note: "Candidate report only. No blog, Shopify, or database records were changed.",
  inputs: { labelsPath, catalogPath, minimumScore, maxPerPost },
  summary: {
    blogPostsScanned: posts.length,
    approvedLabelsConsidered: labels.length,
    postsWithCandidates: proposals.length,
    postsAlreadyWithSelections: proposals.filter((proposal) => proposal.alreadyHasPhotoSelection).length,
  },
  proposals,
};

await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, "retrofit-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(resolve(outputDir, "README.md"), `# iBOLT B-roll retrofit candidates\n\nGenerated ${report.generatedAt}. This is a read-only proposal. It did not change local posts or Shopify.\n\n- Posts scanned: ${report.summary.blogPostsScanned}\n- Approved labels considered: ${report.summary.approvedLabelsConsidered}\n- Posts with candidates: ${report.summary.postsWithCandidates}\n`, "utf8");

console.log(JSON.stringify(report.summary, null, 2));
