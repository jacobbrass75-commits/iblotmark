#!/usr/bin/env node

import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const sourceDir = path.resolve(
  process.argv.find((arg) => arg.startsWith("--source="))?.slice("--source=".length)
    || "content-output/top-10-category-program-2026-08-05/drafts",
);
const outputPath = path.resolve(
  process.argv.find((arg) => arg.startsWith("--output="))?.slice("--output=".length)
    || "content-output/top-10-category-program-2026-08-05/comparison-qa.json",
);
const checkLinks = process.argv.includes("--check-links");

const expectedSlugs = new Set([
  "barcode-scanner-mounts-spec-comparison",
  "best-heavy-duty-bike-phone-mounts",
  "best-overhead-phone-mounts-for-content-creators",
  "best-eld-tablet-mounts-commercial-fleets",
  "best-fish-finder-mounts-kayaks-boats",
  "best-forklift-tablet-mounts-warehouses",
  "best-industrial-magnetic-mounts-top-10",
  "best-restaurant-tablet-stands-pos",
  "best-tractor-tablet-mounts",
  "best-wheelchair-tablet-mounts",
]);

const bannedPhrases = [
  "game-changer", "revolutionize", "seamless", "cutting-edge", "next-level",
  "groundbreaking", "innovative solution", "state-of-the-art", "paradigm shift",
  "synergy", "leverage", "empower", "robust", "holistic", "streamline",
  "best-in-class", "world-class", "unlock the power", "dive into",
  "in today's fast-paced world", "look no further", "without further ado",
  "budget option", "budget-minded ibolt", "affordable alternative", "cheaper than ram",
  "cost-effective alternative", "economical choice",
];

function plainWordCount(markdown) {
  return markdown
    .replace(/^Meta (?:Title|Description):.*$/gm, "")
    .replace(/^Slug:.*$/gm, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}

function linksIn(markdown) {
  const links = [];
  for (const match of markdown.matchAll(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/g)) links.push(match[1]);
  for (const match of markdown.matchAll(/(?:href|src)="(https?:\/\/[^"]+)"/g)) links.push(match[1]);
  return [...new Set(links)];
}

function rankingLinks(markdown) {
  const sections = markdown.split(/^###\s+\d+\.\s+/m).slice(1);
  const sectionLinks = sections.map((section) => (
    section.match(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/)?.[1]
      || section.match(/href="(https?:\/\/[^"]+)"/)?.[1]
      || ""
  ));
  const tableLinks = new Map();
  for (const match of markdown.matchAll(/^\|\s*(\d+)\s*\|\s*\[[^\]]+\]\((https?:\/\/[^)]+)\)/gm)) {
    tableLinks.set(Number(match[1]), match[2]);
  }
  return Array.from({ length: 10 }, (_, index) => sectionLinks[index] || tableLinks.get(index + 1) || "");
}

