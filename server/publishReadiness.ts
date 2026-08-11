import type { LintReport } from "./contentLinter";

export interface PublishReadinessPost {
  status: string;
  overallScore: number | null;
}

export interface PublishReadinessResult {
  ready: boolean;
  errors: string[];
}

export function assessPublishReadiness(
  post: PublishReadinessPost,
  lintReport: LintReport,
  qualityGate: number,
): PublishReadinessResult {
  const errors: string[] = [];

  if (!['approved', 'published'].includes(post.status)) {
    errors.push(`Post status must be approved before publishing; current status is ${post.status}.`);
  }

  if (!Number.isFinite(post.overallScore) || Number(post.overallScore) < qualityGate) {
    errors.push(`Verification score must be at least ${qualityGate}; current score is ${post.overallScore ?? 'missing'}.`);
  }

  if (!lintReport.passed) {
    const rules = Array.from(new Set(lintReport.errors.map((issue) => issue.rule)));
    errors.push(`Content lint has blocking errors${rules.length > 0 ? `: ${rules.join(', ')}` : '.'}`);
  }

  return { ready: errors.length === 0, errors };
}
