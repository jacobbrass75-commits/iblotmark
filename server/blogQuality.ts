export const DEFAULT_BLOG_QUALITY_GATE = 70;

export function resolveBlogQualityGate(rawValue = process.env.BLOG_QUALITY_GATE): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return DEFAULT_BLOG_QUALITY_GATE;
  return Math.min(100, Math.max(0, parsed));
}

export function shouldRetryBlogVerification(
  overallScore: number,
  qualityGate: number,
): boolean {
  return Number.isFinite(overallScore) && overallScore > 0 && overallScore < qualityGate;
}
