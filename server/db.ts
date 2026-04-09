import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "@shared/schema";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";

// Database file path
const DB_PATH = "./data/sourceannotator.db";

// Ensure data directory exists
const dataDir = dirname(DB_PATH);
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

// Create SQLite database connection
const sqlite = new Database(DB_PATH);

// Enable foreign keys
sqlite.pragma("foreign_keys = ON");

function getExistingColumnNames(tableName: string): Set<string> {
  const columns = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return new Set(columns.map((column) => column.name));
}

function tableExists(tableName: string): boolean {
  const result = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(tableName);
  return !!result;
}

function ensureColumn(tableName: string, columnName: string, columnDefinition: string): void {
  if (!tableExists(tableName)) {
    return;
  }

  const existingColumns = getExistingColumnNames(tableName);
  if (existingColumns.has(columnName)) {
    return;
  }

  sqlite.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition};`);
}

// Export the drizzle database instance
export const db = drizzle(sqlite, { schema });

// Persistent OCR queue for crash-safe background processing.
sqlite.exec(`
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  label TEXT,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_prefix ON api_keys(key_prefix);

CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_secret_hash TEXT,
  client_name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  grant_types TEXT NOT NULL,
  response_types TEXT NOT NULL,
  token_endpoint_auth_method TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_auth_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_mcp_auth_codes_expires_at ON mcp_auth_codes(expires_at);

CREATE TABLE IF NOT EXISTS mcp_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  scope TEXT NOT NULL,
  refresh_token_hash TEXT,
  expires_at INTEGER,
  last_used_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_user_id ON mcp_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_refresh_hash ON mcp_tokens(refresh_token_hash);

