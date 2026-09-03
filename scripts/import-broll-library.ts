import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { applyExternalBrollLabel, getPhotos, importFromDirectory } from "../server/photoBank";
import { parseBrollLabel } from "../server/brollLabelContract";
import { DEFAULT_COMPANY_ID } from "../server/companyDefaults";
import { companies } from "../shared/schema";

const apply = process.argv.includes("--apply");
const sourceRoot = resolve(process.env.IBOLT_BROLL_SOURCE_DIR || "assets/broll/source");
const labelsPath = resolve(process.env.IBOLT_BROLL_LABELS_INDEX || "assets/broll/labels-index.json");
const companyId = process.env.IBOLT_BROLL_COMPANY_ID || DEFAULT_COMPANY_ID;

const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).limit(1);
if (!company) throw new Error(`Company not found: ${companyId}`);

const labelFile = JSON.parse(await readFile(labelsPath, "utf8"));
const labels = labelFile.labels.map(parseBrollLabel);

if (!apply) {
  console.log(JSON.stringify({
    dryRun: true,
    sourceRoot,
    labelsPath,
    labels: labels.length,
    note: "Re-run with --apply to import source images as needs_review and attach hash-verified labels. This does not approve assets or change blogs/Shopify.",
  }, null, 2));
  process.exit(0);
}

const importResult = await importFromDirectory(sourceRoot, console.log, companyId);
const labelsByHash = new Map(labels.map((label: ReturnType<typeof parseBrollLabel>) => [label.sha256, label]));
const photos = await getPhotos(undefined, companyId);
let labeled = 0;
let unmatched = 0;

for (const photo of photos.filter((candidate) => candidate.sourceType === "directory" && candidate.sourceUrl?.startsWith("directory:"))) {
  const buffer = await readFile(photo.filePath);
  const hash = createHash("sha256").update(buffer).digest("hex");
  const label = labelsByHash.get(hash);
  if (!label) {
    unmatched += 1;
    continue;
  }
  await applyExternalBrollLabel(photo.id, label, companyId);
  labeled += 1;
}

console.log(JSON.stringify({
  imported: importResult.imported,
  skipped: importResult.skipped,
  labeled,
  unmatched,
  assetStatus: "needs_review",
  rightsStatus: "unknown",
}, null, 2));
