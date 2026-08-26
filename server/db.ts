import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "@shared/schema";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { DEFAULT_COMPANY_ID } from "./companyDefaults";

// Database file path
const DEFAULT_DB_PATH = "./data/standalone-blog-writer.db";
const LEGACY_DB_PATH = "./data/sourceannotator.db";

function resolveDatabasePath(): string {
  const configuredPath = process.env.DATABASE_PATH?.trim();
  if (configuredPath) return configuredPath;
  if (existsSync(LEGACY_DB_PATH) && !existsSync(DEFAULT_DB_PATH)) return LEGACY_DB_PATH;
  return DEFAULT_DB_PATH;
}

export const DB_PATH = resolveDatabasePath();

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
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name: string } | undefined;
  return Boolean(row?.name);
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

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

// Export the drizzle database instance
export const db = drizzle(sqlite, { schema });

// Core ScholarMark tables. Drizzle migrations are still the source of truth,
// but local/dev startup should be able to recover from a missing SQLite file.
sqlite.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  password TEXT DEFAULT '',
  first_name TEXT,
  last_name TEXT,
  tier TEXT NOT NULL DEFAULT 'free',
  tokens_used INTEGER NOT NULL DEFAULT 0,
  token_limit INTEGER NOT NULL DEFAULT 50000,
  storage_used INTEGER NOT NULL DEFAULT 0,
  storage_limit INTEGER NOT NULL DEFAULT 52428800,
  email_verified INTEGER DEFAULT 0,
  billing_cycle_start INTEGER,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  filename TEXT NOT NULL,
  full_text TEXT NOT NULL,
  upload_date INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  user_intent TEXT,
  summary TEXT,
  main_arguments TEXT,
  key_concepts TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ready',
  processing_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);

CREATE TABLE IF NOT EXISTS text_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  text TEXT NOT NULL,
  start_position INTEGER NOT NULL,
  end_position INTEGER NOT NULL,
  section_title TEXT,
  embedding TEXT,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_text_chunks_document_id ON text_chunks(document_id);

CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  chunk_id TEXT,
  start_position INTEGER NOT NULL,
  end_position INTEGER NOT NULL,
  highlighted_text TEXT NOT NULL,
  category TEXT NOT NULL,
  note TEXT NOT NULL,
  is_ai_generated INTEGER NOT NULL DEFAULT 0,
  confidence_score REAL,
  prompt_text TEXT,
  prompt_index INTEGER,
  prompt_color TEXT,
  analysis_run_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_annotations_document_id ON annotations(document_id);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  thesis TEXT,
  scope TEXT,
  context_summary TEXT,
  context_embedding TEXT,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
);
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);

