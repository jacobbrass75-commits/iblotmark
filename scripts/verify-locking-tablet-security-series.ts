import "dotenv/config";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Database from "better-sqlite3";
import { lintContent } from "../server/contentLinter";
import { getCompanyContext } from "../server/companyContext";
import { runVerifier, type BlogPlan, type VerificationResult } from "../server/blogPipeline";
import { DEFAULT_COMPANY_ID } from "../server/companyDefaults";

const SERIES_DIR = join(process.cwd(), "content-output", "ibolt-locking-tablet-security-series-2026-08-26");
const REPORT_PATH = join(SERIES_DIR, "shopify-review", "verifier-report.json");
const COMPANY_ID = DEFAULT_COMPANY_ID;

interface Draft {
  filename: string;
  title: string;
  slug: string;
  metaTitle: string;
  metaDescription: string;
  primaryKeyword: string;
  markdown: string;
}

function parseDraft(filename: string, raw: string): Draft {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error(`${filename} is missing frontmatter`);
  const values: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const splitAt = line.indexOf(":");
    if (splitAt < 0) continue;
    values[line.slice(0, splitAt).trim()] = line.slice(splitAt + 1).trim();
  }
  for (const key of ["title", "slug", "metaTitle", "metaDescription", "primaryKeyword"]) {
    if (!values[key]) throw new Error(`${filename} is missing ${key}`);
  }
  return {
    filename,
    title: values.title,
    slug: values.slug,
    metaTitle: values.metaTitle,
    metaDescription: values.metaDescription,
    primaryKeyword: values.primaryKeyword,
    markdown: raw.slice(match[0].length).trim(),
  };
}

function planFor(draft: Draft): BlogPlan {
  const sectionTitles = Array.from(draft.markdown.matchAll(/^##\s+(.+)$/gm), (match) => match[1].trim());
  return {
    title: draft.title,
    metaTitle: draft.metaTitle,
    metaDescription: draft.metaDescription,
    slug: draft.slug,
    primaryKeyword: draft.primaryKeyword,
    secondaryKeywords: [
      "keyed tablet holder",
      "tamper-resistant tablet mount",
      "tablet theft deterrence",
      "device custody",
    ],
    estimatedWordCount: 1000,
    sections: sectionTitles.map((title) => ({
      title,
      description: `Source-backed section for ${draft.title}`,
      keywords: [draft.primaryKeyword],
      productMentions: [],
      targetWords: 180,
    })),
  };
}

const productFacts = `
Claim boundary: locking hardware can deter quick or unauthorized removal and support device custody. It is not theft-proof and cannot guarantee prevention. It does not replace mobile device management, passcodes, asset records, cameras, key control, or local installation approval.

Current official product facts checked 2026-08-26:
- IBRT-34719 Dock'n Lock POS Tablet Stand: $99.95, 7 to 10 inch tablets, keyed holder, weighted L-bracket with four bolt-down holes, 3.75 inch arm, 25 mm B Size connections.
- IBRT-34717 LockPro Drill Base POS Stand: $139.95, aluminum locking holder, 7 to 10 inch tablets, adjustable pole, drill-down base, 360 degree positioning.
- IBBZ-33993 Dock'n Lock Bizmount AMPS: $49.95, keyed composite holder, 3.75 inch arm, dual 25 mm balls, four-hole AMPS base, hex-key security hardware. Current title says 7 to 10 inches and description says 7 to 11, so fit must be verified.
- IBBZ-33779 LockPro Metal Drill Base Mount: $99.95, metal locking holder, 7 to 11 inch tablets, dual 25 mm balls, four-hole AMPS base and backer plate.
- IBBZ-33971 LockPro FlexPro Seat Rail Mount: $159.95, metal holder for 7 to 10 inch tablets and an 18 inch aluminum gooseneck.
- IBFL-34591 Dock'n Lock Forklift 38mm Mount: $110.00, 7 to 10 inch holder, 3.75 inch 38 mm arm, two 4 by 2.75 by 0.125 inch steel plates and 3/8-16 by 4 inch bolts.
- IBFL-34530 Dock'n Lock Forklift 25mm Mount: $93.95, 7 to 10 inch holder, steel pillar plates, key and security hardware.
- IBBZ-33934 LockPro 38mm AMPS Metal Mount: $119.95, metal locking holder for 7 to 10 inch tablets.
- FMCSA: a portable ELD used in a covered commercial motor vehicle must be mounted in a fixed position during operation and visible to the driver from the normal seated position. A mount alone does not establish compliance.
`;

async function main() {
  const filenames = (await readdir(SERIES_DIR)).filter((name) => /^0[1-5]-.*\.md$/.test(name)).sort();
  if (filenames.length !== 5) throw new Error(`Expected 5 drafts, found ${filenames.length}`);
  const drafts = await Promise.all(filenames.map(async (filename) => parseDraft(filename, await readFile(join(SERIES_DIR, filename), "utf8"))));

  const sqlite = new Database(join(process.cwd(), "data", "standalone-blog-writer.db"), { readonly: true });
  const catalog = sqlite.prepare(`
    SELECT title, handle, CAST(price AS REAL) AS price
    FROM products
    WHERE company_id = ?
  `).all(COMPANY_ID) as Array<{ title: string; handle: string; price: number | null }>;
  sqlite.close();

  const companyContext = await getCompanyContext(COMPANY_ID);
  const results: Array<{
    filename: string;
    slug: string;
    lint: ReturnType<typeof lintContent>;
    verification: VerificationResult;
    generation: Array<Record<string, unknown>>;
  }> = [];

  for (const draft of drafts) {
    const lint = lintContent({
      markdown: draft.markdown,
      title: draft.title,
      metaTitle: draft.metaTitle,
      metaDescription: draft.metaDescription,
      primaryKeyword: draft.primaryKeyword,
      products: catalog,
    });
    if (!lint.passed || lint.warnings.length > 0) {
      throw new Error(`Deterministic lint failed for ${draft.filename}: ${JSON.stringify(lint)}`);
    }

    const generation: Array<Record<string, unknown>> = [];
    const verification = await runVerifier(
      planFor(draft),
      draft.markdown,
      productFacts,
      companyContext.brandProfile,
      (metadata) => generation.push(metadata as unknown as Record<string, unknown>),
    );
    results.push({ filename: draft.filename, slug: draft.slug, lint, verification, generation });
    console.log(`${draft.slug}: ${verification.overallScore}/100 ${verification.passesQualityGate ? "PASS" : "FAIL"}`);
  }

  await mkdir(join(SERIES_DIR, "shopify-review"), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    companyId: COMPANY_ID,
    qualityGate: 80,
    passed: results.every((result) => result.lint.passed && result.verification.passesQualityGate),
    results,
  }, null, 2)}\n`, "utf8");
  console.log(`Wrote ${REPORT_PATH}`);

  const failed = results.filter((result) => !result.verification.passesQualityGate);
  if (failed.length > 0) {
    throw new Error(`Verifier failed ${failed.length} article(s): ${failed.map((item) => item.slug).join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
