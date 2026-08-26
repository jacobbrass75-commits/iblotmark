import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { existsSync } from "fs";

const defaultDatabasePath = "./data/standalone-blog-writer.db";
const legacyDatabasePath = "./data/sourceannotator.db";
const configuredDatabasePath = process.env.DATABASE_PATH?.trim();
const databasePath = configuredDatabasePath
  || (existsSync(legacyDatabasePath) && !existsSync(defaultDatabasePath)
    ? legacyDatabasePath
    : defaultDatabasePath);

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: databasePath,
  },
});
