import "dotenv/config";

process.env.BLOG_SEED_IBOLT_DEMO = "false";

const { DB_PATH, sqlite } = await import("../server/db");

const requiredTables = [
  "companies",
  "ibolt_products",
  "inventory_bins",
  "inventory_counts",
  "ocr_jobs",
  "ocr_page_results",
];

try {
  const integrityRows = sqlite.pragma("integrity_check") as Array<{ integrity_check: string }>;
  const integrityErrors = integrityRows
    .map((row) => row.integrity_check)
    .filter((result) => result !== "ok");
  if (integrityErrors.length > 0) {
    throw new Error(`SQLite integrity check failed: ${integrityErrors.join("; ")}`);
  }

  const foreignKeyErrors = sqlite.pragma("foreign_key_check") as Array<Record<string, unknown>>;
  if (foreignKeyErrors.length > 0) {
    throw new Error(`SQLite foreign key check found ${foreignKeyErrors.length} violation(s).`);
  }

  const existingTables = new Set(
    (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
      .map((row) => row.name),
  );
  const missingTables = requiredTables.filter((table) => !existingTables.has(table));
  if (missingTables.length > 0) {
    throw new Error(`Required tables are missing: ${missingTables.join(", ")}`);
  }

  const ocrIndex = (sqlite.pragma("index_list(ocr_page_results)") as Array<{ name: string; unique: number }>)
    .find((index) => index.name === "idx_ocr_page_results_job_page");
  if (!ocrIndex || ocrIndex.unique !== 1) {
    throw new Error("OCR page result uniqueness index was not repaired.");
  }

  console.log(`Database reconciled: ${DB_PATH}`);
  console.log("Integrity check: ok");
  console.log("Foreign key check: ok");
  console.log("Required inventory and OCR schema: ok");
} finally {
  sqlite.close();
}
