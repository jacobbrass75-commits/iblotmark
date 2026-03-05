import type { Express, Request, Response } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { createHash, randomBytes, randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { TIER_LEVELS } from "./auth";
import { getOrCreateUser } from "./authStorage";
import {
  createAuthorizationCode,
  createMcpToken,
  createOAuthClient,
  getActiveMcpTokenByRefreshHash,
  getOAuthClientById,
  pruneExpiredAuthorizationCodes,
  revokeMcpTokenByAnyHash,
  revokeMcpTokenById,
  consumeAuthorizationCode,
} from "./oauthStorage";

const DEFAULT_SCOPES = ["read", "write"];
const ALLOWED_SCOPES = new Set(DEFAULT_SCOPES);
const ALLOWED_CODE_CHALLENGE_METHODS = new Set(["S256"]);
const ALLOWED_TOKEN_AUTH_METHODS = new Set(["none", "client_secret_post"]);
const ACCESS_TOKEN_TTL_SECONDS = Number(process.env.MCP_ACCESS_TOKEN_TTL_SECONDS ?? 3600);
const REFRESH_TOKEN_TTL_SECONDS = Number(process.env.MCP_REFRESH_TOKEN_TTL_SECONDS ?? 90 * 24 * 60 * 60);
const AUTH_CODE_TTL_SECONDS = Number(process.env.MCP_AUTH_CODE_TTL_SECONDS ?? 600);

interface SessionUser {
  userId: string;
  email: string;
  tier: string;
}

interface OAuthClientLike {
  clientId: string;
  clientSecretHash: string | null;
  clientName: string;
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  tokenEndpointAuthMethod: string;
}

interface AuthorizeRequestParams {
  clientId: string;
  redirectUri: string;
  responseType: string;
  scope: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string;
}

const AUTHORIZE_TEMPLATE_PATH = join(process.cwd(), "server", "views", "authorize.html");
let authorizeTemplateCache: string | null = null;

function getUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function hashSha256Hex(rawValue: string): string {
  return createHash("sha256").update(rawValue).digest("hex");
}

function hashSha256Base64Url(rawValue: string): string {
  return createHash("sha256").update(rawValue).digest("base64url");
}

function getIssuerBaseUrl(req: Request): string {
  const configured = process.env.OAUTH_ISSUER || process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL;
  if (configured && configured.trim().length > 0) {
    return configured.replace(/\/+$/, "");
  }

  const forwardedProto = req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || req.protocol || "https";
  const host = req.header("x-forwarded-host") || req.get("host") || "localhost";
  return `${protocol}://${host}`.replace(/\/+$/, "");
}

function getAuthorizeTemplate(): string {
  if (!authorizeTemplateCache) {
    authorizeTemplateCache = readFileSync(AUTHORIZE_TEMPLATE_PATH, "utf8");
  }
  return authorizeTemplateCache;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pickString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

function pickBodyOrQueryString(req: Request, key: string): string {
  const bodyValue = (req.body as Record<string, unknown> | undefined)?.[key];
  if (typeof bodyValue === "string") return bodyValue;
  if (Array.isArray(bodyValue) && typeof bodyValue[0] === "string") return bodyValue[0];

  const queryValue = (req.query as Record<string, unknown> | undefined)?.[key];
  if (typeof queryValue === "string") return queryValue;
  if (Array.isArray(queryValue) && typeof queryValue[0] === "string") return queryValue[0];
  return "";
}

function normalizeScope(scopeValue: string): string {
  const requested = scopeValue
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);

  const uniqueScopes = Array.from(new Set(requested.filter((scope) => ALLOWED_SCOPES.has(scope))));
  if (uniqueScopes.length === 0) return DEFAULT_SCOPES.join(" ");
  return uniqueScopes.join(" ");
}

function normalizeAuthorizeRequestParams(req: Request): AuthorizeRequestParams {
  const scope = normalizeScope(pickBodyOrQueryString(req, "scope"));
  const state = pickBodyOrQueryString(req, "state");
  const resource = pickBodyOrQueryString(req, "resource");

  return {
    clientId: pickBodyOrQueryString(req, "client_id"),
    redirectUri: pickBodyOrQueryString(req, "redirect_uri"),
    responseType: pickBodyOrQueryString(req, "response_type"),
    scope,
    state,
    codeChallenge: pickBodyOrQueryString(req, "code_challenge"),
    codeChallengeMethod: pickBodyOrQueryString(req, "code_challenge_method") || "S256",
    resource,
  };
}

function buildAuthorizeUrl(params: AuthorizeRequestParams): string {
  const search = new URLSearchParams();
  search.set("client_id", params.clientId);
  search.set("redirect_uri", params.redirectUri);
  search.set("response_type", params.responseType);
  search.set("scope", params.scope);
  if (params.state) search.set("state", params.state);
  if (params.codeChallenge) search.set("code_challenge", params.codeChallenge);
  if (params.codeChallengeMethod) search.set("code_challenge_method", params.codeChallengeMethod);
  if (params.resource) search.set("resource", params.resource);
  return `/oauth/authorize?${search.toString()}`;
}

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function isValidRedirectUri(redirectUri: string, client: OAuthClientLike): boolean {
  return client.redirectUris.includes(redirectUri);
}

function redirectWithError(res: Response, redirectUri: string, state: string, error: string, description?: string): void {
  try {
    const redirectTarget = new URL(redirectUri);
    redirectTarget.searchParams.set("error", error);
    if (description) {
      redirectTarget.searchParams.set("error_description", description);
    }
    if (state) {
      redirectTarget.searchParams.set("state", state);
    }
    res.redirect(302, redirectTarget.toString());
  } catch {
    res.status(400).json({ error, error_description: description ?? "Invalid redirect_uri" });
  }
}

function sendOAuthError(res: Response, status: number, error: string, description: string): void {
  res.status(status).json({
    error,
    error_description: description,
  });
}

async function resolveSessionUser(req: Request): Promise<SessionUser | null> {
  const auth = getAuth(req);
  if (!auth?.userId) {
    return null;
  }

  const clerkUser = await clerkClient.users.getUser(auth.userId);
  const email = clerkUser.emailAddresses?.[0]?.emailAddress ?? "";
  const tier = (clerkUser.publicMetadata?.tier as string) || "max";
  await getOrCreateUser(auth.userId, email, tier);

  return {
    userId: auth.userId,
    email,
    tier,
  };
}

function parseStringArray(input: unknown, fallback: string[]): string[] {
  if (!input) return fallback;
  if (Array.isArray(input)) {
    return input.filter((entry): entry is string => typeof entry === "string");
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return fallback;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter((entry): entry is string => typeof entry === "string");
      }
    } catch {
      return trimmed.split(",").map((part) => part.trim()).filter(Boolean);
    }
  }
  return fallback;
}

