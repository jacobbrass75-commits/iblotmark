import "dotenv/config";

import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { and, eq } from "drizzle-orm";
import { productVerticals, industryVerticals } from "@shared/schema";
import { db } from "../server/db";
import { DEFAULT_COMPANY_ID } from "../server/companyDefaults";
import { upsertProduct } from "../server/productImporter";

type Row = Record<string, string | number | null>;

type PartRecord = {
  sourceRow: number;
  partNumber: string;
  description: string;
  rawWeight: string | number | null;
  weightOz: number | null;
  barcode: string | null;
};

type PartCategory = {
  productType: string;
  tags: string[];
  verticalSlugs: string[];
};

const DEFAULT_FILE = "/Users/yakub/Downloads/Product Weights - Compact with Part Barcodes.xlsx";
const SOURCE_NAME = "Product Weights - Compact with Part Barcodes.xlsx";

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function columnIndex(cellRef: string): number {
  const letters = cellRef.replace(/[^A-Z]/gi, "").toUpperCase();
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + letter.charCodeAt(0) - 64;
  }
  return index - 1;
}

function cellText(cellXml: string, sharedStrings: string[]): string | number | null {
  const type = cellXml.match(/\bt="([^"]+)"/)?.[1];
  if (type === "inlineStr") {
    const text = Array.from(cellXml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g))
      .map((match) => decodeXml(match[1]))
      .join("");
    return text || null;
  }

  const value = cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1];
  if (value === undefined) return null;
  if (type === "s") return sharedStrings[Number(value)] || null;
  if (type === "str") return decodeXml(value);

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : decodeXml(value);
}

async function readWorkbookRows(filePath: string, sheetName: string): Promise<Row[]> {
  const zip = await JSZip.loadAsync(await readFile(filePath));
  const sharedXml = await zip.file("xl/sharedStrings.xml")?.async("text");
  const sharedStrings = sharedXml
    ? Array.from(sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)).map((match) =>
        Array.from(match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g))
          .map((textMatch) => decodeXml(textMatch[1]))
          .join(""),
      )
    : [];

  const workbookXml = await zip.file("xl/workbook.xml")?.async("text");
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("text");
  if (!workbookXml || !relsXml) throw new Error("Workbook metadata is missing.");

  const sheetMatch = Array.from(workbookXml.matchAll(/<sheet\b[^>]*>/g))
    .map((match) => match[0])
    .find((sheet) => decodeXml(sheet.match(/\bname="([^"]+)"/)?.[1] || "") === sheetName);
  if (!sheetMatch) throw new Error(`Sheet "${sheetName}" was not found.`);

  const relationshipId = sheetMatch.match(/\br:id="([^"]+)"/)?.[1];
  if (!relationshipId) throw new Error(`Sheet "${sheetName}" has no relationship id.`);

  const relPattern = new RegExp(`<Relationship\\b[^>]*Id="${relationshipId}"[^>]*>`);
  const relMatch = relsXml.match(relPattern)?.[0];
  const target = relMatch?.match(/\bTarget="([^"]+)"/)?.[1];
  if (!target) throw new Error(`Sheet "${sheetName}" has no worksheet target.`);

  const sheetPath = `xl/${target.replace(/^\/?xl\//, "")}`;
  const sheetXml = await zip.file(sheetPath)?.async("text");
  if (!sheetXml) throw new Error(`Worksheet XML missing at ${sheetPath}.`);

  const rows = Array.from(sheetXml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)).map((rowMatch) => {
    const rowNumber = Number(rowMatch[1]);
    const cells: Array<string | number | null> = [];
    for (const cellMatch of rowMatch[2].matchAll(/<c\b[^>]*\br="([^"]+)"[^>]*>([\s\S]*?)<\/c>/g)) {
      cells[columnIndex(cellMatch[1])] = cellText(cellMatch[0], sharedStrings);
    }
    return { rowNumber, cells };
  });

  const headerRow = rows[0];
  if (!headerRow) return [];
  const headers = headerRow.cells.map((value) => String(value || "").trim());

  return rows.slice(1).map(({ rowNumber, cells }) => {
    const row: Row = { __rowNumber: rowNumber };
    headers.forEach((header, index) => {
      if (!header) return;
      row[header] = cells[index] ?? null;
    });
    return row;
  });
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

function normalizeHandle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 180);
}

function parseWeightOz(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return numeric;

  const lbOz = raw.match(/(\d+(?:\.\d+)?)\s*lb[s]?\s*(?:(\d+(?:\.\d+)?)\s*oz)?/i);
  if (lbOz) {
    const pounds = Number(lbOz[1]);
    const ounces = lbOz[2] ? Number(lbOz[2]) : 0;
    if (Number.isFinite(pounds) && Number.isFinite(ounces)) return pounds * 16 + ounces;
  }

  const typoLbOz = raw.match(/(\d+(?:\.\d+)?)\s*lb[s]?\s+(\d+(?:\.\d+)?)\s*lb[s]?/i);
  if (typoLbOz) {
    const pounds = Number(typoLbOz[1]);
    const likelyOunces = Number(typoLbOz[2]);
    if (Number.isFinite(pounds) && Number.isFinite(likelyOunces)) return pounds * 16 + likelyOunces;
  }

  const oz = raw.match(/(\d+(?:\.\d+)?)\s*oz/i);
  if (oz) {
    const ounces = Number(oz[1]);
    if (Number.isFinite(ounces)) return ounces;
  }

  return null;
}