CREATE TABLE IF NOT EXISTS prompt_templates (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  prompts TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_project_id ON prompt_templates(project_id);

CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  parent_folder_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  context_summary TEXT,
  context_embedding TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_folder_id) REFERENCES folders(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_folders_project_id ON folders(project_id);

CREATE TABLE IF NOT EXISTS project_documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  folder_id TEXT,
  project_context TEXT,
  role_in_project TEXT,
  retrieval_context TEXT,
  retrieval_embedding TEXT,
  citation_data TEXT,
  last_viewed_at INTEGER,
  scroll_position INTEGER,
  source_role TEXT DEFAULT 'evidence',
  style_analysis TEXT,
  added_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_project_documents_project_id ON project_documents(project_id);
CREATE INDEX IF NOT EXISTS idx_project_documents_document_id ON project_documents(document_id);

CREATE TABLE IF NOT EXISTS project_annotations (
  id TEXT PRIMARY KEY,
  project_document_id TEXT NOT NULL,
  start_position INTEGER NOT NULL,
  end_position INTEGER NOT NULL,
  highlighted_text TEXT NOT NULL,
  category TEXT NOT NULL,
  note TEXT,
  is_ai_generated INTEGER DEFAULT 1,
  confidence_score REAL,
  prompt_text TEXT,
  prompt_index INTEGER,
  prompt_color TEXT,
  analysis_run_id TEXT,
  searchable_content TEXT,
  search_embedding TEXT,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  FOREIGN KEY (project_document_id) REFERENCES project_documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_project_annotations_project_document_id ON project_annotations(project_document_id);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  project_id TEXT,
  title TEXT NOT NULL DEFAULT 'New Chat',
  model TEXT NOT NULL DEFAULT 'claude-opus-4-6',
  writing_model TEXT DEFAULT 'precision',
  selected_source_ids TEXT,
  citation_style TEXT DEFAULT 'chicago',
  tone TEXT DEFAULT 'academic',
  humanize INTEGER DEFAULT 1,
  no_en_dashes INTEGER DEFAULT 0,
  evidence_clipboard TEXT,
  compaction_summary TEXT,
  compacted_at_turn INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_project_id ON conversations(project_id);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tokens_used INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
`);

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
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
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
  user_id TEXT,
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
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ocr_page_results_job_page
ON ocr_page_results(job_id, page_number);
`);

const ocrPageIndex = sqlite
  .prepare("PRAGMA index_list(ocr_page_results)")
  .all()
  .find((index) => (index as { name: string }).name === "idx_ocr_page_results_job_page") as
    | { name: string; unique: number }
    | undefined;

if (ocrPageIndex && ocrPageIndex.unique !== 1) {
  sqlite.exec(`
    DROP INDEX ${quoteIdent(ocrPageIndex.name)};
    CREATE UNIQUE INDEX ${quoteIdent(ocrPageIndex.name)}
    ON ocr_page_results(job_id, page_number);
  `);
}

ensureColumn("project_documents", "source_role", "source_role TEXT DEFAULT 'evidence'");
ensureColumn("project_documents", "style_analysis", "style_analysis TEXT");
ensureColumn("conversations", "evidence_clipboard", "evidence_clipboard TEXT");
ensureColumn("conversations", "compaction_summary", "compaction_summary TEXT");
ensureColumn("conversations", "compacted_at_turn", "compacted_at_turn INTEGER DEFAULT 0");
ensureColumn("api_keys", "label", "label TEXT");
ensureColumn("web_clips", "user_id", "user_id TEXT");

// Company/productization tables. These keep the blog subsystem usable for the
// existing iBolt workspace while making brand and integration data configurable.
sqlite.exec(`
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  website_url TEXT,
  primary_domain TEXT,
  logo_url TEXT,
  primary_market TEXT,
  ecommerce_platform TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
);

CREATE TABLE IF NOT EXISTS company_memberships (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(company_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_company_memberships_company ON company_memberships(company_id);
CREATE INDEX IF NOT EXISTS idx_company_memberships_user ON company_memberships(user_id);

CREATE TABLE IF NOT EXISTS brand_profiles (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  website_url TEXT,
  blog_url TEXT,
  product_url_pattern TEXT,
  short_description TEXT,
  positioning TEXT,
  audience_personas TEXT,
  tone_traits TEXT,
  banned_phrases TEXT,
  preferred_ctas TEXT,
  key_messaging TEXT,
  required_terms TEXT,
  required_claims TEXT,
  forbidden_claims TEXT,
  competitors TEXT,
  writing_samples TEXT,
  target_word_count_min INTEGER NOT NULL DEFAULT 800,
  target_word_count_max INTEGER NOT NULL DEFAULT 1400,
  html_style_preferences TEXT,
  is_default INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_brand_profiles_company ON brand_profiles(company_id);

CREATE TABLE IF NOT EXISTS company_integrations (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'configured',
  access_token_ref TEXT,
  config TEXT,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_company_integrations_company ON company_integrations(company_id);
CREATE INDEX IF NOT EXISTS idx_company_integrations_type ON company_integrations(type);

CREATE TABLE IF NOT EXISTS company_settings (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL UNIQUE,
  settings TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS company_usage_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  user_id TEXT,
  event_type TEXT NOT NULL,
  metadata TEXT,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_company_usage_events_company ON company_usage_events(company_id);
CREATE INDEX IF NOT EXISTS idx_company_usage_events_type ON company_usage_events(event_type);

CREATE TABLE IF NOT EXISTS company_job_locks (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  job_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  acquired_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  heartbeat_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  UNIQUE(company_id, job_type)
);
CREATE INDEX IF NOT EXISTS idx_company_job_locks_expires ON company_job_locks(expires_at);

CREATE TABLE IF NOT EXISTS company_job_runs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  job_type TEXT NOT NULL,
  trigger_type TEXT NOT NULL DEFAULT 'scheduled',
  status TEXT NOT NULL DEFAULT 'running',
  owner_id TEXT,
  started_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  completed_at INTEGER,
  duration_ms INTEGER,
  result TEXT,
  error TEXT,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_company_job_runs_company_started ON company_job_runs(company_id, started_at);
CREATE INDEX IF NOT EXISTS idx_company_job_runs_type_status ON company_job_runs(job_type, status);
`);

// === iBOLT BLOG GENERATION TABLES ===

sqlite.exec(`
CREATE TABLE IF NOT EXISTS industry_verticals (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  terminology TEXT,
  pain_points TEXT,
  use_cases TEXT,
  regulations TEXT,
  seasonal_relevance TEXT,
  compatible_devices TEXT,
  research_subreddits TEXT,
  research_youtube_queries TEXT,
  research_web_queries TEXT,
  last_researched_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_industry_verticals_company_name ON industry_verticals(company_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_industry_verticals_company_slug ON industry_verticals(company_id, slug);

CREATE TABLE IF NOT EXISTS context_entries (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
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
  company_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  total_keywords INTEGER DEFAULT 0,
  new_keywords INTEGER DEFAULT 0,
  duplicate_keywords INTEGER DEFAULT 0,
  imported_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
);

CREATE TABLE IF NOT EXISTS keyword_clusters (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
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
  company_id TEXT NOT NULL,
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
  company_id TEXT NOT NULL,
  shopify_id TEXT,
  title TEXT NOT NULL,
  handle TEXT NOT NULL,
  description TEXT,
  product_type TEXT,
  vendor TEXT,
  sku TEXT,
  tags TEXT,
  image_url TEXT,
  price TEXT,
  url TEXT,
  specs TEXT,
  compatibility TEXT,
  claims TEXT,
  disclaimers TEXT,
  variants TEXT,
  availability TEXT,
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_url TEXT,
  source_data TEXT,
  source_synced_at INTEGER,
  scraped_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_company_shopify_id ON ibolt_products(company_id, shopify_id);
CREATE VIEW IF NOT EXISTS products AS SELECT * FROM ibolt_products;

CREATE TABLE IF NOT EXISTS inventory_bins (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  product_id TEXT,
  sku TEXT,
  product_title TEXT NOT NULL,
  bin_label TEXT NOT NULL,
  qr_code TEXT NOT NULL,
  unit_weight_oz REAL NOT NULL,
  empty_bin_weight_oz REAL NOT NULL DEFAULT 56,
  location TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_quantity INTEGER,
  last_count_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  FOREIGN KEY (product_id) REFERENCES ibolt_products(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_bins_company_qr_code ON inventory_bins(company_id, qr_code);
CREATE INDEX IF NOT EXISTS idx_inventory_bins_company_product ON inventory_bins(company_id, product_id);

CREATE TABLE IF NOT EXISTS inventory_counts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  bin_id TEXT NOT NULL,
  product_id TEXT,
  sku TEXT,
  product_title TEXT NOT NULL,
  total_weight_oz REAL NOT NULL,
  empty_bin_weight_oz REAL NOT NULL,
  unit_weight_oz REAL NOT NULL,
  net_weight_oz REAL NOT NULL,
  raw_quantity REAL NOT NULL,
  quantity INTEGER NOT NULL,
  rounding_mode TEXT NOT NULL DEFAULT 'nearest',
  counted_by TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  FOREIGN KEY (bin_id) REFERENCES inventory_bins(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES ibolt_products(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_inventory_counts_company_bin ON inventory_counts(company_id, bin_id);
CREATE INDEX IF NOT EXISTS idx_inventory_counts_company_created ON inventory_counts(company_id, created_at);

CREATE TABLE IF NOT EXISTS product_feed_audits (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  lane TEXT NOT NULL,
  lane_label TEXT NOT NULL,
  hero_product_id TEXT,
  hero_product_handle TEXT NOT NULL,
  audit_checks TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'needs_review',
  product_gap_risk TEXT NOT NULL DEFAULT 'medium',
  recommendations TEXT NOT NULL,
  shopify_snapshot TEXT,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  FOREIGN KEY (hero_product_id) REFERENCES ibolt_products(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_product_feed_audits_lane ON product_feed_audits(lane);
CREATE INDEX IF NOT EXISTS idx_product_feed_audits_handle ON product_feed_audits(hero_product_handle);
CREATE INDEX IF NOT EXISTS idx_product_feed_audits_created ON product_feed_audits(created_at);

CREATE TABLE IF NOT EXISTS product_verticals (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  vertical_id TEXT NOT NULL,
  relevance_score REAL DEFAULT 1.0,
  FOREIGN KEY (product_id) REFERENCES ibolt_products(id) ON DELETE CASCADE,
  FOREIGN KEY (vertical_id) REFERENCES industry_verticals(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS generation_batches (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
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
  company_id TEXT NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  meta_title TEXT,
  meta_description TEXT,
  markdown TEXT,
  html TEXT,
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
  company_id TEXT NOT NULL,
  blog_post_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  mention_context TEXT,
  FOREIGN KEY (blog_post_id) REFERENCES blog_posts(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES ibolt_products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS research_jobs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS ai_benchmark_queries (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  category TEXT NOT NULL,
  label TEXT,
  query TEXT NOT NULL,
  vertical_id TEXT,
  intent_type TEXT NOT NULL DEFAULT 'buyer_guide',
  priority REAL NOT NULL DEFAULT 50,
  benchmark_goal TEXT,
  persona TEXT,
  pain_point TEXT,
  brand_angle TEXT,
  ibolt_angle TEXT,
  target_products TEXT,
  benchmark_baseline TEXT,
  benchmark_baselined_at INTEGER,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  FOREIGN KEY (vertical_id) REFERENCES industry_verticals(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_benchmark_queries_status ON ai_benchmark_queries(status);
CREATE INDEX IF NOT EXISTS idx_ai_benchmark_queries_vertical ON ai_benchmark_queries(vertical_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_benchmark_queries_company_query ON ai_benchmark_queries(company_id, query);

CREATE TABLE IF NOT EXISTS ai_benchmark_runs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  name TEXT,
  providers TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  query_count INTEGER NOT NULL DEFAULT 0,
  result_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  summary TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
);
CREATE INDEX IF NOT EXISTS idx_ai_benchmark_runs_status ON ai_benchmark_runs(status);

CREATE TABLE IF NOT EXISTS ai_benchmark_results (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  query_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  prompt TEXT,
  raw_response TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  error TEXT,
  target_brand_mentioned INTEGER NOT NULL DEFAULT 0,
  brand_mentioned INTEGER NOT NULL DEFAULT 0,
  target_domain_cited INTEGER NOT NULL DEFAULT 0,
  ibolt_cited INTEGER NOT NULL DEFAULT 0,
  top_pick_rank INTEGER,
  coverage_score INTEGER NOT NULL DEFAULT 0,
  sentiment TEXT,
  positioning TEXT,
  positioning_tags TEXT,
  mentioned_products TEXT,
  competitors TEXT,
  source_urls TEXT,
  analysis_notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  FOREIGN KEY (run_id) REFERENCES ai_benchmark_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (query_id) REFERENCES ai_benchmark_queries(id) ON DELETE CASCADE,
  UNIQUE(run_id, query_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_ai_benchmark_results_run ON ai_benchmark_results(run_id);
CREATE INDEX IF NOT EXISTS idx_ai_benchmark_results_query ON ai_benchmark_results(query_id);
CREATE INDEX IF NOT EXISTS idx_ai_benchmark_results_provider ON ai_benchmark_results(provider);
`);

ensureColumn("ai_benchmark_queries", "persona", "persona TEXT");
ensureColumn("ai_benchmark_queries", "pain_point", "pain_point TEXT");
ensureColumn("ai_benchmark_queries", "brand_angle", "brand_angle TEXT");
ensureColumn("ai_benchmark_queries", "ibolt_angle", "ibolt_angle TEXT");
ensureColumn("ai_benchmark_queries", "target_products", "target_products TEXT");
ensureColumn("ai_benchmark_queries", "benchmark_baseline", "benchmark_baseline TEXT");
ensureColumn("ai_benchmark_queries", "benchmark_baselined_at", "benchmark_baselined_at INTEGER");
ensureColumn("ai_benchmark_results", "target_brand_mentioned", "target_brand_mentioned INTEGER NOT NULL DEFAULT 0");
ensureColumn("ai_benchmark_results", "target_domain_cited", "target_domain_cited INTEGER NOT NULL DEFAULT 0");
sqlite.exec(`
UPDATE ai_benchmark_queries
SET brand_angle = ibolt_angle
WHERE (brand_angle IS NULL OR brand_angle = '') AND ibolt_angle IS NOT NULL AND ibolt_angle != '';

UPDATE ai_benchmark_queries
SET ibolt_angle = brand_angle
WHERE (ibolt_angle IS NULL OR ibolt_angle = '') AND brand_angle IS NOT NULL AND brand_angle != '';

UPDATE ai_benchmark_results
SET target_brand_mentioned = brand_mentioned
WHERE target_brand_mentioned != brand_mentioned;

UPDATE ai_benchmark_results
SET target_domain_cited = ibolt_cited
WHERE target_domain_cited != ibolt_cited;
`);

// === PRODUCT INFO BANK + PICTURE BANK TABLES ===

sqlite.exec(`
CREATE TABLE IF NOT EXISTS product_catalog_imports (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
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
  company_id TEXT NOT NULL,
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
  company_id TEXT NOT NULL,
  product_id TEXT,
  filename TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER,
  file_path TEXT NOT NULL,
  thumbnail_path TEXT,
  width INTEGER,
  height INTEGER,
  asset_status TEXT NOT NULL DEFAULT 'needs_review',
  rights_status TEXT NOT NULL DEFAULT 'unknown',
  usage_restrictions TEXT,
  use_cases TEXT,
  alt_text TEXT,
  caption TEXT,
  notes TEXT,
  source_type TEXT NOT NULL DEFAULT 'upload',
  source_url TEXT,
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
  company_id TEXT NOT NULL,
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
  company_id TEXT NOT NULL,
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
const companyScopedTables = [
  "industry_verticals",
  "context_entries",
  "keyword_imports",
  "keyword_clusters",
  "keywords",
  "ibolt_products",
  "product_feed_audits",
  "product_verticals",
  "generation_batches",
  "blog_posts",
  "blog_post_products",
  "research_jobs",
  "ai_benchmark_queries",
  "ai_benchmark_runs",
  "ai_benchmark_results",
  "product_catalog_imports",
  "product_catalog_extractions",
  "product_photos",
  "blog_post_photos",
  "pipeline_context_chunks",
] as const;

for (const tableName of companyScopedTables) {
  ensureColumn(tableName, "company_id", "company_id TEXT");
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_${tableName}_company ON ${tableName}(company_id);`);
}

