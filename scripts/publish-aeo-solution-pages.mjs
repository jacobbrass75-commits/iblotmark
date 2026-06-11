#!/usr/bin/env node

import { existsSync, openAsBlob, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE_DIR = path.resolve("content-output/aeo-solution-pages-2026-06-08");
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const SHOP = getEnv("SHOPIFY_SHOP", "iboltmounts").replace(/\.myshopify\.com$/i, "");
const TOKEN = getEnv("SHOPIFY_ACCESS_TOKEN");
const REST_BASE = `https://${SHOP}.myshopify.com/admin/api/${API_VERSION}`;
const GRAPHQL_URL = `${REST_BASE}/graphql.json`;
const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_FILE_UPLOAD = process.argv.includes("--skip-file-upload");

function getEnv(key, fallback = "") {
  if (process.env[key]) return process.env[key];
  const envPath = path.resolve(".env");
  if (!existsSync(envPath)) return fallback;
  const match = readFileSync(envPath, "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!match) return fallback;
  return match[1].trim().replace(/^["']|["']$/g, "");
}

async function shopifyRest(method, endpoint, body) {
  const response = await fetch(`${REST_BASE}/${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    throw new Error(`Shopify REST ${method} ${endpoint} failed: ${response.status} ${text}`);
  }
  return { json, headers: response.headers };
}

async function shopifyGraphql(query, variables = {}) {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await response.json();
  if (!response.ok || json.errors) {
    throw new Error(`Shopify GraphQL failed: ${JSON.stringify(json.errors || json)}`);
  }
  return json.data;
}

async function uploadFileToShopify({ filePath, filename, alt }) {
  const staged = await shopifyGraphql(
    `mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters { name value }
        }
        userErrors { field message }
      }
    }`,
    {
      input: [
        {
          filename,
          mimeType: "image/png",
          resource: "FILE",
          httpMethod: "POST",
        },
      ],
    },
  );
  const stagedErrors = staged.stagedUploadsCreate.userErrors || [];
  if (stagedErrors.length) {
    throw new Error(`stagedUploadsCreate failed: ${JSON.stringify(stagedErrors)}`);
  }
  const target = staged.stagedUploadsCreate.stagedTargets[0];
  const form = new FormData();
  for (const param of target.parameters) {
    form.append(param.name, param.value);
  }
  form.append("file", await openAsBlob(filePath, { type: "image/png" }), filename);

  const uploadResponse = await fetch(target.url, { method: "POST", body: form });
  if (!uploadResponse.ok) {
    throw new Error(`Staged upload failed: ${uploadResponse.status} ${await uploadResponse.text()}`);
  }

  const created = await shopifyGraphql(
    `mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          id
          fileStatus
          alt
          ... on MediaImage {
            image { url width height }
          }
        }
        userErrors { field message }
      }
    }`,
    {
      files: [
        {
          originalSource: target.resourceUrl,
          contentType: "IMAGE",
          alt,
        },
      ],
    },
  );
  const fileErrors = created.fileCreate.userErrors || [];
  if (fileErrors.length) {
    throw new Error(`fileCreate failed: ${JSON.stringify(fileErrors)}`);
  }
  const file = created.fileCreate.files[0];
  if (file?.image?.url) return { id: file.id, url: file.image.url, fileStatus: file.fileStatus };

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const data = await shopifyGraphql(
      `query fileStatus($id: ID!) {
        file(id: $id) {
          id
          fileStatus
          ... on MediaImage {
            image { url width height }
          }
        }
      }`,
      { id: file.id },
    );
    const current = data.file;
    if (current?.image?.url) return { id: current.id, url: current.image.url, fileStatus: current.fileStatus };
    if (current?.fileStatus === "FAILED") throw new Error(`Shopify file processing failed for ${file.id}`);
  }
  throw new Error(`Shopify file did not finish processing: ${file.id}`);
}

async function listAllPages() {
  const pages = [];
  let endpoint = "pages.json?limit=250";
  for (let page = 0; page < 10 && endpoint; page += 1) {
    const { json, headers } = await shopifyRest("GET", endpoint);
    pages.push(...(json?.pages || []));
    const link = headers.get("link") || "";
    const next = link.match(/<https:\/\/[^/]+\/admin\/api\/[^/]+\/([^>]+)>;\s*rel="next"/);
    endpoint = next ? next[1] : "";
  }
  return pages;
}

function withCdnAsset(html, cdnUrl) {
  if (cdnUrl) {
    return html.replace(/\.\.\/assets\/modular-clamp-components-broll\.png/g, cdnUrl);
  }
  return html.replace(
    /<figure class="aeo-hero-image">\s*<img src="\.\.\/assets\/modular-clamp-components-broll\.png"[\s\S]*?<\/figure>\s*/g,
    "",
  );
}

function updatePayloadBody(payload, cdnUrl) {
  payload.page.body_html = withCdnAsset(payload.page.body_html, cdnUrl);
  delete payload.page.published;
  payload.page.published_at = new Date().toISOString();
  return payload;
}

async function main() {
  if (!TOKEN) throw new Error("SHOPIFY_ACCESS_TOKEN is not configured.");
  const manifest = JSON.parse(readFileSync(path.join(BASE_DIR, "manifest.json"), "utf8"));
  const resultsDir = path.join(BASE_DIR, "live");
  const backupDir = path.join(resultsDir, "backups");
  await mkdir(resultsDir, { recursive: true });
  await mkdir(backupDir, { recursive: true });

  let brollUpload = null;
  const uploadManifestPath = path.join(resultsDir, "shopify-file-uploads.json");
  if (existsSync(uploadManifestPath)) {
    const previous = JSON.parse(readFileSync(uploadManifestPath, "utf8"));
    brollUpload = previous.modularClampComponents || null;
  }

  if (!brollUpload && !SKIP_FILE_UPLOAD) {
    const filePath = path.join(BASE_DIR, "assets/modular-clamp-components-broll.png");
    if (existsSync(filePath)) {
      if (DRY_RUN) {
        brollUpload = { dryRun: true, url: "DRY_RUN_SHOPIFY_FILE_URL" };
      } else {
        brollUpload = await uploadFileToShopify({
          filePath,
          filename: "ibolt-modular-clamp-components-broll.png",
          alt: "Workbench with phone clamps, screw bases, ball mounts, and socket arms",
        });
      }
      await writeFile(
        uploadManifestPath,
        JSON.stringify({ modularClampComponents: brollUpload, uploadedAt: new Date().toISOString() }, null, 2),
      );
    }
  }

  const existingPages = DRY_RUN ? [] : await listAllPages();
  const byHandle = new Map(existingPages.map((page) => [page.handle, page]));
  const publishResults = [];

  for (const item of manifest.pages) {
    const payloadPath = path.join(BASE_DIR, "payloads", `${item.slug}.shopify-page-payload.json`);
    const payload = updatePayloadBody(JSON.parse(readFileSync(payloadPath, "utf8")), brollUpload?.url || "");
    const existing = byHandle.get(item.slug);
    const requestBody = { page: payload.page };
    let result;
    if (DRY_RUN) {
      result = {
        action: existing ? "would_update" : "would_create",
        pageId: existing?.id || null,
        handle: item.slug,
        url: `https://iboltmounts.com/pages/${item.slug}`,
      };
    } else if (existing) {
      const { json: previous } = await shopifyRest("GET", `pages/${existing.id}.json`);
      await writeFile(
        path.join(backupDir, `${item.slug}.before.json`),
        JSON.stringify(previous, null, 2),
      );
      const { json } = await shopifyRest("PUT", `pages/${existing.id}.json`, requestBody);
      result = {
        action: "updated",
        pageId: json.page.id,
        handle: json.page.handle,
        title: json.page.title,
        url: `https://iboltmounts.com/pages/${json.page.handle}`,
        publishedAt: json.page.published_at,
      };
    } else {
      const { json } = await shopifyRest("POST", "pages.json", requestBody);
      result = {
        action: "created",
        pageId: json.page.id,
        handle: json.page.handle,
        title: json.page.title,
        url: `https://iboltmounts.com/pages/${json.page.handle}`,
        publishedAt: json.page.published_at,
      };
    }
    publishResults.push(result);
    await writeFile(path.join(resultsDir, `${item.slug}.final-payload.json`), JSON.stringify(requestBody, null, 2));
  }

  const summary = {
    publishedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    apiVersion: API_VERSION,
    shop: SHOP,
    brollUpload,
    pages: publishResults,
  };
  await writeFile(path.join(resultsDir, "shopify-page-publish-results.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