function categorize(description: string, partNumber: string): PartCategory {
  const source = `${partNumber} ${description}`.toLowerCase();

  if (/(charger|usb|cable|microusb|usb-c|usb-a)/i.test(source)) {
    return {
      productType: "Cables & Chargers",
      tags: ["part", "electrical-accessory", "cable-charger"],
      verticalSlugs: ["device-compatibility-fit-guides", "road-trips-travel"],
    };
  }

  if (/(camera|gopro|dslr|1\/4|1\/4 20|magsafe)/i.test(source)) {
    return {
      productType: "Camera & MagSafe Adapters",
      tags: ["part", "camera-adapter", "content-creation"],
      verticalSlugs: ["content-creation-streaming", "mounting-standards-adapters"],
    };
  }

  if (/(screw|bolt|nut|hardware|hex key|tightening ring|knob|cap pack|adhesive|vhb|alco pad)/i.test(source)) {
    return {
      productType: "Hardware, Adhesives & Service Parts",
      tags: ["part", "hardware", "service-part"],
      verticalSlugs: ["mounting-standards-adapters", "general-mounting"],
    };
  }

  if (/(holder|dock|roadvise|tabdock|prodock|grip)/i.test(source)) {
    return {
      productType: "Device Holders & Cradles",
      tags: ["part", "device-holder", "cradle"],
      verticalSlugs: ["device-compatibility-fit-guides", "general-mounting"],
    };
  }

  if (/(vesa|equipment plate|pillar plate|metal plate|l bracket|forklift)/i.test(source)) {
    return {
      productType: "VESA & Equipment Plates",
      tags: ["part", "vesa", "equipment-plate"],
      verticalSlugs: ["mounting-standards-adapters", "forklifts-warehousing"],
    };
  }

  if (/(cup holder|console)/i.test(source)) {
    return {
      productType: "Cup Holder & Console Bases",
      tags: ["part", "cup-holder", "vehicle-base"],
      verticalSlugs: ["cup-holder-console-mounts", "road-trips-travel"],
    };
  }

  if (/(clamp|handlebar|bike|claw)/i.test(source)) {
    const bike = /(bike|handlebar)/i.test(source);
    return {
      productType: "Clamp & Handlebar Mounts",
      tags: ["part", "clamp-mount", ...(bike ? ["bike-mount"] : [])],
      verticalSlugs: bike
        ? ["mountain-biking-cycling", "general-mounting"]
        : ["general-mounting", "mounting-standards-adapters"],
    };
  }

  if (/(arm|shaft|extension|gooseneck|pole|swivel|ratchet)/i.test(source)) {
    return {
      productType: "Arms, Shafts & Extension Components",
      tags: ["part", "arm", "extension"],
      verticalSlugs: ["general-mounting", "mounting-standards-adapters"],
    };
  }

  if (/(suction|dash disc|vent|headrest|seat rail|wedge|drill-base|drill base|sticky)/i.test(source)) {
    return {
      productType: "Vehicle & Surface Bases",
      tags: ["part", "base", "vehicle-mount"],
      verticalSlugs: ["road-trips-travel", "general-mounting"],
    };
  }

  if (/(amps|adapter|adpater|ball|socket|4 prong|2t|plate)/i.test(source)) {
    return {
      productType: "AMPS Plates & Ball Adapters",
      tags: ["part", "adapter", "amps"],
      verticalSlugs: ["mounting-standards-adapters", "device-compatibility-fit-guides"],
    };
  }

  return {
    productType: "General Mount Parts",
    tags: ["part", "mount-component"],
    verticalSlugs: ["general-mounting"],
  };
}

function chooseDefaultWeight(records: PartRecord[]): number | null {
  const weights = records
    .map((record) => record.weightOz)
    .filter((weight): weight is number => typeof weight === "number" && Number.isFinite(weight));
  if (weights.length === 0) return null;

  const counts = new Map<number, number>();
  for (const weight of weights) counts.set(weight, (counts.get(weight) || 0) + 1);
  const [mostCommonWeight, mostCommonCount] = Array.from(counts.entries()).sort((left, right) => right[1] - left[1])[0];
  if (mostCommonCount > 1) return mostCommonWeight;

  return records
    .slice()
    .reverse()
    .find((record) => typeof record.weightOz === "number" && Number.isFinite(record.weightOz))
    ?.weightOz ?? null;
}