function getTableCreateSql(tableName: string): string {
  const row = sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { sql: string } | undefined;
  if (!row?.sql) {
    throw new Error(`Could not find CREATE TABLE SQL for ${tableName}.`);
  }
  return row.sql;
}

function tableHasNullableCompanyId(tableName: string): boolean {
  const columns = sqlite.prepare(`PRAGMA table_info(${quoteIdent(tableName)})`).all() as Array<{ name: string; notnull: number }>;
  const companyColumn = columns.find((column) => column.name === "company_id");
  return !companyColumn || companyColumn.notnull !== 1;
}

function assertNoMissingCompanyRows(tableName: string): void {
  const missing = sqlite
    .prepare(`SELECT COUNT(*) AS count FROM ${quoteIdent(tableName)} WHERE company_id IS NULL OR company_id = ''`)
    .get() as { count: number };
  if ((missing.count || 0) > 0) {
    throw new Error(`${tableName} has ${missing.count} rows without company_id. Backfill explicitly before enforcing tenant constraints.`);
  }
}

function makeTenantStrictCreateSql(tableName: string, tempTableName: string): string {
  const createSql = getTableCreateSql(tableName);
  const createTemp = createSql.replace(
    /^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|\S+)/i,
    `CREATE TABLE ${quoteIdent(tempTableName)}`,
  );
  if (!/\bcompany_id\b/i.test(createTemp)) {
    throw new Error(`${tableName} does not have a company_id column.`);
  }

  const strictSql = createTemp
    .replace(/(["`[]?company_id["`\]]?\s+TEXT)(?!\s+NOT\s+NULL)/i, "$1 NOT NULL");

  if (!/company_id["`\]]?\s+TEXT\s+NOT\s+NULL/i.test(strictSql)) {
    throw new Error(`Could not make ${tableName}.company_id NOT NULL.`);
  }
  return strictSql;
}

