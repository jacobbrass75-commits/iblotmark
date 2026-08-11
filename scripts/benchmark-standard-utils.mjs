import { createHash } from "node:crypto";

export function normalizeBenchmarkText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function stableHash(values) {
  const input = Array.isArray(values) ? [...values].sort().join("\n") : String(values || "");
  return createHash("sha256").update(input).digest("hex");
}

export function buildPrompt(query, manifest) {
  return [...manifest.promptLines, `Query: "${normalizeBenchmarkText(query)}"`].join("\n");
}

export function buildManifestMetadata(manifest) {
  const querySet = manifest.queries.map((item) => normalizeBenchmarkText(item.query).toLowerCase());
  const providers = manifest.providers.map((provider) => normalizeBenchmarkText(provider).toLowerCase());
  const prompts = manifest.queries.map((item) => normalizeBenchmarkText(buildPrompt(item.query, manifest)));
  return {
    standardId: manifest.id,
    protocolVersion: manifest.protocolVersion,
    manifestHash: stableHash(JSON.stringify(manifest)),
    querySetHash: stableHash(querySet),
    providerSetHash: stableHash(providers),
    promptSetHash: stableHash(prompts),
    promptVersion: manifest.promptVersion,
    scorerVersion: manifest.scorerVersion,
  };
}

function unwrapRunDocument(document) {
  return document?.summary?.querySummaries ? document.summary : document;
}

function storedStandardMetadata(run) {
  const summary = run?.run?.summary;
  if (!summary || typeof summary !== "object") return null;
  return summary.benchmarkStandard && typeof summary.benchmarkStandard === "object"
    ? summary.benchmarkStandard
    : null;
}

export function buildRunEnvelope(document) {
  const run = unwrapRunDocument(document) || {};
  const querySummaries = Array.isArray(run.querySummaries) ? run.querySummaries : [];
  const queryTexts = querySummaries.map((item) => normalizeBenchmarkText(item.query).toLowerCase());
  const results = querySummaries.flatMap((item) => (
    (Array.isArray(item.results) ? item.results : []).map((result) => ({
      ...result,
      normalizedQuery: normalizeBenchmarkText(item.query).toLowerCase(),
    }))
  ));
  const declaredProviders = Array.isArray(run.run?.providers) ? run.run.providers : [];
  const providers = Array.from(new Set([
    ...declaredProviders,
    ...results.map((result) => result.provider),
  ].filter(Boolean).map((value) => normalizeBenchmarkText(value).toLowerCase()))).sort();
  const models = Array.from(new Set(results.map((result) => (
    `${normalizeBenchmarkText(result.provider).toLowerCase()}:${normalizeBenchmarkText(result.model)}`
  )))).sort();
  const prompts = Array.from(new Set(results.map((result) => normalizeBenchmarkText(result.prompt)))).sort();
  const completedKeys = results
    .filter((result) => result.status === "completed")
    .map((result) => `${result.normalizedQuery}\u0000${normalizeBenchmarkText(result.provider).toLowerCase()}`);
  const expectedKeys = queryTexts.flatMap((query) => providers.map((provider) => `${query}\u0000${provider}`));
  const completedKeySet = new Set(completedKeys);
  const missingCells = expectedKeys.filter((key) => !completedKeySet.has(key));
  const duplicateCompletedCells = completedKeys.filter((key, index) => completedKeys.indexOf(key) !== index);
  const metadata = storedStandardMetadata(run);

  return {
    runId: run.run?.id || null,
    name: run.run?.name || null,
    status: run.run?.status || null,
    queryCount: queryTexts.length,
    providerCount: providers.length,
    resultCount: results.length,
    completedCount: results.filter((result) => result.status === "completed").length,
    failedCount: results.filter((result) => result.status === "failed").length,
    skippedCount: results.filter((result) => result.status === "skipped").length,
    expectedCellCount: expectedKeys.length,
    querySetHash: stableHash(queryTexts),
    providerSetHash: stableHash(providers),
    promptSetHash: stableHash(prompts),
    modelSetHash: stableHash(models),
    queries: [...queryTexts].sort(),
    providers,
    models,
    prompts,
    missingCells,
    duplicateCompletedCells: Array.from(new Set(duplicateCompletedCells)),
    isComplete: missingCells.length === 0
      && duplicateCompletedCells.length === 0
      && results.length === expectedKeys.length
      && results.every((result) => result.status === "completed"),
    standard: metadata,
  };
}

export function assessRunAgainstManifest(document, manifest) {
  const envelope = buildRunEnvelope(document);
  const expected = buildManifestMetadata(manifest);
  const reasons = [];
  if (envelope.querySetHash !== expected.querySetHash) reasons.push("query set does not match the canonical manifest");
  if (envelope.providerSetHash !== expected.providerSetHash) reasons.push("provider set does not match the canonical manifest");
  if (envelope.promptSetHash !== expected.promptSetHash) reasons.push("prompt set does not match the canonical manifest");
  if (!envelope.isComplete) reasons.push("provider-query result matrix is incomplete or duplicated");
  if (envelope.standard?.standardId && envelope.standard.standardId !== manifest.id) reasons.push("stored standard ID differs from the canonical manifest");
  if (envelope.standard?.scorerVersion && envelope.standard.scorerVersion !== manifest.scorerVersion) reasons.push("stored scorer version differs from the canonical manifest");
  return {
    canonical: reasons.length === 0,
    provisional: reasons.length === 0 && !envelope.standard?.scorerVersion,
    reasons,
    expected,
    envelope,
  };
}

export function assessComparability(currentDocument, previousDocument) {
  const current = buildRunEnvelope(currentDocument);
  const previous = buildRunEnvelope(previousDocument);
  const blockers = [];
  const cautions = [];
  if (current.querySetHash !== previous.querySetHash) blockers.push("query sets differ");
  if (current.providerSetHash !== previous.providerSetHash) blockers.push("provider sets differ");
  if (current.promptSetHash !== previous.promptSetHash) blockers.push("prompt sets differ");
  if (current.modelSetHash !== previous.modelSetHash) blockers.push("provider-model sets differ");
  if (!current.isComplete) blockers.push("current result matrix is incomplete");
  if (!previous.isComplete) blockers.push("previous result matrix is incomplete");

  const currentScorer = current.standard?.scorerVersion;
  const previousScorer = previous.standard?.scorerVersion;
  if (currentScorer && previousScorer && currentScorer !== previousScorer) {
    blockers.push("scorer versions differ");
  } else if (!currentScorer || !previousScorer) {
    cautions.push("one or both runs lack a stored scorer version; comparison is provisional");
  }

  const currentStandard = current.standard?.standardId;
  const previousStandard = previous.standard?.standardId;
  if (currentStandard && previousStandard && currentStandard !== previousStandard) {
    blockers.push("benchmark standard IDs differ");
  } else if (!currentStandard || !previousStandard) {
    cautions.push("one or both runs predate stored benchmark standard metadata");
  }

  return {
    comparable: blockers.length === 0,
    grade: blockers.length > 0 ? "incompatible" : cautions.length > 0 ? "provisional" : "strict",
    blockers,
    cautions,
    current,
    previous,
  };
}
