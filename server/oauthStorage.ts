import { sqlite } from "./db";

export interface OAuthClientRecord {
  clientId: string;
  clientSecretHash: string | null;
  clientName: string;
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  tokenEndpointAuthMethod: string;
  createdAt: number;
}

export interface AuthCodeRecord {
  codeHash: string;
  userId: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  expiresAt: number;
  used: number;
  createdAt: number;
}

export interface McpTokenRecord {
  id: string;
  userId: string;
  clientId: string;
  keyHash: string;
  keyPrefix: string;
  scope: string;
  refreshTokenHash: string | null;
  expiresAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
  createdAt: number;
}

interface OAuthClientRow {
  client_id: string;
  client_secret_hash: string | null;
  client_name: string;
  redirect_uris: string;
  grant_types: string;
  response_types: string;
  token_endpoint_auth_method: string;
  created_at: number;
}

interface AuthCodeRow {
  code_hash: string;
  user_id: string;
  client_id: string;
  redirect_uri: string;
  scope: string;
  code_challenge: string;
  code_challenge_method: string;
  expires_at: number;
  used: number;
  created_at: number;
}

interface McpTokenRow {
  id: string;
  user_id: string;
  client_id: string;
  key_hash: string;
  key_prefix: string;
  scope: string;
  refresh_token_hash: string | null;
  expires_at: number | null;
  last_used_at: number | null;
  revoked_at: number | null;
  created_at: number;
}