CREATE TABLE IF NOT EXISTS analytics_tool_calls (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  project_id TEXT,
  tool_name TEXT NOT NULL,
  document_id TEXT,
  escalation_round INTEGER NOT NULL,
  turn_number INTEGER NOT NULL,
  result_size_chars INTEGER NOT NULL,
  success INTEGER NOT NULL,
  metadata TEXT,
  timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analytics_tool_calls_timestamp
ON analytics_tool_calls(timestamp);
CREATE INDEX IF NOT EXISTS idx_analytics_tool_calls_conversation
ON analytics_tool_calls(conversation_id, timestamp);

CREATE TABLE IF NOT EXISTS analytics_context_snapshots (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  turn_number INTEGER NOT NULL,
  escalation_round INTEGER NOT NULL,
  estimated_tokens INTEGER NOT NULL,
  warning_level TEXT NOT NULL,
  trigger TEXT,
  metadata TEXT,
  timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analytics_context_snapshots_timestamp
ON analytics_context_snapshots(timestamp);
CREATE INDEX IF NOT EXISTS idx_analytics_context_snapshots_conversation
ON analytics_context_snapshots(conversation_id, timestamp);

CREATE TABLE IF NOT EXISTS web_clips (
  id TEXT PRIMARY KEY,
  highlighted_text TEXT NOT NULL,
  note TEXT,
  category TEXT NOT NULL DEFAULT 'key_quote',
  source_url TEXT NOT NULL,
  page_title TEXT NOT NULL,
  site_name TEXT,
  author_name TEXT,
  publish_date TEXT,
  citation_data TEXT,
  footnote TEXT,
  bibliography TEXT,
  project_id TEXT,
  project_document_id TEXT,
  surrounding_context TEXT,
  tags TEXT,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (project_document_id) REFERENCES project_documents(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_web_clips_created_at ON web_clips(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_web_clips_project_id ON web_clips(project_id);
CREATE INDEX IF NOT EXISTS idx_web_clips_source_url ON web_clips(source_url);

CREATE TABLE IF NOT EXISTS ocr_jobs (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  payload TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  started_at INTEGER,
  finished_at INTEGER,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ocr_jobs_status_created ON ocr_jobs(status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ocr_jobs_document_active
ON ocr_jobs(document_id)
WHERE status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS ocr_page_results (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (job_id) REFERENCES ocr_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  UNIQUE(job_id, page_number)
);
CREATE INDEX IF NOT EXISTS idx_ocr_page_results_job_page
ON ocr_page_results(job_id, page_number);
`);

ensureColumn("project_documents", "source_role", "source_role TEXT DEFAULT 'evidence'");
ensureColumn("project_documents", "style_analysis", "style_analysis TEXT");
ensureColumn("conversations", "evidence_clipboard", "evidence_clipboard TEXT");
ensureColumn("conversations", "compaction_summary", "compaction_summary TEXT");
ensureColumn("conversations", "compacted_at_turn", "compacted_at_turn INTEGER DEFAULT 0");
ensureColumn("api_keys", "label", "label TEXT");

// === iBOLT BLOG GENERATION TABLES ===

sqlite.exec(`
CREATE TABLE IF NOT EXISTS industry_verticals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  terminology TEXT,
  pain_points TEXT,
  use_cases TEXT,
  regulations TEXT,
  seasonal_relevance TEXT,
  compatible_devices TEXT,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
);

CREATE TABLE IF NOT EXISTS context_entries (
  id TEXT PRIMARY KEY,
  vertical_id TEXT NOT NULL,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'seed',
  source_url TEXT,
  confidence REAL NOT NULL DEFAULT 1.0,
  is_verified INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  FOREIGN KEY (vertical_id) REFERENCES industry_verticals(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_context_entries_vertical ON context_entries(vertical_id);
CREATE INDEX IF NOT EXISTS idx_context_entries_category ON context_entries(category);

CREATE TABLE IF NOT EXISTS keyword_imports (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  total_keywords INTEGER DEFAULT 0,
  new_keywords INTEGER DEFAULT 0,
  duplicate_keywords INTEGER DEFAULT 0,
  imported_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
);

CREATE TABLE IF NOT EXISTS keyword_clusters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  primary_keyword TEXT NOT NULL,
  vertical_id TEXT,
  total_volume INTEGER DEFAULT 0,
  avg_difficulty REAL DEFAULT 0,
  priority REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  FOREIGN KEY (vertical_id) REFERENCES industry_verticals(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS keywords (
  id TEXT PRIMARY KEY,
  keyword TEXT NOT NULL,
  volume INTEGER DEFAULT 0,
  difficulty INTEGER DEFAULT 0,
  cpc REAL DEFAULT 0,
  opportunity_score REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new',
  cluster_id TEXT,
  import_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  FOREIGN KEY (cluster_id) REFERENCES keyword_clusters(id) ON DELETE SET NULL,
  FOREIGN KEY (import_id) REFERENCES keyword_imports(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_keywords_status ON keywords(status);
CREATE INDEX IF NOT EXISTS idx_keywords_cluster ON keywords(cluster_id);

CREATE TABLE IF NOT EXISTS ibolt_products (
  id TEXT PRIMARY KEY,
  shopify_id TEXT UNIQUE,
  title TEXT NOT NULL,
  handle TEXT NOT NULL,
  description TEXT,
  product_type TEXT,
  vendor TEXT,
  tags TEXT,
  image_url TEXT,
  price TEXT,
  url TEXT,
  scraped_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
);

CREATE TABLE IF NOT EXISTS product_verticals (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  vertical_id TEXT NOT NULL,
  relevance_score REAL DEFAULT 1.0,
  FOREIGN KEY (product_id) REFERENCES ibolt_products(id) ON DELETE CASCADE,
  FOREIGN KEY (vertical_id) REFERENCES industry_verticals(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS generation_batches (
  id TEXT PRIMARY KEY,
  name TEXT,
  total_posts INTEGER DEFAULT 0,
  completed_posts INTEGER DEFAULT 0,
  failed_posts INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
);

CREATE TABLE IF NOT EXISTS blog_posts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  meta_title TEXT,
  meta_description TEXT,
  excerpt TEXT,
  markdown TEXT,
  html TEXT,
  has_photos INTEGER DEFAULT 0,
  photo_count INTEGER DEFAULT 0,
  cluster_id TEXT,
  vertical_id TEXT,
  batch_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  word_count INTEGER DEFAULT 0,
  brand_consistency INTEGER,
  seo_optimization INTEGER,
  natural_language INTEGER,
  factual_accuracy INTEGER,
  overall_score INTEGER,
  verification_notes TEXT,
  generated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  FOREIGN KEY (cluster_id) REFERENCES keyword_clusters(id) ON DELETE SET NULL,
  FOREIGN KEY (vertical_id) REFERENCES industry_verticals(id) ON DELETE SET NULL,
  FOREIGN KEY (batch_id) REFERENCES generation_batches(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_blog_posts_status ON blog_posts(status);

CREATE TABLE IF NOT EXISTS blog_post_products (
  id TEXT PRIMARY KEY,
  blog_post_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  mention_context TEXT,
  FOREIGN KEY (blog_post_id) REFERENCES blog_posts(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES ibolt_products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS research_jobs (
  id TEXT PRIMARY KEY,
  vertical_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  query TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  entries_found INTEGER DEFAULT 0,
  error TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  FOREIGN KEY (vertical_id) REFERENCES industry_verticals(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_research_jobs_status ON research_jobs(status);
`);

// === PRODUCT INFO BANK + PICTURE BANK TABLES ===

sqlite.exec(`
CREATE TABLE IF NOT EXISTS product_catalog_imports (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  total_pages INTEGER,
  extracted_products INTEGER DEFAULT 0,
  matched_products INTEGER DEFAULT 0,
  new_products INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  imported_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS product_catalog_extractions (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL,
  extracted_name TEXT NOT NULL,
  extracted_description TEXT,
  page_number INTEGER,
  confidence REAL DEFAULT 0.8,
  matched_product_id TEXT,
  match_status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  FOREIGN KEY (import_id) REFERENCES product_catalog_imports(id) ON DELETE CASCADE,
  FOREIGN KEY (matched_product_id) REFERENCES ibolt_products(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_catalog_extractions_import ON product_catalog_extractions(import_id);

CREATE TABLE IF NOT EXISTS product_photos (
  id TEXT PRIMARY KEY,
  product_id TEXT,
  filename TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER,
  file_path TEXT NOT NULL,
  thumbnail_path TEXT,
  width INTEGER,
  height INTEGER,
  angle_type TEXT,
  context_type TEXT,
  setting_description TEXT,
  quality_score REAL,
  is_hero INTEGER DEFAULT 0,
  vertical_relevance TEXT,
  ai_analysis TEXT,
  analyzed_at INTEGER,
  uploaded_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  FOREIGN KEY (product_id) REFERENCES ibolt_products(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_product_photos_product ON product_photos(product_id);

CREATE TABLE IF NOT EXISTS blog_post_photos (
  id TEXT PRIMARY KEY,
  blog_post_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  section_index INTEGER,
  placement TEXT NOT NULL DEFAULT 'inline',
  alt_text TEXT,
  caption TEXT,
  selection_reason TEXT,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  FOREIGN KEY (blog_post_id) REFERENCES blog_posts(id) ON DELETE CASCADE,
  FOREIGN KEY (photo_id) REFERENCES product_photos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pipeline_context_chunks (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  token_estimate INTEGER,
  vertical_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  FOREIGN KEY (vertical_id) REFERENCES industry_verticals(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_pipeline_chunks_source ON pipeline_context_chunks(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_chunks_vertical ON pipeline_context_chunks(vertical_id);
`);

// === SHOPIFY INTEGRATION COLUMNS ===
ensureColumn("blog_posts", "shopify_article_id", "shopify_article_id INTEGER");
ensureColumn("blog_posts", "shopify_blog_id", "shopify_blog_id INTEGER");
ensureColumn("blog_posts", "shopify_synced_at", "shopify_synced_at TEXT");
ensureColumn("blog_posts", "excerpt", "excerpt TEXT");
ensureColumn("blog_posts", "has_photos", "has_photos INTEGER DEFAULT 0");
ensureColumn("blog_posts", "photo_count", "photo_count INTEGER DEFAULT 0");

// Extend products table with catalog enrichment columns
ensureColumn("ibolt_products", "catalog_description", "catalog_description TEXT");
ensureColumn("ibolt_products", "catalog_page_ref", "catalog_page_ref TEXT");
ensureColumn("ibolt_products", "has_photos", "has_photos INTEGER DEFAULT 0");
ensureColumn("ibolt_products", "photo_count", "photo_count INTEGER DEFAULT 0");

// Seed industry verticals on first run
import { seedVerticals } from "./contextSeeds";
seedVerticals().then((count) => {
  if (count > 0) {
    console.log(`[iBolt] Seeded ${count} industry verticals with context entries`);
  }
});

// Export the raw sqlite connection for direct queries if needed
export { sqlite };
