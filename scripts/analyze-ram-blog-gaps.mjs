#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import Papa from "papaparse";

const ARCHIVE = "https://rammount.com/pages/blogs";
const OUT = path.resolve("content-output/ram-blog-gap-analysis-2026-08-06");
const IBOLT_CSV = path.resolve("content-output/shopify-blog-performance-check-2026-08-05/shopify-blog-article-inventory.csv");
const CATEGORIES = new Set(["case-study", "news", "customer-spotlight", "mount-of-the-month", "new-products", "product-tips-tricks"]);
const STOP = new Set("the a an and or for to of in on with your our ram mounts mount mounting how why what when from this that new best guide using use into more about is are by at as their its all you we they it product products solution solutions".split(" "));

function decode(value = "") {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&reg;|®/g, "®").replace(/&trade;|™/g, "™").replace(/&#x27;/g, "'").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function meta(html, key, attr = "name") {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+${attr}=["']${escaped}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+${attr}=["']${escaped}["']`, "i"),
  ];
  for (const pattern of patterns) { const match = html.match(pattern); if (match) return decode(match[1]); }
  return "";
}

function tokens(value) {
  return new Set(String(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((token) => token.length > 2 && !STOP.has(token)));
}

function similarity(a, b) {
  const A = tokens(a); const B = tokens(b);
  if (!A.size || !B.size) return 0;
  const overlap = [...A].filter((token) => B.has(token)).length;
  return overlap / Math.min(A.size, B.size);
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 iBOLT content research" } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

const archiveHtml = await fetchText(ARCHIVE);
const cards = [...archiveHtml.matchAll(/<div\s+data-categories=["']([^"']+)["'][^>]*class=["'][^"']*article-card[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi)];
const posts = [];
const seen = new Set();
for (const [, category, card] of cards) {
  const href = card.match(/href=["']([^"']*\/blogs\/[^"']+)["']/i)?.[1];
  const title = decode(card.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] || "");
  const paragraphs = [...card.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => decode(match[1]));
  const description = paragraphs.find((value) => value && value.toLowerCase() !== category.replaceAll("-", " ")) || "";
  if (!href || !title) continue;
  const url = new URL(href, ARCHIVE).href;
  if (seen.has(url)) continue;
  seen.add(url);
  posts.push({ category, title, url, published: "", description });
}
posts.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));

const parsed = Papa.parse(await readFile(IBOLT_CSV, "utf8"), { header: true, skipEmptyLines: true });
const iboltPosts = parsed.data.map((row) => ({ title: row.title, url: row.live_url, published: row.published_at }));
const comparisons = posts.map((post) => {
  const matches = iboltPosts.map((item) => ({ ...item, similarity: similarity(post.title, item.title) })).sort((a, b) => b.similarity - a.similarity);
  return { ...post, closestIboltTitle: matches[0]?.title || "", closestIboltUrl: matches[0]?.url || "", similarity: Number((matches[0]?.similarity || 0).toFixed(3)) };
});

await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, "ram-blog-inventory.csv"), Papa.unparse(posts));
await writeFile(path.join(OUT, "ram-vs-ibolt-title-matches.csv"), Papa.unparse(comparisons));
await writeFile(path.join(OUT, "summary.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), ramArchiveUrl: ARCHIVE, ramPostCount: posts.length, iboltPostCount: iboltPosts.length, byCategory: Object.fromEntries([...new Set(posts.map((p) => p.category))].sort().map((category) => [category, posts.filter((p) => p.category === category).length])) }, null, 2)}\n`);
console.log(JSON.stringify({ ramPostCount: posts.length, iboltPostCount: iboltPosts.length, outputDir: OUT }, null, 2));