function rebuildTableWithStrictCompanyId(tableName: string): void {
  if (!tableExists(tableName) || !tableHasNullableCompanyId(tableName)) return;
  assertNoMissingCompanyRows(tableName);

  const columns = sqlite.prepare(`PRAGMA table_info(${quoteIdent(tableName)})`).all() as Array<{ name: string }>;
  const columnList = columns.map((column) => quoteIdent(column.name)).join(", ");
  const tempTableName = `__${tableName}_tenant_strict`;
  const indexRows = sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL")
    .all(tableName) as Array<{ sql: string }>;

  sqlite.exec(`DROP TABLE IF EXISTS ${quoteIdent(tempTableName)};`);
  sqlite.exec(makeTenantStrictCreateSql(tableName, tempTableName));
  sqlite.exec(`INSERT INTO ${quoteIdent(tempTableName)} (${columnList}) SELECT ${columnList} FROM ${quoteIdent(tableName)};`);
  sqlite.exec(`DROP TABLE ${quoteIdent(tableName)};`);
  sqlite.exec(`ALTER TABLE ${quoteIdent(tempTableName)} RENAME TO ${quoteIdent(tableName)};`);
  for (const row of indexRows) {
    sqlite.exec(row.sql);
  }
}

function enforceBlogCompanyIdNotNull(): void {
  const nullableTables = companyScopedTables.filter((tableName) => tableHasNullableCompanyId(tableName));
  if (nullableTables.length === 0) return;

  const previousForeignKeys = sqlite.pragma("foreign_keys", { simple: true }) as number;
  sqlite.pragma("foreign_keys = OFF");
  try {
    const migrate = sqlite.transaction(() => {
      for (const tableName of nullableTables) {
        rebuildTableWithStrictCompanyId(tableName);
      }
    });
    migrate();
  } finally {
    sqlite.pragma(`foreign_keys = ${previousForeignKeys ? "ON" : "OFF"}`);
  }
}

