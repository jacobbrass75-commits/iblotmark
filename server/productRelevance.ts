const GENERIC_QUERY_TOKENS = new Set([
  "best", "buying", "choose", "choosing", "guide", "ibolt", "mount", "mounts",
  "mounting", "option", "options", "right", "setup", "solution", "solutions",
]);

export interface RelevantProductCandidate {
  id: string;
  title?: string | null;
  handle?: string | null;
  description?: string | null;
  productType?: string | null;
  vendor?: string | null;
  tags?: string[] | null;
  imageUrl?: string | null;
}

function queryTokens(values: string[]): string[] {
  return Array.from(new Set(
    values
      .join(" ")
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4 && !GENERIC_QUERY_TOKENS.has(token)),
  ));
}

/** Rank and cap catalog products before they enter an AI prompt. */
export function rankRelevantProducts<T extends RelevantProductCandidate>(
  candidates: T[],
  queries: string[],
  mappingScores: Map<string, number> = new Map(),
  limit = 12,
): T[] {
  const tokens = queryTokens(queries);
  const phrases = queries.map((value) => value.trim().toLowerCase()).filter((value) => value.length >= 6);
  const ranked = candidates.map((product) => {
    const title = `${product.title || ""} ${product.handle || ""}`.toLowerCase();
    const typeAndTags = `${product.productType || ""} ${(product.tags || []).join(" ")}`.toLowerCase();
    const description = `${product.description || ""} ${product.vendor || ""}`.toLowerCase();
    const allText = `${title} ${typeAndTags} ${description}`;
    let semanticScore = 0;

    for (const token of tokens) {
      if (title.includes(token)) semanticScore += 5;
      else if (typeAndTags.includes(token)) semanticScore += 3;
      else if (description.includes(token)) semanticScore += 1;
    }
    if (phrases.some((phrase) => allText.includes(phrase))) semanticScore += 8;

    return {
      product,
      semanticScore,
      mappingScore: mappingScores.get(product.id) || 0,
      hasImage: product.imageUrl ? 1 : 0,
    };
  });

  const semanticMatches = ranked.filter((item) => item.semanticScore > 0);
  const pool = semanticMatches.length > 0 ? semanticMatches : ranked;
  return pool
    .sort((a, b) =>
      b.semanticScore - a.semanticScore
      || b.mappingScore - a.mappingScore
      || b.hasImage - a.hasImage,
    )
    .slice(0, Math.max(0, limit))
    .map((item) => item.product);
}