async function checkUrl(url) {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 iBOLT editorial link audit" },
      signal: AbortSignal.timeout(15000),
    });
    return {
      url,
      status: response.status,
      ok: response.ok || response.status === 403,
      accessNote: response.status === 403 ? "official page blocks automated requests" : null,
      finalUrl: response.url,
    };
  } catch (error) {
    return { url, status: 0, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function mapConcurrent(items, concurrency, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

const files = (await readdir(sourceDir)).filter((name) => /^top-10-.*\.md$/.test(name)).sort();
const results = [];
const allLinks = new Set();

for (const filename of files) {
  const markdown = await readFile(path.join(sourceDir, filename), "utf8");
  const lower = markdown.toLowerCase();
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || "";
  const metaTitle = markdown.match(/^Meta Title:\s*(.+)$/m)?.[1]?.trim() || "";
  const metaDescription = markdown.match(/^Meta Description:\s*(.+)$/m)?.[1]?.trim() || "";
  const slug = markdown.match(/^Slug:\s*(.+)$/m)?.[1]?.trim() || "";
  const rankedLinks = rankingLinks(markdown);
  const competitorRankings = rankedLinks.filter((url) => url && !new URL(url).hostname.endsWith("iboltmounts.com"));
  const iboltRankings = rankedLinks.filter((url) => url && new URL(url).hostname.endsWith("iboltmounts.com"));
  const links = linksIn(markdown);
  const faqCount = [...markdown.matchAll(/^\*\*(.+?\?)\*\*\s+.+$/gm)].length;
  links.forEach((url) => allLinks.add(url));
  const issues = [];
  const wordCount = plainWordCount(markdown);
  if (wordCount < 800 || wordCount > 1400) issues.push(`word count ${wordCount} is outside 800-1400`);
  if (metaTitle.length >= 60) issues.push(`meta title length ${metaTitle.length}`);
  if (metaDescription.length >= 155) issues.push(`meta description length ${metaDescription.length}`);
  if (!expectedSlugs.has(slug)) issues.push(`unexpected or changed slug: ${slug}`);
  if (/[—–]/.test(markdown)) issues.push("contains an em dash or en dash");
  for (const phrase of bannedPhrases) if (lower.includes(phrase)) issues.push(`banned phrase: ${phrase}`);
  if (!/(?:editorial )?disclosure/i.test(markdown)) issues.push("missing editorial disclosure");
  if (!/(?:how we ranked|methodology)/i.test(markdown)) issues.push("missing methodology");
  if (!/physically test/i.test(markdown)) issues.push("missing physical-test disclosure");
  if (!/^## Key Verdict$/m.test(markdown)) issues.push("missing Key Verdict section");
  if (faqCount < 4) issues.push(`FAQ count ${faqCount}, expected at least 4`);
  if (rankedLinks.length !== 10 || rankedLinks.some((url) => !url)) issues.push(`ranking links ${rankedLinks.filter(Boolean).length}/10`);
  if (competitorRankings.length < 5) issues.push(`competitor rankings ${competitorRankings.length}, expected at least 5`);
  if (iboltRankings.length < 3 || iboltRankings.length > 5) issues.push(`iBOLT rankings ${iboltRankings.length}, expected 3-5`);
  const imageCount = (markdown.match(/<img\s/gi) || []).length;
  if (imageCount < 2 || imageCount > 4) issues.push(`image count ${imageCount}, expected 2-4`);
  if (/top 10 ibolt/i.test(title)) issues.push("title still frames the list as iBOLT-only");
  results.push({ filename, title, slug, wordCount, metaTitleLength: metaTitle.length, metaDescriptionLength: metaDescription.length, competitorRankings: competitorRankings.length, iboltRankings: iboltRankings.length, imageCount, faqCount, issues, links });
}

const linkChecks = checkLinks ? await mapConcurrent([...allLinks], 8, checkUrl) : [];
const badLinks = linkChecks.filter((item) => !item.ok);
for (const result of results) {
  const fileBadLinks = badLinks.filter((item) => result.links.includes(item.url));
  if (fileBadLinks.length) result.issues.push(...fileBadLinks.map((item) => `link check ${item.status || "error"}: ${item.url}`));
}

const report = {
  checkedAt: new Date().toISOString(),
  sourceDir: path.relative(process.cwd(), sourceDir),
  articleCount: results.length,
  passed: results.filter((item) => !item.issues.length).length,
  failed: results.filter((item) => item.issues.length).length,
  linksChecked: linkChecks.length,
  badLinks,
  results,
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  outputPath: path.relative(process.cwd(), outputPath),
  articleCount: report.articleCount,
  passed: report.passed,
  failed: report.failed,
  linksChecked: report.linksChecked,
  badLinks: report.badLinks.length,
  results: results.map(({ filename, wordCount, competitorRankings, iboltRankings, imageCount, faqCount, issues }) => ({ filename, wordCount, competitorRankings, iboltRankings, imageCount, faqCount, issues })),
}, null, 2));
if (report.failed) process.exitCode = 1;