export function validateBlogTenantIntegrity(): void {
  const nullableColumns: string[] = [];
  const rowsMissingCompany: string[] = [];

  for (const tableName of companyScopedTables) {
    const columns = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string; notnull: number }>;
    const companyColumn = columns.find((column) => column.name === "company_id");
    if (!companyColumn || companyColumn.notnull !== 1) {
      nullableColumns.push(tableName);
    }

    const missing = sqlite
      .prepare(`SELECT COUNT(*) AS count FROM ${tableName} WHERE company_id IS NULL OR company_id = ''`)
      .get() as { count: number };
    if ((missing.count || 0) > 0) {
      rowsMissingCompany.push(`${tableName} (${missing.count})`);
    }
  }

  const errors: string[] = [];
  if (nullableColumns.length > 0) {
    errors.push(`company_id must be NOT NULL on blog tables: ${nullableColumns.join(", ")}`);
  }
  if (rowsMissingCompany.length > 0) {
    errors.push(`blog rows missing company_id: ${rowsMissingCompany.join(", ")}`);
  }
  if (errors.length > 0) {
    throw new Error(`Blog tenant integrity check failed:\n- ${errors.join("\n- ")}`);
  }
}

ensureColumn("blog_posts", "shopify_article_id", "shopify_article_id INTEGER");
ensureColumn("blog_posts", "shopify_blog_id", "shopify_blog_id INTEGER");
ensureColumn("blog_posts", "shopify_synced_at", "shopify_synced_at TEXT");
ensureColumn("blog_posts", "generation_provider", "generation_provider TEXT");
ensureColumn("blog_posts", "generation_model", "generation_model TEXT");
ensureColumn("industry_verticals", "research_subreddits", "research_subreddits TEXT");
ensureColumn("industry_verticals", "research_youtube_queries", "research_youtube_queries TEXT");
ensureColumn("industry_verticals", "research_web_queries", "research_web_queries TEXT");
ensureColumn("industry_verticals", "last_researched_at", "last_researched_at INTEGER");

