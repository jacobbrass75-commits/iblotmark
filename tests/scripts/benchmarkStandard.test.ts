import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assessComparability,
  assessRunAgainstManifest,
  buildManifestMetadata,
} from "../../scripts/benchmark-standard-utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(readFileSync(
  path.join(root, "benchmarks/ai-visibility-top10-v1.json"),
  "utf8",
));

function runDocument(options: {
  query?: string;
  queryId?: string;
  provider?: string;
  model?: string;
  status?: string;
  metadata?: Record<string, string> | null;
} = {}) {
  const query = options.query || manifest.queries[0].query;
  const provider = options.provider || manifest.providers[0];
  return {
    run: {
      id: "run-1",
      name: "test",
      status: "completed",
      providers: [provider],
      summary: options.metadata ? { benchmarkStandard: options.metadata } : {},
    },
    querySummaries: [{
      queryId: options.queryId || "query-1",
      query,
      results: [{
        queryId: options.queryId || "query-1",
        provider,
        model: options.model || "fixed-model",
        prompt: [
          ...manifest.promptLines,
          `Query: "${query}"`,
        ].join("\n"),
        status: options.status || "completed",
      }],
    }],
  };
}

describe("benchmark standard", () => {
  it("matches equivalent runs by normalized query text instead of database IDs", () => {
    const metadata = buildManifestMetadata(manifest);
    const previous = runDocument({ queryId: "old-id", metadata });
    const current = runDocument({ queryId: "new-id", metadata });

    const result = assessComparability(current, previous);

    expect(result.comparable).toBe(true);
    expect(result.grade).toBe("strict");
  });

  it("blocks deltas when a provider-query cell failed", () => {
    const previous = runDocument();
    const current = runDocument({ status: "failed" });

    const result = assessComparability(current, previous);

    expect(result.comparable).toBe(false);
    expect(result.blockers).toContain("current result matrix is incomplete");
  });

  it("blocks deltas when query panels differ", () => {
    const previous = runDocument();
    const current = runDocument({ query: "a different buyer query" });

    const result = assessComparability(current, previous);

    expect(result.comparable).toBe(false);
    expect(result.blockers).toContain("query sets differ");
  });

  it("recognizes both preserved August Top-10 runs as canonical but provisional", () => {
    const before = JSON.parse(readFileSync(path.join(
      root,
      "content-output/top-10-category-program-2026-08-05/benchmark/summary.json",
    ), "utf8"));
    const after = JSON.parse(readFileSync(path.join(
      root,
      "content-output/top-10-category-program-2026-08-05/benchmark-post-ai-pickup/summary.json",
    ), "utf8"));

    const beforeCheck = assessRunAgainstManifest(before, manifest);
    const afterCheck = assessRunAgainstManifest(after, manifest);
    const comparison = assessComparability(after, before);

    expect(beforeCheck.canonical).toBe(true);
    expect(afterCheck.canonical).toBe(true);
    expect(comparison.comparable).toBe(true);
    expect(comparison.grade).toBe("provisional");
  });
});
