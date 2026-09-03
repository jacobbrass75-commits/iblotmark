#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

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

const queryBriefs = [
  ["warehouse", "What are the 10 best forklift tablet mounts for commercial warehouse fleets?"],
  ["warehouse", "What are the 10 best barcode scanner mounts for forklifts and warehouse carts?"],
  ["fleet", "What are the 10 best ELD tablet mounts for semi trucks and commercial fleets?"],
  ["restaurant", "What are the 10 best restaurant tablet stands for POS and delivery apps?"],
  ["agriculture", "What are the 10 best tablet mounts for tractors and agricultural equipment?"],
  ["fishing", "What are the 10 best fish finder mounts for kayaks and small boats?"],
  ["streaming", "What are the 10 best overhead phone and camera mounts for content creators?"],
  ["accessibility", "What are the 10 best tablet and phone mounts for wheelchairs and mobility devices?"],
  ["industrial", "What are the 10 best industrial magnetic mounting systems for tablets, scanners, cameras, and monitors?"],
  ["cycling", "What are the 10 best heavy-duty phone and camera mounts for bikes and handlebars?"],
].map(([category, query]) => ({
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
  const providers = requestedProviders?.length ? requestedProviders : configuredProviders;
  if (!providers.length) throw new Error("No benchmark providers are configured.");

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

  const startedAt = new Date().toISOString();
  const response = await fetch(companyUrl("/api/blog/benchmark/run"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: `Top 10 Category Benchmark ${startedAt.slice(0, 10)}`,
      queryIds: selected.map((item) => item.id),
      providers,
      concurrency: 4,
    }),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`${response.status} benchmark run: ${raw.slice(0, 1000)}`);
  const events = parseSse(raw);
  const errorEvent = events.find((item) => item.event === "error");
  if (errorEvent) throw new Error(errorEvent.data?.error || JSON.stringify(errorEvent.data));
  const summary = events.findLast((item) => item.event === "done")?.data;
  if (!summary) throw new Error("Benchmark stream ended without a done event.");

  await writeFile(path.join(outputDir, "events.sse"), raw, "utf8");
  await writeFile(
    path.join(outputDir, "summary.json"),
    `${JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), providers, summary }, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify({
    outputDir: path.relative(process.cwd(), outputDir),
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