// Extend products table with catalog enrichment columns
ensureColumn("ibolt_products", "catalog_description", "catalog_description TEXT");
ensureColumn("ibolt_products", "catalog_page_ref", "catalog_page_ref TEXT");
ensureColumn("ibolt_products", "has_photos", "has_photos INTEGER DEFAULT 0");
ensureColumn("ibolt_products", "photo_count", "photo_count INTEGER DEFAULT 0");
ensureColumn("ibolt_products", "sku", "sku TEXT");
ensureColumn("ibolt_products", "specs", "specs TEXT");
ensureColumn("ibolt_products", "compatibility", "compatibility TEXT");
ensureColumn("ibolt_products", "claims", "claims TEXT");
ensureColumn("ibolt_products", "disclaimers", "disclaimers TEXT");
ensureColumn("ibolt_products", "variants", "variants TEXT");
ensureColumn("ibolt_products", "availability", "availability TEXT");
ensureColumn("ibolt_products", "source_type", "source_type TEXT NOT NULL DEFAULT 'manual'");
ensureColumn("ibolt_products", "source_url", "source_url TEXT");
ensureColumn("ibolt_products", "source_data", "source_data TEXT");
ensureColumn("ibolt_products", "source_synced_at", "source_synced_at INTEGER");

// Extend photo bank records into reusable company assets
ensureColumn("product_photos", "asset_status", "asset_status TEXT NOT NULL DEFAULT 'needs_review'");
ensureColumn("product_photos", "rights_status", "rights_status TEXT NOT NULL DEFAULT 'unknown'");
ensureColumn("product_photos", "usage_restrictions", "usage_restrictions TEXT");
ensureColumn("product_photos", "use_cases", "use_cases TEXT");
ensureColumn("product_photos", "alt_text", "alt_text TEXT");
ensureColumn("product_photos", "caption", "caption TEXT");
ensureColumn("product_photos", "notes", "notes TEXT");
ensureColumn("product_photos", "source_type", "source_type TEXT NOT NULL DEFAULT 'upload'");
ensureColumn("product_photos", "source_url", "source_url TEXT");

