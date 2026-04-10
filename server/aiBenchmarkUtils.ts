function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  return normalizeForComparison(text)
    .split(" ")
    .filter((token) => token.length > 2);
}

export function computeSimilarity(a: string, b: string): number {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  const aTokenList = Array.from(aTokens);
  const bTokenList = Array.from(bTokens);
  let intersection = 0;
  for (const token of aTokenList) {
    if (bTokens.has(token)) intersection++;
  }
  const union = new Set(aTokenList.concat(bTokenList)).size;
  return union === 0 ? 0 : intersection / union;
}

export function toTitleCase(text: string): string {
  return text.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}
