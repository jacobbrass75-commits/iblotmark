import { readFile, readdir, stat } from "fs/promises";
import { basename, join } from "path";
import Database from "better-sqlite3";
import { lintContent } from "../server/contentLinter";
import { DEFAULT_COMPANY_ID } from "../server/companyDefaults";

const seriesDir = join(
  process.cwd(),
  "content-output",
  "forklift-mount-history-series-2026-08-25",
);

interface DraftMeta {
  title: string;
  slug: string;
  metaTitle: string;
  metaDescription: string;
  primaryKeyword: string;
  heroAsset: string;
  contentAction: string;
  targetUrl?: string;
}

function parseDraft(filename: string, raw: string): { meta: DraftMeta; markdown: string } {
  const frontmatter = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontmatter) throw new Error(`${filename}: missing frontmatter`);

  const values: Record<string, string> = {};
  for (const line of frontmatter[1].split("\n")) {
    const splitAt = line.indexOf(":");
    if (splitAt < 0) continue;
    values[line.slice(0, splitAt).trim()] = line.slice(splitAt + 1).trim();
  }

  const required = [
    "title",
    "slug",
    "metaTitle",
    "metaDescription",
    "primaryKeyword",
    "heroAsset",
    "contentAction",
  ];
  for (const key of required) {
    if (!values[key]) throw new Error(`${filename}: missing ${key}`);
  }
  if (values.contentAction === "REFRESH" && !values.targetUrl) {
    throw new Error(`${filename}: refresh drafts require targetUrl`);
  }

  return {
    meta: values as unknown as DraftMeta,
    markdown: raw.slice(frontmatter[0].length).trim(),
  };
}

async function main() {
  const databasePath = process.env.DATABASE_PATH || join(process.cwd(), "data", "standalone-blog-writer.db");
  const sqlite = new Database(databasePath, { readonly: true });
  const catalog = sqlite.prepare(
    "SELECT title, handle, price FROM products WHERE company_id = ?",
  ).all(DEFAULT_COMPANY_ID) as Array<{ title: string; handle: string; price: string | null }>;
  sqlite.close();

  const lintCatalog = catalog.map((product) => ({
    title: product.title,
    handle: product.handle,
    price: product.price ? Number(product.price) : null,
  }));

  // The live 38mm Dock'n Lock handle contains an encoded trademark symbol.
  // contentLinter intentionally recognizes ASCII handles, so add the visible prefix.
  lintCatalog.push({
    title: "Encoded trademark handle alias",
    handle: "ibolt-dock-n-lock-bizmount",
    price: null,
  });

  const filenames = (await readdir(seriesDir))
    .filter((filename) => /^0\d-.*\.md$/.test(filename))
    .sort();
  if (filenames.length !== 3) throw new Error(`Expected 3 article drafts, found ${filenames.length}`);

  const results = [];
  for (const filename of filenames) {
    const raw = await readFile(join(seriesDir, filename), "utf8");
    const draft = parseDraft(filename, raw);
    const heroPath = join(seriesDir, draft.meta.heroAsset);
    const heroStat = await stat(heroPath);
    if (!heroStat.isFile() || heroStat.size === 0) throw new Error(`${filename}: missing hero asset`);

    const report = lintContent({
      markdown: draft.markdown,
      title: draft.meta.title,
      metaTitle: draft.meta.metaTitle,
      metaDescription: draft.meta.metaDescription,
      primaryKeyword: draft.meta.primaryKeyword,
      products: lintCatalog,
    });

    const productPhotoCount = (draft.markdown.match(/cdn\.shopify\.com[^"')\s]+/g) || []).length;
    if (productPhotoCount < 2 || productPhotoCount > 4) {
      throw new Error(`${filename}: expected 2 to 4 official product photos, found ${productPhotoCount}`);
    }
    if (!report.passed || report.warnings.length > 0) {
      throw new Error(`${filename}: ${JSON.stringify(report)}`);
    }

    results.push({
      filename,
      title: draft.meta.title,
      slug: draft.meta.slug,
      action: draft.meta.contentAction,
      targetUrl: draft.meta.targetUrl || null,
      hero: basename(heroPath),
      heroBytes: heroStat.size,
      productPhotoCount,
      lint: report,
    });
  }

  console.log(JSON.stringify({ ok: true, articles: results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