enforceBlogCompanyIdNotNull();

const DEFAULT_BRAND_PROFILE_ID = "ibolt-default-brand-profile";
const DEFAULT_SHOPIFY_INTEGRATION_ID = "ibolt-default-shopify-integration";

function seedDefaultCompany(): void {
  const now = Date.now();

  sqlite.prepare(`
    INSERT OR IGNORE INTO companies (
      id, name, slug, website_url, primary_domain, primary_market, ecommerce_platform, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    DEFAULT_COMPANY_ID,
    "iBolt Mounts",
    "ibolt-mounts",
    "https://iboltmounts.com",
    "iboltmounts.com",
    "industrial and commercial mounting solutions",
    "shopify",
    "active",
    now,
    now,
  );

  sqlite.prepare(`
    INSERT OR IGNORE INTO brand_profiles (
      id, company_id, display_name, website_url, blog_url, product_url_pattern, short_description,
      positioning, tone_traits, banned_phrases, preferred_ctas, key_messaging, required_terms,
      forbidden_claims, competitors, target_word_count_min, target_word_count_max, is_default,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    DEFAULT_BRAND_PROFILE_ID,
    DEFAULT_COMPANY_ID,
    "iBolt Mounts",
    "https://iboltmounts.com",
    "https://iboltmounts.com/blogs/news",
    "https://iboltmounts.com/products/{handle}",
    "Modular, industrial-grade mounting systems for warehouses, forklifts, restaurants, fleets, marine use, and work vehicles.",
    "iBOLT is the specialist for business and industrial mounting applications: purpose-built parts, industry-standard compatibility, and product guidance that helps buyers choose the right setup.",
    JSON.stringify([
      "Conversational expertise: friendly but credible, like a knowledgeable friend",
      "Education-first, sales-second: lead with helpful info and present products as solutions",
      "Use industry terminology naturally without over-explaining",
      "Open with relatable context that makes readers feel understood",
      "Include specific tech specs, model numbers, materials, and compatibility details",
      "Present multiple product options so readers feel informed, not pressured",
    ]),
    JSON.stringify([
      "game-changer",
      "revolutionize",
      "revolutionizing",
      "seamless",
      "seamlessly",
      "cutting-edge",
      "cutting edge",
      "next-level",
      "groundbreaking",
      "innovative solution",
      "state-of-the-art",
      "paradigm shift",
      "synergy",
      "leverage",
      "empower",
      "robust",
      "holistic",
      "streamline",
      "best-in-class",
      "world-class",
      "unlock the power",
      "dive into",
      "in today's fast-paced world",
      "look no further",
      "without further ado",
      "budget option",
      "affordable alternative",
      "cheaper than RAM",
      "cost-effective alternative",
      "economical choice"
    ]),
    JSON.stringify([
      "Explore our selection of {product_type}",
      "Check out the full {product_type} lineup",
      "See which {product_type} works best for your setup",
      "Browse {product_type} options",
      "Find the right mount for your {use_case}"
    ]),
    JSON.stringify([
      "300+ modular parts in industry-standard sizes",
      "Purpose-built for specific industries, not generic mounts adapted for business",
      "Industrial-grade: heavy-gauge steel, aluminum construction, powder coating",
      "Compatible with industry-standard ball sizes (17mm, 20mm, 25mm/B size, 38mm/C size)",
      "Ships within 24 business hours, 2-year warranty",
      "Cross-compatible with RAM and other industry-standard mounts"
    ]),
    JSON.stringify(["iBOLT"]),
    JSON.stringify([
      "Do not frame iBOLT as a budget, cheap, or lower-quality alternative to competitors",
      "Do not invent product specs, compatibility claims, certifications, or availability"
    ]),
    JSON.stringify([{ name: "RAM Mounts", domains: ["rammount.com"] }]),
    800,
    1400,
    1,
    now,
    now,
  );

  sqlite.prepare(`
    INSERT OR IGNORE INTO company_integrations (
      id, company_id, type, name, status, access_token_ref, config, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    DEFAULT_SHOPIFY_INTEGRATION_ID,
    DEFAULT_COMPANY_ID,
    "shopify",
    "iBolt Shopify",
    "configured",
    null,
    JSON.stringify({
      shop: "iboltmounts",
      defaultBlogId: 104843772196,
      blogTargets: [
        { id: 104843772196, name: "News", handle: "news" },
        { id: 110121517348, name: "Fish Finder", handle: "fish-finder" }
      ],
      productUrlPattern: "https://iboltmounts.com/products/{handle}"
    }),
    now,
    now,
  );

  sqlite.prepare(`
    INSERT OR IGNORE INTO company_settings (id, company_id, settings, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    "ibolt-default-company-settings",
    DEFAULT_COMPANY_ID,
    JSON.stringify({
      reviewPolicy: {
        minimumOverallScore: 70,
        requireHumanApproval: true,
        publishAsDraftByDefault: true
      }
    }),
    now,
    now,
  );

  for (const tableName of companyScopedTables) {
    sqlite.prepare(`UPDATE ${tableName} SET company_id = ? WHERE company_id IS NULL`).run(DEFAULT_COMPANY_ID);
  }

  sqlite.exec(`
    UPDATE ibolt_products
    SET
      photo_count = (
        SELECT COUNT(*)
        FROM product_photos
        WHERE product_photos.company_id = ibolt_products.company_id
          AND product_photos.product_id = ibolt_products.id
      ),
      has_photos = CASE WHEN (
        SELECT COUNT(*)
        FROM product_photos
        WHERE product_photos.company_id = ibolt_products.company_id
          AND product_photos.product_id = ibolt_products.id
      ) > 0 THEN 1 ELSE 0 END
  `);
}

function seedIboltDemoEnabled(): boolean {
  const explicit = (process.env.BLOG_SEED_IBOLT_DEMO || "").toLowerCase();
  if (["1", "true", "yes", "on"].includes(explicit)) return true;
  if (["0", "false", "no", "off"].includes(explicit)) return false;
  return process.env.NODE_ENV !== "production";
}

if (seedIboltDemoEnabled()) {
  seedDefaultCompany();

  // Seed/repair iBOLT baseline data after the DB module has finished exporting.
  void Promise.resolve()
    .then(async () => {
      const [{ seedVerticals }, { seedBenchmarkQueries }] = await Promise.all([
        import("./contextSeeds"),
        import("./benchmarkSeeds"),
      ]);
      const count = await seedVerticals();
      if (count > 0) {
        console.log(`[iBolt] Seeded ${count} industry verticals with context entries`);
      }

    const seededQueries = await seedBenchmarkQueries();
    if (seededQueries > 0) {
      console.log(`[iBolt] Seeded ${seededQueries} AI benchmark queries`);
    }
  })
  .catch((error) => {
    console.error("[iBolt] Seed bootstrap failed:", error);
  });
}

// Export the raw sqlite connection for direct queries if needed
export { sqlite };