function toPartRecords(rows: Row[]): PartRecord[] {
  return rows
    .map((row) => {
      const partNumber = text(row["PART NUMBER"]);
      const description = text(row["ITEM DESCRIPTION"]);
      const rawWeight = row["WEIGHT (OZ)"] ?? null;
      const barcode = text(row["PART NUMBER BARCODE"]) || null;
      if (!partNumber || !description) return null;
      return {
        sourceRow: Number(row.__rowNumber),
        partNumber,
        description,
        rawWeight,
        weightOz: parseWeightOz(rawWeight),
        barcode,
      };
    })
    .filter((record): record is PartRecord => Boolean(record));
}

async function ensureVerticalMappings(productId: string, companyId: string, slugs: string[]): Promise<number> {
  const verticalRows = await db
    .select()
    .from(industryVerticals)
    .where(eq(industryVerticals.companyId, companyId));
  const verticalBySlug = new Map(verticalRows.map((vertical) => [vertical.slug, vertical]));
  const existingRows = await db
    .select()
    .from(productVerticals)
    .where(and(eq(productVerticals.companyId, companyId), eq(productVerticals.productId, productId)));
  const existingVerticalIds = new Set(existingRows.map((row) => row.verticalId));

  let created = 0;
  for (const slug of slugs) {
    const vertical = verticalBySlug.get(slug);
    if (!vertical || existingVerticalIds.has(vertical.id)) continue;
    await db.insert(productVerticals).values({
      companyId,
      productId,
      verticalId: vertical.id,
      relevanceScore: 0.9,
    });
    existingVerticalIds.add(vertical.id);
    created += 1;
  }
  return created;
}

async function main(): Promise<void> {
  const filePath = process.argv[2] || DEFAULT_FILE;
  const companyId = process.env.IMPORT_COMPANY_ID || DEFAULT_COMPANY_ID;
  const rows = await readWorkbookRows(filePath, "Matched Parts");
  const records = toPartRecords(rows);
  const byPart = new Map<string, PartRecord[]>();
  for (const record of records) {
    byPart.set(record.partNumber, [...(byPart.get(record.partNumber) || []), record]);
  }

  let created = 0;
  let updated = 0;
  let mapped = 0;
  let conflicts = 0;
  const importedAt = new Date().toISOString();

  for (const [partNumber, partRecords] of byPart) {
    const primary = partRecords[partRecords.length - 1];
    const weightOz = chooseDefaultWeight(partRecords);
    const distinctWeights = Array.from(new Set(partRecords.map((record) => record.weightOz).filter((value) => value !== null)));
    const hasWeightConflict = distinctWeights.length > 1;
    if (hasWeightConflict) conflicts += 1;

    const category = categorize(primary.description, partNumber);
    const barcode = primary.barcode || partNumber;
    const { product, created: wasCreated } = await upsertProduct(companyId, {
      title: primary.description,
      handle: `part-${normalizeHandle(partNumber)}`,
      description: `${primary.description}. Imported part weight for QR/counting workflow.`,
      productType: category.productType,
      vendor: "iBolt Mounts",
      sku: partNumber,
      tags: Array.from(new Set([
        ...category.tags,
        `part-number:${partNumber}`,
        `category:${normalizeHandle(category.productType)}`,
        ...(barcode ? [`barcode:${barcode}`] : []),
        ...(hasWeightConflict ? ["weight-conflict"] : []),
      ])),
      specs: {
        partNumber,
        barcode,
        unitWeightOz: weightOz,
        weightUnit: "oz",
        weightConflict: hasWeightConflict,
      },
      variants: [{
        title: primary.description,
        sku: partNumber,
        barcode,
        unitWeightOz: weightOz,
        sourceRows: partRecords.map((record) => record.sourceRow),
      }],
      availability: null,
      sourceType: "inventory_weight_sheet",
      sourceUrl: `inventory-weight-sheet:${partNumber}`,
      sourceData: {
        partNumber,
        partBarcode: barcode,
        partCategory: category.productType,
        unitWeightOz: weightOz,
        rawWeight: primary.rawWeight,
        weightConflict: hasWeightConflict,
        weightRows: partRecords.map((record) => ({
          sourceRow: record.sourceRow,
          description: record.description,
          rawWeight: record.rawWeight,
          weightOz: record.weightOz,
          barcode: record.barcode,
        })),
        import: {
          sourceFile: path.basename(filePath) || SOURCE_NAME,
          sheet: "Matched Parts",
          importedAt,
        },
      },
    });

    if (wasCreated) created += 1;
    else updated += 1;
    mapped += await ensureVerticalMappings(product.id, companyId, category.verticalSlugs);
  }

  console.log(JSON.stringify({
    file: filePath,
    companyId,
    rows: records.length,
    uniqueParts: byPart.size,
    created,
    updated,
    verticalMappingsCreated: mapped,
    weightConflicts: conflicts,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
