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

// Persistent OCR queue for crash-safe background processing.
sqlite.exec(`
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

// Export the raw sqlite connection for direct queries if needed
export { sqlite };
