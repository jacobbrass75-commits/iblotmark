const SENSITIVE_KEY_PATTERN = /token|secret|password|authorization|credential|encrypted|api[-_]?key|private[-_]?key|access[-_]?key/i;
const SENSITIVE_VALUE_PATTERN = /^(sk_|pk_live_|shpat_|ghp_|Bearer\s+|Basic\s+|v1:)/i;

export interface ApiResponseSummaryOptions {
  isProduction: boolean;
  maxLength?: number;
}

export function summarizeApiResponseForLog(
  path: string,
  body: unknown,
  options: ApiResponseSummaryOptions,
): string | null {
  if (typeof body === "undefined") return null;
  if (options.isProduction) return null;
  if (isSensitiveResponsePath(path)) return null;

  if ((path === "/api/documents" || path === "/api/documents/meta") && Array.isArray(body)) {
    return `items=${body.length}`;
  }

  const redacted = redactSensitiveValues(body);

  try {
    const serialized = JSON.stringify(redacted);
    if (!serialized) return null;
    const maxLength = options.maxLength ?? 2000;
    if (serialized.length <= maxLength) {
      return serialized;
    }
    return `${serialized.slice(0, maxLength)}...<truncated ${serialized.length - maxLength} chars>`;
  } catch {
    return "[unserializable]";
  }
}

export function isSensitiveResponsePath(path: string): boolean {
  return path.startsWith("/api/auth/api-keys")
    || path.includes("/oauth")
    || path.includes("/integrations")
    || path.includes("/shopify");
}

export function redactSensitiveValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveValues);
  if (!value || typeof value !== "object") return value;

  const redacted: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (shouldRedactEntry(key, item)) {
      redacted[key] = "[redacted]";
    } else {
      redacted[key] = redactSensitiveValues(item);
    }
  }
  return redacted;
}

function shouldRedactEntry(key: string, value: unknown): boolean {
  if (SENSITIVE_KEY_PATTERN.test(key)) return true;
  if (key.toLowerCase() !== "key") return false;
  return typeof value === "string" && SENSITIVE_VALUE_PATTERN.test(value.trim());
}
