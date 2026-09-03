#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import sharp from "sharp";

const repoRoot = resolve(import.meta.dirname, "..");
const brollRoot = resolve(process.env.IBOLT_BROLL_WORK_DIR || join(repoRoot, "assets", "broll"));
const sourceRoot = resolve(process.env.IBOLT_BROLL_SOURCE_DIR || join(brollRoot, "source"));
const manifestPath = join(brollRoot, "drive-manifest.json");
const catalogPath = join(brollRoot, "catalog.json");
const pendingDir = join(brollRoot, "labels", "pending");
const completedDir = join(brollRoot, "labels", "completed");
const labelsIndexPath = join(brollRoot, "labels-index.json");
const supportedExtensions = new Set([".jpg", ".jpeg", ".png"]);
const batchSize = Math.max(1, Number(process.env.IBOLT_BROLL_BATCH_SIZE || 20));

function normalizePath(value) {
  return value.split(sep).join("/").replace(/^\.\//, "");
}

async function atomicJson(path, value) {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

async function walk(dir) {
  const output = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return output;
    throw error;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) output.push(...await walk(fullPath));
    else if (entry.isFile() && supportedExtensions.has(extname(entry.name).toLowerCase())) output.push(fullPath);
  }
  return output;
}

async function sha256File(path) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", rejectHash);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

function orientation(width, height) {
  if (!width || !height) return "unknown";
  if (Math.abs(width - height) / Math.max(width, height) < 0.08) return "square";
  return width > height ? "landscape" : "portrait";
}

function buildManifestMatcher(files) {
  const exact = new Map();
  const byNameAndSize = new Map();
  for (const file of files) {
    const normalized = normalizePath(file.path);
    exact.set(normalized.toLowerCase(), file);
    const key = `${basename(normalized).toLowerCase()}:${file.sizeBytes}`;
    const matches = byNameAndSize.get(key) || [];
    matches.push(file);
    byNameAndSize.set(key, matches);
  }
  return (localRelativePath, sizeBytes) => {
    const normalized = normalizePath(localRelativePath);
    const direct = exact.get(normalized.toLowerCase());
    if (direct) return direct;
    for (const [pathKey, file] of exact) {
      if (pathKey.endsWith(`/${normalized.toLowerCase()}`)) return file;
    }
    const candidates = byNameAndSize.get(`${basename(normalized).toLowerCase()}:${sizeBytes}`) || [];
    return candidates.length === 1 ? candidates[0] : null;
  };
}

