import { createHmac, timingSafeEqual } from "crypto";

type PublicPhotoKind = "serve" | "thumb";

function signingSecret(): string {
  return (
    process.env.PUBLIC_ASSET_SIGNING_SECRET ||
    process.env.INTEGRATION_ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    "dev-public-asset-signing-secret"
  );
}

function payload(companyId: string, photoId: string, kind: PublicPhotoKind): string {
  return `${companyId}:${photoId}:${kind}`;
}

export function signPublicPhotoToken(companyId: string, photoId: string, kind: PublicPhotoKind): string {
  return createHmac("sha256", signingSecret())
    .update(payload(companyId, photoId, kind))
    .digest("base64url");
}

export function verifyPublicPhotoToken(companyId: string, photoId: string, kind: PublicPhotoKind, token: unknown): boolean {
  if (typeof token !== "string" || !token) return false;
  const expected = signPublicPhotoToken(companyId, photoId, kind);
  const left = Buffer.from(token);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function unsignedPublicPhotosAllowed(): boolean {
  return ["1", "true", "yes", "on"].includes((process.env.BLOG_ALLOW_UNSIGNED_PUBLIC_PHOTOS || "").toLowerCase());
}
