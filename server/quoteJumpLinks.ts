import { buildTextFingerprint } from "@shared/annotationLinks";

export interface QuoteJumpTarget {
  quote: string;
  jumpPath: string;
}

interface PreparedQuoteJumpTarget extends QuoteJumpTarget {
  fingerprint: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildFlexibleQuotePattern(quote: string): string {
  return escapeRegExp(quote.trim()).replace(/\s+/g, "\\s+");
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[\^[^\]]+\]/g, " ")
    .replace(/[*_~`]+/g, "")
    .replace(/<[^>]+>/g, " ")
    .trim();
}

function normalizeQuotedText(text: string): string {
  return buildTextFingerprint(
    stripInlineMarkdown(text)
      .replace(/[“”]/g, "\"")
      .replace(/[‘’]/g, "'")
  );
}

function isAlreadyLinked(fullText: string, offset: number, length: number): boolean {
  const before = fullText.slice(Math.max(0, offset - 1), offset);
  const after = fullText.slice(offset + length, offset + length + 2);
  return before === "[" && after === "](";
}

function wrapQuotedOccurrences(markdown: string, target: QuoteJumpTarget): { text: string; replacements: number } {
  if (!target.quote.trim() || !target.jumpPath.trim()) {
    return { text: markdown, replacements: 0 };
  }

  const pattern = buildFlexibleQuotePattern(target.quote);
  const quotedPatterns = [
    new RegExp(`(")(${pattern})(")`, "g"),
    new RegExp("(“)(" + pattern + ")(”)", "g"),
    new RegExp(`(')(${pattern})(')`, "g"),
    new RegExp("(‘)(" + pattern + ")(’)", "g"),
  ];

  let replacements = 0;
  let nextText = markdown;

  for (const regex of quotedPatterns) {
    nextText = nextText.replace(regex, (match, open, inner, close, offset, fullText) => {
      const numericOffset = typeof offset === "number" ? offset : 0;
      if (isAlreadyLinked(fullText, numericOffset, match.length)) {
        return match;
      }
      replacements += 1;
      return `[${open}${inner}${close}](${target.jumpPath})`;
    });
  }

  return { text: nextText, replacements };
}

function prepareTargets(targets: QuoteJumpTarget[]): PreparedQuoteJumpTarget[] {
  return dedupeQuoteJumpTargets(targets)
    .map((target) => ({
      ...target,
      fingerprint: normalizeQuotedText(target.quote),
    }))
    .filter((target) => target.fingerprint.length > 0);
}

function findBestJumpTarget(
  quoteText: string,
  targets: PreparedQuoteJumpTarget[]
): PreparedQuoteJumpTarget | null {
  const fingerprint = normalizeQuotedText(quoteText);
  if (fingerprint.length < 12) {
    return null;
  }

  let bestTarget: PreparedQuoteJumpTarget | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const target of targets) {
    if (!target.fingerprint) continue;

    let score = Number.NEGATIVE_INFINITY;
    if (target.fingerprint === fingerprint) {
      score = 3000 - Math.abs(target.fingerprint.length - fingerprint.length);
    } else if (target.fingerprint.includes(fingerprint) && fingerprint.length >= 12) {
      score = 2000 - (target.fingerprint.length - fingerprint.length);
    } else if (fingerprint.includes(target.fingerprint) && target.fingerprint.length >= 12) {
      score = 1500 - (fingerprint.length - target.fingerprint.length);
    }

    if (score > bestScore) {
      bestScore = score;
      bestTarget = target;
    }
  }

  return bestScore > 0 ? bestTarget : null;
}

function wrapMatchedQuotedSpans(
  markdown: string,
  targets: PreparedQuoteJumpTarget[]
): { text: string; replacements: number } {
  const quotedPatterns = [
    /(")([^"\r\n]{8,}?)(")/g,
    /(“)([^”\r\n]{8,}?)(”)/g,
  ];

  let replacements = 0;
  let nextText = markdown;

  for (const regex of quotedPatterns) {
    nextText = nextText.replace(regex, (match, open, inner, close, offset, fullText) => {
      const numericOffset = typeof offset === "number" ? offset : 0;
      if (isAlreadyLinked(fullText, numericOffset, match.length)) {
        return match;
      }

      const bestTarget = findBestJumpTarget(inner, targets);
      if (!bestTarget) {
        return match;
      }

      replacements += 1;
      return `[${open}${inner}${close}](${bestTarget.jumpPath})`;
    });
  }

  return { text: nextText, replacements };
}

export function dedupeQuoteJumpTargets(targets: QuoteJumpTarget[]): QuoteJumpTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const quote = target.quote.trim();
    const jumpPath = target.jumpPath.trim();
    if (!quote || !jumpPath) return false;
    const key = `${quote}::${jumpPath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function applyJumpLinksToMarkdown(markdown: string, targets: QuoteJumpTarget[]): string {
  let result = markdown;
  const preparedTargets = prepareTargets(targets);
  const sortedTargets = [...preparedTargets].sort((left, right) => right.quote.length - left.quote.length);

  for (const target of sortedTargets) {
    const linked = wrapQuotedOccurrences(result, target);
    result = linked.text;
  }

  result = wrapMatchedQuotedSpans(result, preparedTargets).text;

  return result;
}
