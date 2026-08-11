import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { existsSync } from "fs";

const DEFAULT_DB_PATH = "./data/standalone-blog-writer.db";
const LEGACY_DB_PATH = "./data/sourceannotator.db";

export function resolveDrizzleDatabasePath(
  configuredPath = process.env.DATABASE_PATH?.trim(),
  fileExists: (path: string) => boolean = existsSync,
): string {
  if (configuredPath) return configuredPath;
  if (fileExists(LEGACY_DB_PATH) && !fileExists(DEFAULT_DB_PATH)) return LEGACY_DB_PATH;
  return DEFAULT_DB_PATH;
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: resolveDrizzleDatabasePath(),
  },
});
