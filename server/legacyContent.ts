import { readdir, readFile, stat } from "fs/promises";
import { join, relative } from "path";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { blogPosts } from "@shared/schema";
import { DEFAULT_COMPANY_ID } from "./companyDefaults";

export interface LegacyContentImportResult {
  scanned: number;
  imported: number;
  skipped: number;
  files: Array<{
    path: string;
    title: string;
    slug: string;
    status: "imported" | "skipped";
  }>;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "legacy-content";
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string, fallback: string): string {
  const commentTitle = html.match(/<!--\s*Blog Post:\s*([\s\S]*?)\s*-->/i)?.[1]
    || html.match(/<!--\s*Collection Page Content for\s*([\s\S]*?)\s*-->/i)?.[1];
  if (commentTitle?.trim()) return commentTitle.trim();

  const heading = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    || html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1];
  if (heading?.trim()) return stripHtml(heading);

  return fallback.replace(/\.html$/i, "").replace(/[-_]+/g, " ");
}

function extractKeywords(html: string): string[] {
  const match = html.match(/<!--\s*(?:Target Keywords|Keywords):\s*([\s\S]*?)\s*-->/i);
  if (!match?.[1]) return [];
  return match[1].split(",").map((value) => value.trim()).filter(Boolean);
}

async function listHtmlFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "reviews") continue;
      files.push(...await listHtmlFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(path);
    }
  }

  return files;
}

export async function importLegacyContentOutput(
  companyId = DEFAULT_COMPANY_ID,
  root = join(process.cwd(), "content-output"),
): Promise<LegacyContentImportResult> {
  try {
    await stat(root);
  } catch {
    return { scanned: 0, imported: 0, skipped: 0, files: [] };
  }

  const htmlFiles = await listHtmlFiles(root);
  const files: LegacyContentImportResult["files"] = [];
  let imported = 0;
  let skipped = 0;

  for (const filePath of htmlFiles) {
    const html = await readFile(filePath, "utf8");
    const sourcePath = relative(process.cwd(), filePath);
    const title = extractTitle(html, filePath.split("/").pop() || "Legacy content");
    const slug = slugify(title);
    const existing = await db
      .select()
      .from(blogPosts)
      .where(and(eq(blogPosts.companyId, companyId), eq(blogPosts.slug, slug)))
      .limit(1);

    if (existing.length > 0) {
      skipped++;
      files.push({ path: sourcePath, title, slug, status: "skipped" });
      continue;
    }

    const text = stripHtml(html);
    const keywords = extractKeywords(html);
    const isCollection = sourcePath.includes("phase1-collection-pages");

    await db.insert(blogPosts).values({
      companyId,
      title,
      slug,
      metaTitle: title.slice(0, 70),
      metaDescription: text.slice(0, 155),
      markdown: text,
      html,
      status: "legacy",
      wordCount: text ? text.split(/\s+/).length : 0,
      verificationNotes: JSON.stringify({
        source: "content-output",
        sourcePath,
        kind: isCollection ? "collection_page" : "blog_post",
        targetKeywords: keywords,
      }),
    });

    imported++;
    files.push({ path: sourcePath, title, slug, status: "imported" });
  }

  return {
    scanned: htmlFiles.length,
    imported,
    skipped,
    files,
  };
}