const insertOAuthClient = sqlite.prepare(
  `INSERT INTO mcp_oauth_clients (
     client_id,
     client_secret_hash,
     client_name,
     redirect_uris,
     grant_types,
     response_types,
     token_endpoint_auth_method,
     created_at
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);

const selectOAuthClientById = sqlite.prepare(
  `SELECT
      client_id,
      client_secret_hash,
      client_name,
      redirect_uris,
      grant_types,
      response_types,
      token_endpoint_auth_method,
      created_at
   FROM mcp_oauth_clients
   WHERE client_id = ?
   LIMIT 1`
);

const insertAuthCode = sqlite.prepare(
  `INSERT INTO mcp_auth_codes (
     code_hash,
     user_id,
     client_id,
     redirect_uri,
     scope,
     code_challenge,
     code_challenge_method,
     expires_at,
     used,
     created_at
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
);

const selectAuthCodeByHash = sqlite.prepare(
  `SELECT
      code_hash,
      user_id,
      client_id,
      redirect_uri,
      scope,
      code_challenge,
      code_challenge_method,
      expires_at,
      used,
      created_at
   FROM mcp_auth_codes
   WHERE code_hash = ?
   LIMIT 1`
);

const markAuthCodeUsed = sqlite.prepare(
  `UPDATE mcp_auth_codes
   SET used = 1
   WHERE code_hash = ?
     AND used = 0`
);

const cleanupExpiredAuthCodes = sqlite.prepare(
  `DELETE FROM mcp_auth_codes
   WHERE expires_at <= ?`
);

const insertMcpToken = sqlite.prepare(
  `INSERT INTO mcp_tokens (
     id,
     user_id,
     client_id,
     key_hash,
     key_prefix,
     scope,
     refresh_token_hash,
     expires_at,
     created_at
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

const selectActiveMcpTokenByRefreshHash = sqlite.prepare(
  `SELECT
      id,
      user_id,
      client_id,
      key_hash,
      key_prefix,
      scope,
      refresh_token_hash,
      expires_at,
      last_used_at,
      revoked_at,
      created_at
   FROM mcp_tokens
   WHERE refresh_token_hash = ?
     AND revoked_at IS NULL
   LIMIT 1`
);

const revokeMcpTokenByIdStmt = sqlite.prepare(
  `UPDATE mcp_tokens
   SET revoked_at = ?
   WHERE id = ?
     AND revoked_at IS NULL`
);

const revokeMcpTokenByAnyHashStmt = sqlite.prepare(
  `UPDATE mcp_tokens
   SET revoked_at = ?
   WHERE revoked_at IS NULL
     AND (key_hash = ? OR refresh_token_hash = ?)`
);

function parseJsonArray(rawValue: string, fallback: string[]): string[] {
  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return fallback;
    }
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return fallback;
  }
}

function mapOAuthClientRow(row: OAuthClientRow): OAuthClientRecord {
  return {
    clientId: row.client_id,
    clientSecretHash: row.client_secret_hash,
    clientName: row.client_name,
    redirectUris: parseJsonArray(row.redirect_uris, []),
    grantTypes: parseJsonArray(row.grant_types, ["authorization_code"]),
    responseTypes: parseJsonArray(row.response_types, ["code"]),
    tokenEndpointAuthMethod: row.token_endpoint_auth_method,
    createdAt: row.created_at,
  };
}

function mapAuthCodeRow(row: AuthCodeRow): AuthCodeRecord {
  return {
    codeHash: row.code_hash,
    userId: row.user_id,
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    scope: row.scope,
    codeChallenge: row.code_challenge,
    codeChallengeMethod: row.code_challenge_method,
    expiresAt: row.expires_at,
    used: row.used,
    createdAt: row.created_at,
  };
}

function mapMcpTokenRow(row: McpTokenRow): McpTokenRecord {
  return {
    id: row.id,
    userId: row.user_id,
    clientId: row.client_id,
    keyHash: row.key_hash,
    keyPrefix: row.key_prefix,
    scope: row.scope,
    refreshTokenHash: row.refresh_token_hash,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

export function createOAuthClient(input: {
  clientId: string;
  clientSecretHash: string | null;
  clientName: string;
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  tokenEndpointAuthMethod: string;
  createdAt: number;
}): void {
  insertOAuthClient.run(
    input.clientId,
    input.clientSecretHash,
    input.clientName,
    JSON.stringify(input.redirectUris),
    JSON.stringify(input.grantTypes),
    JSON.stringify(input.responseTypes),
    input.tokenEndpointAuthMethod,
    input.createdAt
  );
}

export function getOAuthClientById(clientId: string): OAuthClientRecord | null {
  const row = selectOAuthClientById.get(clientId) as OAuthClientRow | undefined;
  if (!row) return null;
  return mapOAuthClientRow(row);
}

export function createAuthorizationCode(input: {
  codeHash: string;
  userId: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  expiresAt: number;
  createdAt: number;
}): void {
  insertAuthCode.run(
    input.codeHash,
    input.userId,
    input.clientId,
    input.redirectUri,
    input.scope,
    input.codeChallenge,
    input.codeChallengeMethod,
    input.expiresAt,
    input.createdAt
  );
}

const consumeAuthCodeTx = sqlite.transaction((codeHash: string, now: number): AuthCodeRecord | null => {
  const row = selectAuthCodeByHash.get(codeHash) as AuthCodeRow | undefined;
  if (!row) return null;
  if (row.used !== 0) return null;
  if (row.expires_at <= now) return null;

  const updateResult = markAuthCodeUsed.run(codeHash);
  if (updateResult.changes === 0) {
    return null;
  }

  return mapAuthCodeRow(row);
});

export function consumeAuthorizationCode(codeHash: string, now: number): AuthCodeRecord | null {
  return consumeAuthCodeTx(codeHash, now);
}

export function pruneExpiredAuthorizationCodes(now: number): void {
  cleanupExpiredAuthCodes.run(now);
}

export function createMcpToken(input: {
  id: string;
  userId: string;
  clientId: string;
  keyHash: string;
  keyPrefix: string;
  scope: string;
  refreshTokenHash: string | null;
  expiresAt: number | null;
  createdAt: number;
}): void {
  insertMcpToken.run(
    input.id,
    input.userId,
    input.clientId,
    input.keyHash,
    input.keyPrefix,
    input.scope,
    input.refreshTokenHash,
    input.expiresAt,
    input.createdAt
  );
}

export function getActiveMcpTokenByRefreshHash(refreshTokenHash: string): McpTokenRecord | null {
  const row = selectActiveMcpTokenByRefreshHash.get(refreshTokenHash) as McpTokenRow | undefined;
  if (!row) return null;
  return mapMcpTokenRow(row);
}

export function revokeMcpTokenById(id: string, revokedAt: number): void {
  revokeMcpTokenByIdStmt.run(revokedAt, id);
}

export function revokeMcpTokenByAnyHash(hash: string, revokedAt: number): void {
  revokeMcpTokenByAnyHashStmt.run(revokedAt, hash, hash);
}
