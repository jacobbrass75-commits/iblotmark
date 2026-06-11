import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

function getEncryptionKey(): Buffer {
  const configured = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("INTEGRATION_ENCRYPTION_KEY is required in production to store integration tokens.");
  }

  const raw = configured || process.env.JWT_SECRET || "dev-integration-secret";
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptSecret(encrypted: string): string {
  const [version, ivValue, tagValue, ciphertextValue] = encrypted.split(":");
  if (version !== VERSION || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error("Unsupported encrypted secret format.");
  }

  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

export function isAllowedShopifyAccessTokenRef(value: string | null | undefined): value is string {
  if (!value) return false;
  return /^SHOPIFY_COMPANY_[A-Z0-9_]+_ACCESS_TOKEN$/.test(value)
    || /^SHOPIFY_[A-Z0-9_]+_ADMIN_API_ACCESS_TOKEN$/.test(value);
}