function mapScopeToDescription(scope: string): string {
  if (scope === "read") {
    return "View projects, documents, and conversations";
  }
  if (scope === "write") {
    return "Create conversations, send messages, and compile papers";
  }
  return "Access your ScholarMark account data";
}

function renderAuthorizeHtml(input: {
  clientName: string;
  userEmail: string;
  clientId: string;
  redirectUri: string;
  responseType: string;
  state: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string;
  tierNotice: string;
}): string {
  const scopes = input.scope.split(/\s+/).filter(Boolean);
  const scopeItems = scopes
    .map((scope) => `<li><strong>${escapeHtml(scope)}</strong> - ${escapeHtml(mapScopeToDescription(scope))}</li>`)
    .join("\n");

  return getAuthorizeTemplate()
    .replace(/{{CLIENT_NAME}}/g, escapeHtml(input.clientName))
    .replace(/{{USER_EMAIL}}/g, escapeHtml(input.userEmail))
    .replace(/{{CLIENT_ID}}/g, escapeHtml(input.clientId))
    .replace(/{{REDIRECT_URI}}/g, escapeHtml(input.redirectUri))
    .replace(/{{RESPONSE_TYPE}}/g, escapeHtml(input.responseType))
    .replace(/{{STATE}}/g, escapeHtml(input.state))
    .replace(/{{SCOPE}}/g, escapeHtml(input.scope))
    .replace(/{{CODE_CHALLENGE}}/g, escapeHtml(input.codeChallenge))
    .replace(/{{CODE_CHALLENGE_METHOD}}/g, escapeHtml(input.codeChallengeMethod))
    .replace(/{{RESOURCE}}/g, escapeHtml(input.resource))
    .replace(/{{SCOPE_ITEMS}}/g, scopeItems || "<li><strong>read</strong> - View projects and conversations</li>")
    .replace(/{{TIER_NOTICE}}/g, input.tierNotice);
}