async function readCompletedLabels() {
  const labels = [];
  let entries = [];
  try {
    entries = await readdir(completedDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json")).sort((a, b) => a.name.localeCompare(b.name))) {
    const parsed = JSON.parse(await readFile(join(completedDir, entry.name), "utf8"));
    const rows = Array.isArray(parsed) ? parsed : parsed.results;
    if (!Array.isArray(rows)) throw new Error(`${entry.name}: expected an array or { results: [] }`);
    for (const row of rows) labels.push({ ...row, _sourceFile: entry.name });
  }
  return labels;
}

function validateLabel(label) {
  const problems = [];
  if (label?.contractVersion !== "broll.v1") problems.push("contractVersion must equal broll.v1");
  if (!label?.assetId) problems.push("assetId is required");
  if (!/^[a-f0-9]{64}$/.test(label?.sha256 || "")) problems.push("sha256 must be lowercase hex");
  for (const field of ["altText", "caption", "scene"]) if (typeof label?.[field] !== "string" || !label[field].trim()) problems.push(`${field} is required`);
  for (const field of ["verticals", "useCases", "devices", "mountingSurfaces", "blogTopics", "keywords", "productCandidates", "reviewFlags"]) {
    if (!Array.isArray(label?.[field])) problems.push(`${field} must be an array`);
  }
  if (typeof label?.quality?.score !== "number" || label.quality.score < 0 || label.quality.score > 1) problems.push("quality.score must be 0..1");
  if (typeof label?.confidence !== "number" || label.confidence < 0 || label.confidence > 1) problems.push("confidence must be 0..1");
  if (typeof label?.needsReview !== "boolean") problems.push("needsReview must be boolean");
  return problems;
}

async function scanAndBatch() {
  await mkdir(pendingDir, { recursive: true });
  await mkdir(completedDir, { recursive: true });
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const matchManifest = buildManifestMatcher(manifest.files.filter((file) => file.kind === "blog-ready-image"));
  const localFiles = await walk(sourceRoot);
  const seenHashes = new Map();
  const catalog = [];

  for (let index = 0; index < localFiles.length; index += 1) {
    const localPath = localFiles[index];
    const localStat = await stat(localPath);
    const localRelativePath = normalizePath(relative(sourceRoot, localPath));
    const drive = matchManifest(localRelativePath, localStat.size);
    const sha256 = await sha256File(localPath);
    const priorAssetId = seenHashes.get(sha256) || null;
    const metadata = await sharp(localPath, { failOn: "none" }).metadata();
    const assetId = drive?.driveId || `local-${sha256.slice(0, 24)}`;
    if (!priorAssetId) seenHashes.set(sha256, assetId);
    catalog.push({
      assetId,
      sha256,
      sourcePath: localRelativePath,
      localPath,
      driveId: drive?.driveId || null,
      drivePath: drive?.path || null,
      driveUrl: drive?.driveUrl || null,
      mimeType: drive?.mimeType || (extname(localPath).toLowerCase() === ".png" ? "image/png" : "image/jpeg"),
      sizeBytes: localStat.size,
      width: metadata.width || null,
      height: metadata.height || null,
      orientation: orientation(metadata.width, metadata.height),
      duplicateOf: priorAssetId,
    });
    if ((index + 1) % 100 === 0) console.log(`Scanned ${index + 1}/${localFiles.length}`);
  }

  catalog.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
  await atomicJson(catalogPath, {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceRoot,
    sourceManifest: normalizePath(relative(repoRoot, manifestPath)),
    totalAssets: catalog.length,
    uniqueAssets: catalog.filter((asset) => !asset.duplicateOf).length,
    assets: catalog,
  });

  const completedHashes = new Set((await readCompletedLabels()).map((label) => label.sha256));
  const pending = catalog.filter((asset) => !asset.duplicateOf && !completedHashes.has(asset.sha256));
  const batchCount = Math.ceil(pending.length / batchSize);
  for (let index = 0; index < batchCount; index += 1) {
    const batchNumber = index + 1;
    const assets = pending.slice(index * batchSize, (index + 1) * batchSize);
    await atomicJson(join(pendingDir, `batch-${String(batchNumber).padStart(4, "0")}.json`), {
      contractVersion: "broll.v1",
      promptVersion: "ibolt-broll-luna-v1",
      batchId: `ibolt-broll-${String(batchNumber).padStart(4, "0")}`,
      sourceRoot,
      outputFile: normalizePath(relative(repoRoot, join(completedDir, `batch-${String(batchNumber).padStart(4, "0")}.json`))),
      instructions: "View every localPath and return one strict broll.v1 JSON label per asset. Preserve assetId and sha256 exactly. Do not infer rights or auto-approve usage.",
      assets,
    });
  }

  console.log(JSON.stringify({ sourceRoot, scanned: catalog.length, unique: catalog.filter((asset) => !asset.duplicateOf).length, completed: completedHashes.size, pending: pending.length, batches: batchCount }, null, 2));
}

async function mergeLabels() {
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const assetsByHash = new Map(catalog.assets.map((asset) => [asset.sha256, asset]));
  const labels = await readCompletedLabels();
  const merged = new Map();
  const errors = [];
  for (const label of labels) {
    const problems = validateLabel(label);
    const asset = assetsByHash.get(label.sha256);
    if (!asset) problems.push("sha256 is not present in catalog.json");
    if (asset && asset.assetId !== label.assetId) problems.push(`assetId does not match catalog (${asset.assetId})`);
    if (merged.has(label.sha256)) problems.push("duplicate completed label for sha256");
    if (problems.length) errors.push({ file: label._sourceFile, assetId: label.assetId || null, problems });
    else merged.set(label.sha256, { ...label, _sourceFile: undefined });
  }
  if (errors.length) {
    console.error(JSON.stringify({ valid: merged.size, invalid: errors.length, errors }, null, 2));
    process.exitCode = 1;
    return;
  }
  const rows = [...merged.values()].sort((a, b) => a.assetId.localeCompare(b.assetId));
  await atomicJson(labelsIndexPath, { contractVersion: "broll.v1", generatedAt: new Date().toISOString(), count: rows.length, labels: rows });
  console.log(JSON.stringify({ merged: rows.length, output: labelsIndexPath }, null, 2));
}

const command = process.argv[2] || "prepare";
if (command === "prepare" || command === "scan") await scanAndBatch();
else if (command === "merge") await mergeLabels();
else throw new Error(`Unknown command: ${command}. Use prepare, scan, or merge.`);
