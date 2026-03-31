// Catalog Importer — Extract products from PDF catalogs and match to existing products
// Uses pdf-parse for text extraction, Claude for product extraction, 3-tier matching.

import { PDFParse } from "pdf-parse";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { eq } from "drizzle-orm";
import {
  productCatalogImports,
  productCatalogExtractions,
  products,
  type CatalogImport,
  type CatalogExtraction,
  type Product,
} from "@shared/schema";

function getClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// --- PDF Text Extraction ---

export async function extractPdfText(buffer: Buffer): Promise<{ text: string; pages: number }> {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy();
  const text = result.text;
  // Estimate pages from "-- X of Y --" markers in the text
  const pageMatch = text.match(/-- \d+ of (\d+) --/);
  const pages = pageMatch ? parseInt(pageMatch[1]) : Math.ceil(text.length / 3000);
  return { text, pages };
}

// --- AI Product Extraction ---

interface ExtractedProduct {
  name: string;
  description: string;
  pageRef: string;
}

async function extractProductsFromChunk(
  client: Anthropic,
  chunk: string,
  chunkIndex: number,
): Promise<ExtractedProduct[]> {
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [{
      role: "user",
      content: `Extract all distinct products from this product catalog excerpt. For each product, extract:
- name: The full product name (e.g., "iBOLT TabDock Bizmount AMPS w/ Screw in Connection")
- description: A 1-2 sentence summary of what the product does and its key features
- pageRef: The page reference if visible (e.g., "-- 1 of 334 --")

Return ONLY a JSON array. If no products found, return [].

Catalog excerpt:
---
${chunk}
---`,
    }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    return JSON.parse(jsonMatch[0]) as ExtractedProduct[];
  } catch {
    return [];
  }
}

// --- Chunking ---

function chunkCatalogText(text: string, chunkSize = 3000): string[] {
  const chunks: string[] = [];
  // Split on product boundaries ("-- X of Y --")
  const sections = text.split(/(?=-- \d+ of \d+ --)/);

  let current = "";
  for (const section of sections) {
    if (current.length + section.length > chunkSize && current.length > 0) {
      chunks.push(current);
      current = section;
    } else {
      current += section;
    }
  }
  if (current.trim()) chunks.push(current);

  return chunks;
}

// --- Matching ---

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshteinSimilarity(a: string, b: string): number {
  const an = normalizeTitle(a);
  const bn = normalizeTitle(b);
  if (an === bn) return 1;

  // Check if one contains the other
  if (an.includes(bn) || bn.includes(an)) return 0.85;

  // Simple word overlap score
  const aWords = new Set(an.split(" "));
  const bWords = new Set(bn.split(" "));
  const intersection = [...aWords].filter((w) => bWords.has(w) && w.length > 2);
  const union = new Set([...aWords, ...bWords]);
  return intersection.length / union.size;
}

async function matchExtractions(importId: string): Promise<{ matched: number; unmatched: number }> {
  const extractions = await db.select().from(productCatalogExtractions)
    .where(eq(productCatalogExtractions.importId, importId));
  const allProducts = await db.select().from(products);

  let matched = 0;
  let unmatched = 0;

  for (const extraction of extractions) {
    let bestMatch: Product | null = null;
    let bestScore = 0;

    for (const product of allProducts) {
      const score = levenshteinSimilarity(extraction.extractedName, product.title);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = product;
      }
    }

    if (bestScore >= 0.6 && bestMatch) {
      // Good enough match
      await db.update(productCatalogExtractions).set({
        matchedProductId: bestMatch.id,
        matchStatus: "matched",
        confidence: bestScore,
      }).where(eq(productCatalogExtractions.id, extraction.id));

      // Enrich product with catalog description
      await db.update(products).set({
        catalogDescription: extraction.extractedDescription,
        catalogPageRef: extraction.pageNumber ? `p.${extraction.pageNumber}` : null,
        updatedAt: new Date(),
      }).where(eq(products.id, bestMatch.id));

      matched++;
    } else {
      await db.update(productCatalogExtractions).set({
        matchStatus: "new",
        confidence: bestScore,
      }).where(eq(productCatalogExtractions.id, extraction.id));
      unmatched++;
    }
  }

  return { matched, unmatched };
}

// --- Main Import Flow ---

export interface CatalogImportResult {
  importId: string;
  totalPages: number;
  extractedProducts: number;
  matchedProducts: number;
  newProducts: number;
  status: string;
}

/**
 * Full catalog import pipeline:
 * 1. Extract text from PDF
 * 2. Chunk by product boundaries
 * 3. AI-extract product names + descriptions
 * 4. Match against existing products
 */
export async function importCatalog(
  buffer: Buffer,
  filename: string,
  onProgress?: (msg: string) => void,
): Promise<CatalogImportResult> {
  const log = onProgress || ((msg: string) => console.log(`[Catalog] ${msg}`));

  // Create import record
  const [importRecord] = await db.insert(productCatalogImports).values({
    filename,
    status: "extracting",
  }).returning();

  try {
    // Step 1: Extract text
    log("Extracting text from PDF...");
    const { text, pages } = await extractPdfText(buffer);
    await db.update(productCatalogImports).set({ totalPages: pages }).where(eq(productCatalogImports.id, importRecord.id));
    log(`Extracted ${text.length} chars from ${pages} pages`);

    // Step 2: Chunk
    const chunks = chunkCatalogText(text);
    log(`Split into ${chunks.length} chunks`);

    // Step 3: AI extraction
    await db.update(productCatalogImports).set({ status: "extracting" }).where(eq(productCatalogImports.id, importRecord.id));

    const client = getClient();
    let totalExtracted = 0;

    for (let i = 0; i < chunks.length; i++) {
      log(`Processing chunk ${i + 1}/${chunks.length}...`);
      const extracted = await extractProductsFromChunk(client, chunks[i], i);

      for (const product of extracted) {
        // Parse page number from pageRef
        const pageMatch = product.pageRef?.match(/(\d+)\s*of/);
        const pageNumber = pageMatch ? parseInt(pageMatch[1]) : null;

        await db.insert(productCatalogExtractions).values({
          importId: importRecord.id,
          extractedName: product.name,
          extractedDescription: product.description,
          pageNumber,
          confidence: 0.8,
        });
        totalExtracted++;
      }
    }

    await db.update(productCatalogImports).set({
      extractedProducts: totalExtracted,
      status: "matching",
    }).where(eq(productCatalogImports.id, importRecord.id));
    log(`Extracted ${totalExtracted} products, starting matching...`);

    // Step 4: Match
    const { matched, unmatched } = await matchExtractions(importRecord.id);

    await db.update(productCatalogImports).set({
      matchedProducts: matched,
      newProducts: unmatched,
      status: "completed",
      completedAt: new Date(),
    }).where(eq(productCatalogImports.id, importRecord.id));

    log(`Complete: ${matched} matched, ${unmatched} new/unmatched`);

    return {
      importId: importRecord.id,
      totalPages: pages,
      extractedProducts: totalExtracted,
      matchedProducts: matched,
      newProducts: unmatched,
      status: "completed",
    };
  } catch (err: any) {
    await db.update(productCatalogImports).set({
      status: "failed",
      error: err.message,
    }).where(eq(productCatalogImports.id, importRecord.id));
    throw err;
  }
}

// --- Queries ---

export async function getCatalogImports(): Promise<CatalogImport[]> {
  return db.select().from(productCatalogImports);
}

export async function getCatalogExtractions(importId: string): Promise<CatalogExtraction[]> {
  return db.select().from(productCatalogExtractions).where(eq(productCatalogExtractions.importId, importId));
}