function parseMetadataClient(rawMetadata: unknown, clientId: string): OAuthClientLike | null {
  if (!rawMetadata || typeof rawMetadata !== "object") return null;
  const metadata = rawMetadata as Record<string, unknown>;

  const metadataClientId = pickString(metadata.client_id);
  if (metadataClientId && metadataClientId !== clientId) {
    return null;
  }

  const redirectUris = parseStringArray(metadata.redirect_uris, []);
  if (redirectUris.length === 0 || !redirectUris.every((uri) => isValidUrl(uri))) {
    return null;
  }

  const tokenEndpointAuthMethod = pickString(metadata.token_endpoint_auth_method) || "none";
  if (tokenEndpointAuthMethod !== "none") {
    return null;
  }

  const clientName = pickString(metadata.client_name) || "Claude Connector";
  const grantTypes = parseStringArray(metadata.grant_types, ["authorization_code", "refresh_token"]);
  const responseTypes = parseStringArray(metadata.response_types, ["code"]);

  return {
    clientId,
    clientSecretHash: null,
    clientName,
    redirectUris,
    grantTypes,
    responseTypes,
    tokenEndpointAuthMethod,
  };
}

async function resolveOAuthClient(clientId: string): Promise<OAuthClientLike | null> {
  const storedClient = getOAuthClientById(clientId);
  if (storedClient) {
    return storedClient;
  }

  if (!isValidUrl(clientId)) {
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(clientId, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return null;
    const metadata = await response.json();
    return parseMetadataClient(metadata, clientId);
  } catch {
    return null;
  }
}

function verifyPkce(codeVerifier: string, codeChallenge: string, codeChallengeMethod: string): boolean {
  if (codeChallengeMethod !== "S256") return false;
  const expectedChallenge = hashSha256Base64Url(codeVerifier);
  return expectedChallenge === codeChallenge;
}

function issueTokenPair(scope: string): {
  accessToken: string;
  refreshToken: string;
  keyHash: string;
  refreshTokenHash: string;
  keyPrefix: string;
  scope: string;
} {
  const accessToken = `mcp_sm_${randomBytes(32).toString("hex")}`;
  const refreshToken = `mcp_rt_${randomBytes(32).toString("hex")}`;
  const keyHash = hashSha256Hex(accessToken);
  const refreshTokenHash = hashSha256Hex(refreshToken);
  return {
    accessToken,
    refreshToken,
    keyHash,
    refreshTokenHash,
    keyPrefix: accessToken.slice(0, 14),
    scope,
  };
}

async function validateTokenClient(req: Request): Promise<{
  ok: boolean;
  client: OAuthClientLike | null;
  error?: { status: number; code: string; description: string };
}> {
  const clientId = pickBodyOrQueryString(req, "client_id");
  if (!clientId) {
    return {
      ok: false,
      client: null,
      error: { status: 401, code: "invalid_client", description: "Missing client_id" },
    };
  }

  const client = await resolveOAuthClient(clientId);
  if (!client) {
    return {
      ok: false,
      client: null,
      error: { status: 401, code: "invalid_client", description: "Unknown client_id" },
    };
  }

  if (!ALLOWED_TOKEN_AUTH_METHODS.has(client.tokenEndpointAuthMethod)) {
    return {
      ok: false,
      client,
      error: { status: 401, code: "invalid_client", description: "Unsupported token_endpoint_auth_method" },
    };
  }

  if (client.tokenEndpointAuthMethod === "client_secret_post") {
    const providedSecret = pickBodyOrQueryString(req, "client_secret");
    if (!providedSecret || !client.clientSecretHash || hashSha256Hex(providedSecret) !== client.clientSecretHash) {
      return {
        ok: false,
        client,
        error: { status: 401, code: "invalid_client", description: "Invalid client credentials" },
      };
    }
  }

  return { ok: true, client };
}

function validateAuthorizeParams(params: AuthorizeRequestParams): { ok: boolean; description?: string } {
  if (!params.clientId) return { ok: false, description: "Missing client_id" };
  if (!params.redirectUri) return { ok: false, description: "Missing redirect_uri" };
  if (!params.responseType) return { ok: false, description: "Missing response_type" };
  if (params.responseType !== "code") return { ok: false, description: "Unsupported response_type" };
  if (!params.codeChallenge) return { ok: false, description: "Missing code_challenge" };
  if (!ALLOWED_CODE_CHALLENGE_METHODS.has(params.codeChallengeMethod)) {
    return { ok: false, description: "Unsupported code_challenge_method" };
  }
  return { ok: true };
}

function buildAuthorizationCodeRedirect(
  redirectUri: string,
  state: string,
  authorizationCode: string,
): string {
  const redirectTarget = new URL(redirectUri);
  redirectTarget.searchParams.set("code", authorizationCode);
  if (state) {
    redirectTarget.searchParams.set("state", state);
  }
  return redirectTarget.toString();
}

export function registerOAuthRoutes(app: Express): void {
  app.get("/.well-known/oauth-authorization-server", (req: Request, res: Response) => {
    const issuer = getIssuerBaseUrl(req);
    return res.json({
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: DEFAULT_SCOPES,
      client_id_metadata_document_supported: true,
    });
  });

  app.post("/oauth/register", async (req: Request, res: Response) => {
    try {
      const clientNameInput = pickString(req.body?.client_name).trim();
      const redirectUris = parseStringArray(req.body?.redirect_uris, []);
      const tokenEndpointAuthMethod = pickString(req.body?.token_endpoint_auth_method) || "none";
      const grantTypes = parseStringArray(req.body?.grant_types, ["authorization_code", "refresh_token"]);
      const responseTypes = parseStringArray(req.body?.response_types, ["code"]);

      if (!clientNameInput) {
        return sendOAuthError(res, 400, "invalid_client_metadata", "client_name is required");
      }
      if (redirectUris.length === 0) {
        return sendOAuthError(res, 400, "invalid_redirect_uri", "At least one redirect URI is required");
      }
      if (!redirectUris.every((uri) => isValidUrl(uri))) {
        return sendOAuthError(res, 400, "invalid_redirect_uri", "All redirect URIs must be valid absolute URLs");
      }
      if (!ALLOWED_TOKEN_AUTH_METHODS.has(tokenEndpointAuthMethod)) {
        return sendOAuthError(res, 400, "invalid_client_metadata", "Unsupported token_endpoint_auth_method");
      }

      const clientId = `mcp_client_${randomUUID()}`;
      const clientSecret = tokenEndpointAuthMethod === "client_secret_post"
        ? randomBytes(32).toString("hex")
        : null;
      const clientSecretHash = clientSecret ? hashSha256Hex(clientSecret) : null;
      const createdAt = getUnixSeconds();

      createOAuthClient({
        clientId,
        clientSecretHash,
        clientName: clientNameInput,
        redirectUris,
        grantTypes,
        responseTypes,
        tokenEndpointAuthMethod,
        createdAt,
      });

      return res.status(201).json({
        client_id: clientId,
        client_secret: clientSecret ?? undefined,
        client_name: clientNameInput,
        redirect_uris: redirectUris,
        grant_types: grantTypes,
        response_types: responseTypes,
        token_endpoint_auth_method: tokenEndpointAuthMethod,
      });
    } catch (error) {
      console.error("OAuth client registration error:", error);
      return sendOAuthError(res, 500, "server_error", "Failed to register OAuth client");
    }
  });

  app.get("/oauth/authorize", async (req: Request, res: Response) => {
    try {
      const params = normalizeAuthorizeRequestParams(req);
      const decision = pickBodyOrQueryString(req, "decision");
      const paramValidation = validateAuthorizeParams(params);
      if (!paramValidation.ok) {
        return res.status(400).json({ error: "invalid_request", error_description: paramValidation.description });
      }

      const client = await resolveOAuthClient(params.clientId);
      if (!client) {
        return res.status(400).json({ error: "invalid_client", error_description: "Unknown client_id" });
      }
      if (!isValidRedirectUri(params.redirectUri, client)) {
        return res.status(400).json({ error: "invalid_redirect_uri", error_description: "redirect_uri is not allowed" });
      }

      const sessionUser = await resolveSessionUser(req);
      if (!sessionUser) {
        const redirectUrl = `/sign-in?redirect_url=${encodeURIComponent(req.originalUrl)}`;
        return res.redirect(302, redirectUrl);
      }

      if (decision) {
        if (decision !== "approve") {
          return redirectWithError(
            res,
            params.redirectUri,
            params.state,
            "access_denied",
            "The user denied the request"
          );
        }

        const authorizationCode = randomBytes(32).toString("hex");
        const now = getUnixSeconds();

        createAuthorizationCode({
          codeHash: hashSha256Hex(authorizationCode),
          userId: sessionUser.userId,
          clientId: params.clientId,
          redirectUri: params.redirectUri,
          scope: params.scope,
          codeChallenge: params.codeChallenge,
          codeChallengeMethod: params.codeChallengeMethod,
          expiresAt: now + AUTH_CODE_TTL_SECONDS,
          createdAt: now,
        });

        pruneExpiredAuthorizationCodes(now);

        // Keep callback redirect strictly GET for maximum client compatibility.
        return res.redirect(303, buildAuthorizationCodeRedirect(params.redirectUri, params.state, authorizationCode));
      }

      const userTierLevel = TIER_LEVELS[sessionUser.tier] ?? 0;
      const proTierLevel = TIER_LEVELS.pro ?? 1;
      const tierNotice = userTierLevel < proTierLevel
        ? "<p class=\"notice warning\">Note: Chat, compile, and verify endpoints require a Pro plan. Authorization can still proceed.</p>"
        : "";

      const html = renderAuthorizeHtml({
        clientName: client.clientName,
        userEmail: sessionUser.email,
        clientId: params.clientId,
        redirectUri: params.redirectUri,
        responseType: params.responseType,
        state: params.state,
        scope: params.scope,
        codeChallenge: params.codeChallenge,
        codeChallengeMethod: params.codeChallengeMethod,
        resource: params.resource,
        tierNotice,
      });

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(html);
    } catch (error) {
      console.error("OAuth authorize page error:", error);
      return sendOAuthError(res, 500, "server_error", "Failed to render authorization page");
    }
  });

  app.post("/oauth/authorize", async (req: Request, res: Response) => {
    try {
      const params = normalizeAuthorizeRequestParams(req);
      const decision = pickBodyOrQueryString(req, "decision");
      const paramValidation = validateAuthorizeParams(params);
      if (!paramValidation.ok) {
        return res.status(400).json({ error: "invalid_request", error_description: paramValidation.description });
      }

      const client = await resolveOAuthClient(params.clientId);
      if (!client) {
        return res.status(400).json({ error: "invalid_client", error_description: "Unknown client_id" });
      }
      if (!isValidRedirectUri(params.redirectUri, client)) {
        return res.status(400).json({ error: "invalid_redirect_uri", error_description: "redirect_uri is not allowed" });
      }

      const sessionUser = await resolveSessionUser(req);
      if (!sessionUser) {
        const redirectUrl = `/sign-in?redirect_url=${encodeURIComponent(buildAuthorizeUrl(params))}`;
        return res.redirect(302, redirectUrl);
      }

      if (decision !== "approve") {
        return redirectWithError(
          res,
          params.redirectUri,
          params.state,
          "access_denied",
          "The user denied the request"
        );
      }

      const authorizationCode = randomBytes(32).toString("hex");
      const now = getUnixSeconds();

      createAuthorizationCode({
        codeHash: hashSha256Hex(authorizationCode),
        userId: sessionUser.userId,
        clientId: params.clientId,
        redirectUri: params.redirectUri,
        scope: params.scope,
        codeChallenge: params.codeChallenge,
        codeChallengeMethod: params.codeChallengeMethod,
        expiresAt: now + AUTH_CODE_TTL_SECONDS,
        createdAt: now,
      });

      pruneExpiredAuthorizationCodes(now);

      // Use 303 so clients never replay POST against the callback endpoint.
      return res.redirect(303, buildAuthorizationCodeRedirect(params.redirectUri, params.state, authorizationCode));
    } catch (error) {
      console.error("OAuth authorize decision error:", error);
      return sendOAuthError(res, 500, "server_error", "Failed to process authorization decision");
    }
  });

  app.post("/oauth/token", async (req: Request, res: Response) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Pragma", "no-cache");

      const grantType = pickBodyOrQueryString(req, "grant_type");
      const clientValidation = await validateTokenClient(req);
      if (!clientValidation.ok || !clientValidation.client) {
        const error = clientValidation.error ?? {
          status: 401,
          code: "invalid_client",
          description: "Client authentication failed",
        };
        return sendOAuthError(res, error.status, error.code, error.description);
      }
      const client = clientValidation.client;

      if (grantType === "authorization_code") {
        const code = pickBodyOrQueryString(req, "code");
        const redirectUri = pickBodyOrQueryString(req, "redirect_uri");
        const codeVerifier = pickBodyOrQueryString(req, "code_verifier");
        const requestedClientId = pickBodyOrQueryString(req, "client_id");

        if (!code || !redirectUri || !codeVerifier || !requestedClientId) {
          return sendOAuthError(res, 400, "invalid_request", "Missing required authorization_code parameters");
        }

        const now = getUnixSeconds();
        const authCode = consumeAuthorizationCode(hashSha256Hex(code), now);
        if (!authCode) {
          return sendOAuthError(res, 400, "invalid_grant", "Authorization code is invalid, expired, or already used");
        }
        if (authCode.clientId !== client.clientId || authCode.redirectUri !== redirectUri) {
          return sendOAuthError(res, 400, "invalid_grant", "Authorization code does not match client or redirect URI");
        }
        if (!verifyPkce(codeVerifier, authCode.codeChallenge, authCode.codeChallengeMethod)) {
          return sendOAuthError(res, 400, "invalid_grant", "PKCE verification failed");
        }

        const tokenPair = issueTokenPair(authCode.scope || DEFAULT_SCOPES.join(" "));
        createMcpToken({
          id: randomUUID(),
          userId: authCode.userId,
          clientId: authCode.clientId,
          keyHash: tokenPair.keyHash,
          keyPrefix: tokenPair.keyPrefix,
          scope: tokenPair.scope,
          refreshTokenHash: tokenPair.refreshTokenHash,
          expiresAt: now + ACCESS_TOKEN_TTL_SECONDS,
          createdAt: now,
        });

        return res.status(200).json({
          access_token: tokenPair.accessToken,
          token_type: "Bearer",
          expires_in: ACCESS_TOKEN_TTL_SECONDS,
          refresh_token: tokenPair.refreshToken,
          scope: tokenPair.scope,
        });
      }

      if (grantType === "refresh_token") {
        const refreshToken = pickBodyOrQueryString(req, "refresh_token");
        if (!refreshToken) {
          return sendOAuthError(res, 400, "invalid_request", "Missing refresh_token");
        }

        const refreshTokenHash = hashSha256Hex(refreshToken);
        const existingToken = getActiveMcpTokenByRefreshHash(refreshTokenHash);
        if (!existingToken) {
          return sendOAuthError(res, 400, "invalid_grant", "Refresh token is invalid");
        }
        if (existingToken.clientId !== client.clientId) {
          return sendOAuthError(res, 400, "invalid_grant", "Refresh token does not belong to this client");
        }

        const now = getUnixSeconds();
        if (existingToken.createdAt + REFRESH_TOKEN_TTL_SECONDS <= now) {
          revokeMcpTokenById(existingToken.id, now);
          return sendOAuthError(res, 400, "invalid_grant", "Refresh token has expired");
        }

        revokeMcpTokenById(existingToken.id, now);

        const tokenPair = issueTokenPair(existingToken.scope || DEFAULT_SCOPES.join(" "));
        createMcpToken({
          id: randomUUID(),
          userId: existingToken.userId,
          clientId: existingToken.clientId,
          keyHash: tokenPair.keyHash,
          keyPrefix: tokenPair.keyPrefix,
          scope: tokenPair.scope,
          refreshTokenHash: tokenPair.refreshTokenHash,
          expiresAt: now + ACCESS_TOKEN_TTL_SECONDS,
          createdAt: now,
        });

        return res.status(200).json({
          access_token: tokenPair.accessToken,
          token_type: "Bearer",
          expires_in: ACCESS_TOKEN_TTL_SECONDS,
          refresh_token: tokenPair.refreshToken,
          scope: tokenPair.scope,
        });
      }

      return sendOAuthError(res, 400, "unsupported_grant_type", "Unsupported grant_type");
    } catch (error) {
      console.error("OAuth token error:", error);
      return sendOAuthError(res, 500, "server_error", "Failed to issue token");
    }
  });

  app.post("/oauth/revoke", (req: Request, res: Response) => {
    try {
      const token = pickBodyOrQueryString(req, "token");
      if (token) {
        revokeMcpTokenByAnyHash(hashSha256Hex(token), getUnixSeconds());
      }
      return res.status(200).send("");
    } catch (error) {
      console.error("OAuth revoke error:", error);
      return res.status(200).send("");
    }
  });
}
