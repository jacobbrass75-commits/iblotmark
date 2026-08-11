#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assessRunAgainstManifest,
  buildManifestMetadata,
} from "./benchmark-standard-utils.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(scriptDir, "../benchmarks/ai-visibility-top10-v1.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const standardMetadata = buildManifestMetadata(manifest);

const baseUrl = process.env.IBOLT_MARK_URL || "http://localhost:5001";
const companyId = process.env.DEFAULT_COMPANY_ID || "ibolt-default-company";
const outputDir = path.resolve(
  process.argv.find((arg) => arg.startsWith("--output="))?.slice("--output=".length)
    || `content-output/top-10-category-program-${new Date().toISOString().slice(0, 10)}/benchmark`,
);
const requestedProviders = process.argv
  .find((arg) => arg.startsWith("--providers="))
  ?.slice("--providers=".length)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const queryBriefs = manifest.queries.map(({ category, query }) => ({
  category,
  query,
  benchmarkGoal: "Measure unaided iBOLT visibility for a specification-based Top 10 commercial buyer guide.",
  persona: "Commercial buyer comparing durable device-mounting systems",
  painPoint: "Needs a stable, serviceable mount with clear fitment and complete configured price",
  brandAngle: "Evaluate iBOLT as a modular commercial-duty specialist and smart total-value choice without unsupported superiority claims.",
  priority: 240,
}));

function companyUrl(pathname) {
  const url = new URL(pathname, baseUrl);
  url.searchParams.set("companyId", companyId);
  return url;
}

async function request(pathname, options = {}) {
  const response = await fetch(companyUrl(pathname), {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${pathname}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

function parseSse(raw) {
  return raw
    .split(/\n\n+/)
    .map((block) => {
      const event = block.match(/^event:\s*(.+)$/m)?.[1];
      const data = block.match(/^data:\s*(.+)$/m)?.[1];
      if (!event || !data) return null;
      try {
        return { event, data: JSON.parse(data) };
      } catch {
        return { event, data };
      }
    })
    .filter(Boolean);
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  const providerStatus = await request("/api/blog/benchmark/providers");
  const configuredProviders = Object.entries(providerStatus)
    .filter(([, configured]) => configured)
    .map(([provider]) => provider);
  const providers = requestedProviders?.length ? requestedProviders : manifest.providers;
  const unavailable = providers.filter((provider) => !configuredProviders.includes(provider));
  if (unavailable.length > 0) {
    throw new Error(`Required benchmark providers are not configured: ${unavailable.join(", ")}`);
  }
  const nonstandardProviderSelection = providers.length !== manifest.providers.length
    || providers.some((provider) => !manifest.providers.includes(provider));
  if (nonstandardProviderSelection) {
    throw new Error(`Provider overrides are not comparable. Use the canonical set: ${manifest.providers.join(", ")}`);
  }

  const existing = await request("/api/blog/benchmark/queries");
  const byQuery = new Map(existing.map((item) => [item.query.trim().toLowerCase(), item]));
  const selected = [];
  for (const brief of queryBriefs) {
    const key = brief.query.toLowerCase();
    let row = byQuery.get(key);
    if (!row) {
      row = await request("/api/blog/benchmark/queries", {
        method: "POST",
        body: JSON.stringify(brief),
      });
      byQuery.set(key, row);
    }
    selected.push(row);
  }

  await writeFile(
    path.join(outputDir, "queries.json"),
    `${JSON.stringify(selected, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(outputDir, "benchmark-manifest.json"),
    `${JSON.stringify({ ...manifest, ...standardMetadata }, null, 2)}\n`,
    "utf8",
  );

  const startedAt = new Date().toISOString();
  const response = await fetch(companyUrl("/api/blog/benchmark/run"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: `Top 10 Category Benchmark ${startedAt.slice(0, 10)}`,
      queryIds: selected.map((item) => item.id),
      providers,
      concurrency: manifest.concurrency,
      benchmarkStandard: standardMetadata,
    }),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`${response.status} benchmark run: ${raw.slice(0, 1000)}`);
  const events = parseSse(raw);
  const errorEvent = events.find((item) => item.event === "error");
  if (errorEvent) throw new Error(errorEvent.data?.error || JSON.stringify(errorEvent.data));
  const summary = events.findLast((item) => item.event === "done")?.data;
  if (!summary) throw new Error("Benchmark stream ended without a done event.");
  const standardCheck = assessRunAgainstManifest(summary, manifest);

  await writeFile(path.join(outputDir, "events.sse"), raw, "utf8");
  await writeFile(
    path.join(outputDir, "summary.json"),
    `${JSON.stringify({
      startedAt,
      finishedAt: new Date().toISOString(),
      providers,
      benchmarkStandard: standardMetadata,
      standardCheck: {
        canonical: standardCheck.canonical,
        provisional: standardCheck.provisional,
        reasons: standardCheck.reasons,
        envelope: standardCheck.envelope,
      },
      summary,
    }, null, 2)}\n`,
    "utf8",
  );
  if (!standardCheck.canonical) {
    throw new Error(`Run completed but failed the canonical protocol: ${standardCheck.reasons.join("; ")}`);
  }
  console.log(JSON.stringify({
    outputDir: path.relative(process.cwd(), outputDir),
    standardId: manifest.id,
    manifestHash: standardMetadata.manifestHash,
    providers,
    queryCount: selected.length,
    run: summary.run,
    providerSummaries: summary.providerSummaries,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
