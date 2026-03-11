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

// Export the drizzle database instance
export const db = drizzle(sqlite, { schema });

type TableInfoRow = {
  name: string;
};

function indexExists(indexName: string): boolean {
  const row = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ? LIMIT 1")
    .get(indexName);
  return Boolean(row);
}

function tableHasDuplicates(tableName: string, columnName: string): boolean {
  const row = sqlite
    .prepare(
      `SELECT 1
       FROM ${tableName}
       WHERE ${columnName} IS NOT NULL
       GROUP BY ${columnName}
       HAVING COUNT(*) > 1
       LIMIT 1`
    )
    .get();
  return Boolean(row);
}

function ensureBaseTables(): void {
  sqlite.exec(`
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT,
  filename TEXT NOT NULL,
  full_text TEXT NOT NULL,
  upload_date INTEGER NOT NULL,
  user_intent TEXT,
  summary TEXT,
  main_arguments TEXT,
  key_concepts TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ready',
  processing_error TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  username TEXT NOT NULL,
  password TEXT DEFAULT '',
  first_name TEXT,
  last_name TEXT,
  tier TEXT NOT NULL DEFAULT 'free',
  tokens_used INTEGER NOT NULL DEFAULT 0,
  token_limit INTEGER NOT NULL DEFAULT 50000,
  storage_used INTEGER NOT NULL DEFAULT 0,
  storage_limit INTEGER NOT NULL DEFAULT 52428800,
  email_verified INTEGER DEFAULT false,
  billing_cycle_start INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  thesis TEXT,
  scope TEXT,
  context_summary TEXT,
  context_embedding TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  parent_folder_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  context_summary TEXT,
  context_embedding TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS prompt_templates (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  prompts TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_documents (
  id TEXT PRIMARY KEY NOT NULL,
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
  added_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS project_annotations (
  id TEXT PRIMARY KEY NOT NULL,
  project_document_id TEXT NOT NULL,
  start_position INTEGER NOT NULL,
  end_position INTEGER NOT NULL,
  highlighted_text TEXT NOT NULL,
  category TEXT NOT NULL,
  note TEXT,
  is_ai_generated INTEGER DEFAULT true,
  confidence_score REAL,
  prompt_text TEXT,
  prompt_index INTEGER,
  prompt_color TEXT,
  analysis_run_id TEXT,
  searchable_content TEXT,
  search_embedding TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_document_id) REFERENCES project_documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT,
  project_id TEXT,
  title TEXT NOT NULL DEFAULT 'New Chat',
  model TEXT NOT NULL DEFAULT 'claude-opus-4-6',
  writing_model TEXT DEFAULT 'precision',
  selected_source_ids TEXT,
  citation_style TEXT DEFAULT 'chicago',
  tone TEXT DEFAULT 'academic',
  humanize INTEGER DEFAULT true,
  no_en_dashes INTEGER DEFAULT false,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tokens_used INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS text_chunks (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL,
  text TEXT NOT NULL,
  start_position INTEGER NOT NULL,
  end_position INTEGER NOT NULL,
  section_title TEXT,
  embedding TEXT,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL,
  chunk_id TEXT,
  start_position INTEGER NOT NULL,
  end_position INTEGER NOT NULL,
  highlighted_text TEXT NOT NULL,
  category TEXT NOT NULL,
  note TEXT NOT NULL,
  is_ai_generated INTEGER NOT NULL DEFAULT false,
  confidence_score REAL,
  prompt_text TEXT,
  prompt_index INTEGER,
  prompt_color TEXT,
  analysis_run_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS web_clips (
  id TEXT PRIMARY KEY NOT NULL,
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
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (project_document_id) REFERENCES project_documents(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_web_clips_created_at ON web_clips(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_web_clips_project_id ON web_clips(project_id);
CREATE INDEX IF NOT EXISTS idx_web_clips_source_url ON web_clips(source_url);
`);
}

function ensureLegacyCompatibility(): void {
  const webClipColumns = sqlite.prepare("PRAGMA table_info(web_clips)").all() as TableInfoRow[];
  if (!webClipColumns.some((column) => column.name === "user_id")) {
    sqlite.exec("ALTER TABLE web_clips ADD COLUMN user_id TEXT;");
  }
}

function ensureUsersIndexes(): void {
  if (!indexExists("users_username_unique") && !tableHasDuplicates("users", "username")) {
    sqlite.exec("CREATE UNIQUE INDEX users_username_unique ON users(username);");
  }

  if (!indexExists("users_email_unique")) {
    if (!tableHasDuplicates("users", "email")) {
      sqlite.exec("CREATE UNIQUE INDEX users_email_unique ON users(email);");
    } else if (!indexExists("idx_users_email")) {
      // Legacy auth imports can contain duplicate emails for the same real user.
      // Keep startup non-fatal when opening a production snapshot locally.
      sqlite.exec("CREATE INDEX idx_users_email ON users(email);");
    }
  }
}

function ensureSupportTables(): void {
  // Persistent OCR queue and auth tables that are not defined in shared/schema.ts.
  sqlite.exec(`
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT 'Chrome Extension',
  last_used_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);

CREATE TABLE IF NOT EXISTS mcp_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  refresh_token_hash TEXT UNIQUE,
  expires_at INTEGER,
  last_used_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_user_id ON mcp_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_key_hash ON mcp_tokens(key_hash);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_refresh_hash ON mcp_tokens(refresh_token_hash);

CREATE TABLE IF NOT EXISTS mcp_auth_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL DEFAULT 'S256',
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_mcp_auth_codes_user_id ON mcp_auth_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_mcp_auth_codes_client_id ON mcp_auth_codes(client_id);
CREATE INDEX IF NOT EXISTS idx_mcp_auth_codes_expires_at ON mcp_auth_codes(expires_at);

CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_secret_hash TEXT,
  client_name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  grant_types TEXT NOT NULL DEFAULT '["authorization_code"]',
  response_types TEXT NOT NULL DEFAULT '["code"]',
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_clients_created_at ON mcp_oauth_clients(created_at);

CREATE TABLE IF NOT EXISTS analytics_tool_calls (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  project_id TEXT,
  tool_name TEXT NOT NULL,
  document_id TEXT,
  escalation_round INTEGER NOT NULL,
  turn_number INTEGER NOT NULL,
  result_size_chars INTEGER NOT NULL DEFAULT 0,
  success INTEGER NOT NULL DEFAULT 1,
  metadata TEXT,
  timestamp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_context_snapshots (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  turn_number INTEGER NOT NULL,
  escalation_round INTEGER NOT NULL,
  estimated_tokens INTEGER NOT NULL,
  warning_level TEXT NOT NULL DEFAULT 'ok',
  trigger TEXT,
  metadata TEXT,
  timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_atc_timestamp ON analytics_tool_calls(timestamp);
CREATE INDEX IF NOT EXISTS idx_atc_conversation ON analytics_tool_calls(conversation_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_atc_tool_time ON analytics_tool_calls(tool_name, timestamp);
CREATE INDEX IF NOT EXISTS idx_acs_timestamp ON analytics_context_snapshots(timestamp);
CREATE INDEX IF NOT EXISTS idx_acs_conversation ON analytics_context_snapshots(conversation_id, timestamp);

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
}

ensureBaseTables();
ensureLegacyCompatibility();
ensureUsersIndexes();
ensureSupportTables();

// Export the raw sqlite connection for direct queries if needed
export { sqlite };
