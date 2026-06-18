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

const GENERIC_BRAND_SUFFIXES = [
  "mount",
  "mounts",
  "product",
  "products",
  "company",
  "co",
  "inc",
  "llc",
  "ltd",
  "corp",
  "corporation",
];

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length >= 3)));
}

export function deriveBrandAliasVariants(alias: string): string[] {
  const normalized = alias.replace(/[^a-z0-9\s.-]/gi, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const words = normalized.split(/[\s.-]+/).filter(Boolean);
  const variants = [
    normalized,
    normalized.replace(/[\s-]+/g, ""),
    normalized.replace(/[\s-]+/g, " "),
  ];

  if (words.length > 1) {
    const withoutSuffix = [...words];
    while (
      withoutSuffix.length > 1 &&
      GENERIC_BRAND_SUFFIXES.includes((withoutSuffix[withoutSuffix.length - 1] || "").toLowerCase())
    ) {
      withoutSuffix.pop();
    }

    if (withoutSuffix.length !== words.length) {
      variants.push(withoutSuffix.join(" "), withoutSuffix.join(""));
    }
  }

  const compact = normalized.replace(/[^a-z0-9]/gi, "");
  variants.push(compact);
  for (const suffix of GENERIC_BRAND_SUFFIXES) {
    if (compact.toLowerCase().endsWith(suffix) && compact.length > suffix.length + 2) {
      variants.push(compact.slice(0, -suffix.length));
    }
  }

  return dedupe(variants);
}
