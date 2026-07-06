import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const DB_PATH = "data/sourceannotator.db";
const BLOG_SITEMAP_URL = "https://iboltmounts.com/sitemap_blogs_1.xml";

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "best", "by", "for", "from", "guide", "how", "in", "is",
  "it", "mount", "mounts", "of", "on", "or", "the", "to", "vs", "with", "without", "your",
]);

const CATEGORIES = [
  { name: "delivery", terms: ["delivery", "doordash", "uber eats", "grubhub", "instacart", "amazon flex", "grocery"] },
  { name: "restaurant", terms: ["restaurant", "pos", "tablet tower", "multi tablet", "food truck", "quick service", "square", "toast"] },
  { name: "fishing", terms: ["fish finder", "kayak", "boat", "marine", "garmin striker", "pontoon", "rough water"] },
  { name: "fleet", terms: ["fleet", "eld", "truck", "trucking", "commercial vehicle", "work truck", "van"] },
  { name: "warehouse", terms: ["forklift", "warehouse", "material handling", "vesa"] },
  { name: "streaming", terms: ["stream", "livestream", "camera", "overhead", "content creator", "product photography", "cooking videos"] },
  { name: "amps/modular", terms: ["amps", "modular", "ball mount", "mounting plate", "clamp", "clip", "screw", "socket"] },
  { name: "kitchen/home", terms: ["kitchen", "recipe", "counter", "home", "cooking"] },
  { name: "travel", terms: ["road trip", "travel", "headrest", "rv", "rental car", "nintendo switch"] },
  { name: "cycling", terms: ["bike", "bicycle", "cycling", "mountain bike", "handlebar", "trail riding"] },
  { name: "education", terms: ["school", "classroom", "student", "bus"] },
  { name: "agriculture", terms: ["tractor", "agriculture", "farm"] },
  { name: "offroad", terms: ["jeep", "utv", "off-road", "offroad", "overlanding", "gopro"] },
];

const CURATED_EXPANDED_PROMPTS = [
  ["best tablet mount for kitchen recipes", "kitchen/home"],
  ["best iPad stand for kitchen counter recipes", "kitchen/home"],
  ["wall mount tablet holder for kitchen recipe apps", "kitchen/home"],
  ["best overhead phone mount for cooking videos", "kitchen/home"],
  ["best tablet mount for home workout equipment", "kitchen/home"],
  ["best headrest tablet mount for road trips", "travel"],
  ["best Nintendo Switch headrest mount for road trips", "travel"],
  ["best tablet mount for RV road trips", "travel"],
  ["best phone mount for rental cars and road trips", "travel"],
  ["tablet holder for kids in back seat road trips", "travel"],
  ["best phone mount for mountain biking", "cycling"],
  ["best GoPro mount for mountain bike handlebars", "cycling"],
  ["heavy duty bike phone holder for trail riding", "cycling"],
  ["clamp mount for bicycle handlebars", "cycling"],
  ["phone mount for e-bike delivery riders", "cycling"],
  ["best tablet mount for tractor cab precision agriculture", "agriculture"],
  ["best phone mount for farm equipment", "agriculture"],
  ["rugged tablet mount for UTV farm use", "agriculture"],
  ["GPS tablet mount for tractors and sprayers", "agriculture"],
  ["best tablet mount for school bus fleet", "education"],
  ["locking tablet stand for classroom checkout", "education"],
  ["tablet mount for classroom video recording", "education"],
  ["rugged tablet mount for student transportation", "education"],
  ["best tablet mount for Jeep trail navigation", "offroad"],
  ["best phone mount for UTV roll cage", "offroad"],
  ["best GoPro mount for overlanding rigs", "offroad"],
  ["best action camera mount for Jeep trails", "offroad"],
  ["best phone stand for live streaming", "streaming"],
  ["best table camera mount for product videos", "streaming"],
  ["phone stand for streaming cooking videos", "streaming"],
  ["overhead camera mount for product photography", "streaming"],
  ["AMPS mounting system explained", "amps/modular"],
  ["AMPS mounting plate for Garmin fish finder", "amps/modular"],
  ["ball and socket mount system for tablets", "amps/modular"],
  ["phone clamp clip screw ball and socket mount guide", "amps/modular"],
];

const BRANDS = [
  { name: "RAM Mounts", type: "mount competitor", patterns: ["ram mounts", "ram mount", "\\bram\\b"] },
  { name: "ProClip", type: "mount competitor", patterns: ["proclip"] },
  { name: "Arkon", type: "mount competitor", patterns: ["arkon"] },
  { name: "Tackform", type: "mount competitor", patterns: ["tackform"] },
  { name: "iOttie", type: "consumer mount competitor", patterns: ["iottie"] },
  { name: "Quad Lock", type: "consumer mount competitor", patterns: ["quad lock", "quadlock"] },
  { name: "Scosche", type: "consumer mount competitor", patterns: ["scosche"] },
  { name: "Rokform", type: "consumer mount competitor", patterns: ["rokform"] },
  { name: "Peak Design", type: "consumer mount competitor", patterns: ["peak design"] },
  { name: "SP Connect", type: "consumer mount competitor", patterns: ["sp connect"] },
  { name: "Nite Ize", type: "consumer mount competitor", patterns: ["nite ize", "niteize"] },
  { name: "Lamicall", type: "stand competitor", patterns: ["lamicall"] },
  { name: "LISEN", type: "stand competitor", patterns: ["\\blisen\\b"] },
  { name: "UGREEN", type: "stand competitor", patterns: ["ugreen"] },
  { name: "Belkin", type: "stand competitor", patterns: ["belkin"] },
  { name: "Mount-It", type: "commercial stand competitor", patterns: ["mount-it", "mount it"] },
  { name: "Bouncepad", type: "commercial stand competitor", patterns: ["bouncepad"] },
  { name: "Square", type: "pos ecosystem", patterns: ["square stand", "\\bsquare\\b"] },
  { name: "Brodit", type: "vehicle mount competitor", patterns: ["brodit"] },
  { name: "OtterBox", type: "adjacent accessory", patterns: ["otterbox", "otter box"] },
  { name: "YakAttack", type: "marine competitor", patterns: ["yakattack"] },
  { name: "Railblaza", type: "marine competitor", patterns: ["railblaza"] },
  { name: "Scotty", type: "marine competitor", patterns: ["scotty"] },
  { name: "SeaSucker", type: "marine/vehicle competitor", patterns: ["seasucker", "sea sucker"] },
  { name: "Garmin", type: "adjacent device brand", patterns: ["garmin"] },
  { name: "Lowrance", type: "adjacent device brand", patterns: ["lowrance"] },
  { name: "Humminbird", type: "adjacent device brand", patterns: ["humminbird", "hummingbird"] },
];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function compactWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function pct(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

function providerLabel(provider) {
  if (provider === "chatgpt") return "ChatGPT";
  if (provider === "gemini_plain") return "Gemini";
  if (provider === "claude") return "Claude";
  return provider;
}

function tokenize(value) {
  return compactWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

function overlapScore(a, b) {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (!aTokens.size || !bTokens.size) return 0;
  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) intersection += 1;
  }
  return intersection / Math.sqrt(aTokens.size * bTokens.size);
}

function regexFor(pattern) {
  return new RegExp(pattern.includes("\\") ? pattern : `\\b${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
}

function mentionsIbolt(text) {
  return /\bi[\s-]?bolt\b|iboltmounts|ibolt mounts/i.test(text || "");
}

function detectBrands(text) {
  const found = [];
  for (const brand of BRANDS) {
    if (brand.patterns.some((pattern) => regexFor(pattern).test(text || ""))) {
      found.push(brand);
    }
  }
  return found;
}

function classifyCategory(text, primaryText = "") {
  const lower = compactWhitespace(text).toLowerCase();
  const primary = compactWhitespace(primaryText).toLowerCase();
  const matches = CATEGORIES
    .map((category) => ({
      name: category.name,
      count: category.terms.reduce((sum, term) => {
        return sum + (lower.includes(term) ? 1 : 0) + (primary.includes(term) ? 3 : 0);
      }, 0),
    }))
    .filter((category) => category.count > 0)
    .sort((a, b) => b.count - a.count);
  return matches[0]?.name || "other";
}

function sqliteJson(sql) {
  const output = execFileSync("sqlite3", ["-json", DB_PATH, sql], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  }).trim();
  return output ? JSON.parse(output) : [];
}

function parseXmlLocs(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
}

async function latestBenchmarkDir() {
  const outputRoot = path.join(process.cwd(), OUTPUT_ROOT);
  const entries = await readdir(outputRoot, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("openrouter-ai-benchmark-"))
    .map((entry) => entry.name)
    .sort();
  if (!dirs.length) throw new Error("No OpenRouter benchmark output directory found.");
  return path.join(outputRoot, dirs[dirs.length - 1]);
}

function svgShell(width, height, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
  <style>
    .bg{fill:#f8fafc}.panel{fill:#fff;stroke:#d7dee8;stroke-width:1}.title{font:700 24px Arial,sans-serif;fill:#111827}.subtitle{font:400 14px Arial,sans-serif;fill:#64748b}.label{font:700 13px Arial,sans-serif;fill:#111827}.small{font:400 12px Arial,sans-serif;fill:#475569}.value{font:700 13px Arial,sans-serif;fill:#0f172a}
  </style>
  <rect class="bg" width="${width}" height="${height}"/>
  ${body}
</svg>`;
}

function barChart({ title, subtitle, rows, color = "#2563eb", width = 1120 }) {
  const rowH = 42;
  const height = 122 + rows.length * rowH + 34;
  const left = 390;
  const barW = width - left - 130;
  const top = 104;
  const bars = rows.map((row, index) => {
    const y = top + index * rowH;
    const value = Number(row.value || 0);
    const max = Number(row.max || 100);
    const w = max ? Math.max(3, Math.round((value / max) * barW)) : 3;
    return `
      <text class="label" x="52" y="${y + 16}">${escapeHtml(row.label)}</text>
      <text class="small" x="52" y="${y + 34}">${escapeHtml(row.note || "")}</text>
      <rect x="${left}" y="${y}" width="${barW}" height="24" rx="8" fill="#e2e8f0"/>
      <rect x="${left}" y="${y}" width="${w}" height="24" rx="8" fill="${color}"/>
      <text class="value" x="${left + barW + 14}" y="${y + 17}">${escapeHtml(row.display ?? value)}</text>
    `;
  }).join("\n");
  return svgShell(width, height, `
    <rect class="panel" x="28" y="24" width="${width - 56}" height="${height - 48}" rx="14"/>
    <text class="title" x="52" y="64">${escapeHtml(title)}</text>
    <text class="subtitle" x="52" y="87">${escapeHtml(subtitle)}</text>
    ${bars}
  `);
}

function buildCompetitorAnalysis(current) {
  const answers = current.querySummaries.flatMap((query) =>
    query.results.map((result) => {
      const raw = result.rawResponse || "";
      const brandMention = Boolean(result.brandMentioned || result.targetBrandMentioned || mentionsIbolt(raw));
      const competitors = detectBrands(raw);
      return { query, result, raw, brandMention, competitors };
    })
  );

  const byBrand = new Map();
  for (const answer of answers) {
    for (const brand of answer.competitors) {
      const bucket = byBrand.get(brand.name) || {
        brand: brand.name,
        type: brand.type,
        answerCount: 0,
        coMentionWithIbolt: 0,
        competitorOnly: 0,
        providers: new Map(),
        categories: new Map(),
        exampleQueries: [],
      };
      bucket.answerCount += 1;
      if (answer.brandMention) bucket.coMentionWithIbolt += 1;
      else bucket.competitorOnly += 1;
      bucket.providers.set(answer.result.provider, (bucket.providers.get(answer.result.provider) || 0) + 1);
      bucket.categories.set(answer.query.category, (bucket.categories.get(answer.query.category) || 0) + 1);
      if (bucket.exampleQueries.length < 4 && !bucket.exampleQueries.includes(answer.query.query)) {
        bucket.exampleQueries.push(answer.query.query);
      }
      byBrand.set(brand.name, bucket);
    }
  }

  const rows = [...byBrand.values()]
    .sort((a, b) => b.answerCount - a.answerCount || b.competitorOnly - a.competitorOnly)
    .map((bucket) => ({
      brand: bucket.brand,
      type: bucket.type,
      answerCount: bucket.answerCount,
      coMentionWithIbolt: bucket.coMentionWithIbolt,
      competitorOnly: bucket.competitorOnly,
      providers: [...bucket.providers.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => `${providerLabel(name)} ${count}`).join("; "),
      categories: [...bucket.categories.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name} ${count}`).join("; "),
      exampleQueries: bucket.exampleQueries,
    }));

  const competitorOnlyAnswers = answers
    .filter((answer) => !answer.brandMention && answer.competitors.length)
    .map((answer) => ({
      provider: answer.result.provider,
      query: answer.query.query,
      category: answer.query.category,
      competitors: answer.competitors.map((brand) => brand.name),
      score: answer.result.coverageScore || 0,
    }));

  return { answers, rows, competitorOnlyAnswers };
}

function buildBlogInventory(blogPosts, sitemapUrls) {
  const sitemapHandles = new Set(sitemapUrls.map((url) => url.split("/").pop()).filter(Boolean));
  const posts = blogPosts.map((post) => {
    const body = `${post.title || ""} ${post.slug || ""} ${post.html || ""} ${post.markdown || ""}`;
    const primary = `${post.title || ""} ${post.slug || ""}`;
    return {
      ...post,
      category: classifyCategory(body, primary),
      hasShopifyArticle: Boolean(post.shopify_article_id),
      slugInSitemap: sitemapHandles.has(post.slug),
      titleText: post.title || "",
      slugText: post.slug || "",
      bodyText: compactWhitespace(post.html || post.markdown || "").slice(0, 5000),
    };
  });
  const byCategory = new Map();
  for (const post of posts) {
    const bucket = byCategory.get(post.category) || { category: post.category, postCount: 0, liveCount: 0, avgScore: 0 };
    bucket.postCount += 1;
    bucket.liveCount += post.hasShopifyArticle ? 1 : 0;
    bucket.avgScore += Number(post.overall_score || 0);
    byCategory.set(post.category, bucket);
  }
  const categoryRows = [...byCategory.values()].map((bucket) => ({
    ...bucket,
    avgScore: bucket.postCount ? Math.round(bucket.avgScore / bucket.postCount) : 0,
  })).sort((a, b) => b.postCount - a.postCount);

  return { posts, categoryRows };
}

function mapQueriesToPosts(querySummaries, posts) {
  return querySummaries.map((query) => {
    const queryText = `${query.query} ${query.label || ""} ${query.painPoint || ""}`;
    const scored = posts.map((post) => ({
      title: post.title,
      slug: post.slug,
      category: post.category,
      status: post.status,
      hasShopifyArticle: post.hasShopifyArticle,
      titleScore: overlapScore(queryText, post.titleText),
      slugScore: overlapScore(queryText, post.slugText),
      bodyScore: overlapScore(queryText, post.bodyText),
    })).map((post) => ({
      ...post,
      score: Math.max(post.titleScore, post.slugScore * 0.95, post.bodyScore * 0.55),
    })).sort((a, b) => b.score - a.score).slice(0, 5);
    const best = scored[0] || null;
    const coverage = !best || best.score < 0.22 ? "missing" : best.score < 0.55 ? "partial" : "strong";
    return {
      query: query.query,
      category: query.category,
      averageScore: query.averageScore,
      averageMentionRate: query.averageMentionRate,
      weakestProviders: query.weakestProviders,
      contentCoverage: coverage,
      bestPost: best,
      topPosts: scored,
    };
  }).sort((a, b) => a.averageScore - b.averageScore);
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = Array.isArray(value) ? value.join("; ") : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function csv(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function cleanPromptFromTitle(title) {
  return compactWhitespace(title)
    .replace(/\(20\d{2}[^)]*\)/gi, "")
    .replace(/\bcomplete guide\b/gi, "guide")
    .replace(/\s*:\s*/g, ": ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.$/, "");
}

function priorityForCategory(category) {
  if (["delivery", "restaurant", "fishing", "fleet"].includes(category)) return 90;
  if (["warehouse", "amps/modular", "streaming", "kitchen/home", "travel", "cycling"].includes(category)) return 82;
  return 70;
}

function buildExpandedPromptSet({ competitor, inventory, queryMap }) {
  const prompts = new Map();
  const add = (prompt, fields) => {
    const clean = compactWhitespace(prompt);
    if (!clean || clean.length < 8) return;
    const key = clean.toLowerCase();
    const existing = prompts.get(key);
    if (existing && existing.priority >= fields.priority) return;
    prompts.set(key, { prompt: clean, ...fields });
  };

  for (const post of inventory.posts) {
    const titlePrompt = cleanPromptFromTitle(post.title);
    add(titlePrompt, {
      category: post.category,
      source: "blog_inventory_title",
      priority: priorityForCategory(post.category),
      reason: "Derived from a live/local blog title so we can test whether existing content is visible to AI assistants.",
      closestPost: post.title,
    });

    if (/^best\b/i.test(post.title)) {
      add(titlePrompt.toLowerCase(), {
        category: post.category,
        source: "consumer_buyer_prompt",
        priority: priorityForCategory(post.category) + 2,
        reason: "Plain buyer-style version of an existing Best/Guide article title.",
        closestPost: post.title,
      });
    }

    if (/ibolt/i.test(post.title) && !/\bvs\b/i.test(post.title)) {
      add(titlePrompt.replace(/\biBOLT\s*/gi, ""), {
        category: post.category,
        source: "unbranded_existing_topic",
        priority: priorityForCategory(post.category) + 4,
        reason: "Unbranded variant checks whether AI finds iBOLT without being prompted by name.",
        closestPost: post.title,
      });
    }
  }

  for (const gap of queryMap.filter((row) => row.averageMentionRate === 0 || row.averageScore < 10)) {
    add(gap.query, {
      category: gap.category,
      source: "current_visibility_gap",
      priority: 96,
      reason: `Current benchmark score ${gap.averageScore}/100 and mention rate ${gap.averageMentionRate}%.`,
      closestPost: gap.bestPost?.title || "",
    });
    add(`what is the best ${gap.query.replace(/^best\s+/i, "")}`, {
      category: gap.category,
      source: "conversational_gap_variant",
      priority: 92,
      reason: "Conversational version of a current zero/low-visibility prompt.",
      closestPost: gap.bestPost?.title || "",
    });
  }

  for (const row of competitor.rows.filter((item) => item.competitorOnly > 0).slice(0, 12)) {
    const category = row.categories.split(";")[0]?.split(" ")[0] || "general";
    add(`best ${category} mounts like ${row.brand}`, {
      category,
      source: "competitor_displacement",
      priority: 88,
      reason: `${row.brand} appeared without iBOLT in ${row.competitorOnly} AI answers.`,
      closestPost: "",
    });
    add(`${row.brand} vs iBOLT for ${category} mounts`, {
      category,
      source: "head_to_head_comparison",
      priority: 86,
      reason: `Tests whether iBOLT is framed as a credible alternative to ${row.brand}.`,
      closestPost: "",
    });
  }

  for (const [prompt, category] of CURATED_EXPANDED_PROMPTS) {
    add(prompt, {
      category,
      source: "curated_vertical_gap",
      priority: priorityForCategory(category) + 8,
      reason: "Curated prompt added to cover under-tested iBOLT verticals and missing buyer-style AI searches.",
      closestPost: "",
    });
  }

  return [...prompts.values()]
    .sort((a, b) => b.priority - a.priority || a.prompt.localeCompare(b.prompt));
}

function buildRecommendedActions({ competitor, queryMap }) {
  const competitorByQuery = new Map();
  for (const row of competitor.competitorOnlyAnswers) {
    const bucket = competitorByQuery.get(row.query) || new Set();
    for (const brand of row.competitors) bucket.add(brand);
    competitorByQuery.set(row.query, bucket);
  }

  return queryMap.map((row) => {
    const competitors = [...(competitorByQuery.get(row.query) || new Set())];
    const hasStrongPage = row.contentCoverage === "strong";
    const hasPartialPage = row.contentCoverage === "partial";
    const zeroMention = row.averageMentionRate === 0;
    const lowScore = row.averageScore < 25;
    const competitorAngle = competitors.length
      ? `Explicitly compare against ${competitors.slice(0, 4).join(", ")}.`
      : "Add comparison language against the category leaders that appear in AI answers.";
    let action = "Monitor";
    let why = "Current benchmark does not show an urgent gap.";
    let priority = 4;

    if (hasStrongPage && (zeroMention || lowScore)) {
      action = "Refresh existing page for AI visibility";
      why = "A relevant page already exists, but AI assistants are not mentioning iBOLT for the prompt.";
      priority = 1;
    } else if (hasPartialPage && (zeroMention || lowScore)) {
      action = "Expand existing page or convert to stronger solution page";
      why = "There is partial coverage, but the prompt needs a clearer page-level answer and product mapping.";
      priority = 2;
    } else if (!hasStrongPage && !hasPartialPage) {
      action = "Create dedicated solution page";
      why = "No strong local page maps to this benchmark prompt.";
      priority = 2;
    } else if (competitors.length) {
      action = "Add competitive comparison block";
      why = "Competitors appear without iBOLT and can be displaced with comparison content.";
      priority = 3;
    }

    const schemaAction = hasStrongPage || hasPartialPage
      ? "Add/validate FAQ schema, Article schema, product links, and concise answer block on the existing page."
      : "Build page with FAQ schema, Article schema, comparison table, and product/collection links from launch.";
    const contentAction = competitors.length
      ? `${competitorAngle} Add why iBOLT is the commercial-grade or use-case-specific option.`
      : "Make the first 150 words answer the buyer prompt directly and name the exact iBOLT products.";

    return {
      prompt: row.query,
      category: row.category,
      averageScore: row.averageScore,
      mentionRate: row.averageMentionRate,
      contentCoverage: row.contentCoverage,
      closestPost: row.bestPost?.title || "",
      closestScore: row.bestPost ? Math.round(row.bestPost.score * 100) : 0,
      competitors,
      priority,
      action,
      why,
      contentAction,
      schemaAction,
      weakestProviders: row.weakestProviders,
    };
  }).sort((a, b) => a.priority - b.priority || a.averageScore - b.averageScore);
}

function mdTable(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((cell) => String(cell ?? "").replace(/\|/g, "\\|")).join(" | ")} |`),
  ].join("\n");
}

function buildMarkdown({ current, competitor, inventory, queryMap, sitemapUrls, expandedPrompts, recommendedActions }) {
  const totalAnswers = competitor.answers.length;
  const mentionedAnswers = competitor.answers.filter((answer) => answer.brandMention).length;
  const competitorOnly = competitor.competitorOnlyAnswers.length;
  const genericQueries = current.querySummaries.filter((query) => !/ibolt/i.test(query.query));
  const genericMentionRate = pct(
    genericQueries.reduce((sum, query) => sum + query.results.filter((result) => result.brandMentioned || result.targetBrandMentioned || mentionsIbolt(result.rawResponse)).length, 0),
    genericQueries.reduce((sum, query) => sum + query.results.length, 0),
  );
  const topCompetitors = competitor.rows.slice(0, 12);
  const hardestGaps = queryMap.filter((item) => item.averageMentionRate === 0).slice(0, 14);
  const coverageCounts = queryMap.reduce((acc, item) => {
    acc[item.contentCoverage] = (acc[item.contentCoverage] || 0) + 1;
    return acc;
  }, {});

  return `# iBOLT AI Visibility Deep Dive

Source run: ${current.run.id}

## Executive Readout

- We analyzed ${totalAnswers} raw AI answers from ChatGPT, Gemini, and Claude.
- iBOLT appeared in ${mentionedAnswers}/${totalAnswers} answers (${pct(mentionedAnswers, totalAnswers)}%).
- On non-branded prompts, iBOLT mention rate was ${genericMentionRate}%.
- Competitors or adjacent brands appeared without iBOLT in ${competitorOnly} answers. These are the highest-value displacement opportunities.
- The local database has ${inventory.posts.length} published blog posts; the public blog sitemap currently exposes ${sitemapUrls.length} blog/blog-article URLs.
- Benchmark query-to-content mapping: ${coverageCounts.strong || 0} strong, ${coverageCounts.partial || 0} partial, ${coverageCounts.missing || 0} missing.
- Expanded benchmark backlog generated from blog inventory and competitor gaps: ${expandedPrompts.length} small one-at-a-time prompts.

## Who iBOLT Is Mentioned Next To

${mdTable(
  ["Brand", "Type", "AI answers", "With iBOLT", "Without iBOLT", "Categories", "Example prompts"],
  topCompetitors.map((row) => [
    row.brand,
    row.type,
    row.answerCount,
    row.coMentionWithIbolt,
    row.competitorOnly,
    row.categories,
    row.exampleQueries.slice(0, 2).join("; "),
  ]),
)}

## Where Competitors Appear And iBOLT Does Not

${mdTable(
  ["Prompt", "Provider", "Category", "Competitors/adjacent brands"],
  competitor.competitorOnlyAnswers.slice(0, 20).map((row) => [
    row.query,
    providerLabel(row.provider),
    row.category,
    row.competitors.join(", "),
  ]),
)}

## Blog Inventory By Topic

${mdTable(
  ["Topic", "Local posts", "Shopify article IDs", "Avg quality score"],
  inventory.categoryRows.map((row) => [row.category, row.postCount, row.liveCount, row.avgScore]),
)}

## Benchmark Prompts Vs Existing Blog Coverage

${mdTable(
  ["Prompt", "AI score", "Mention rate", "Content coverage", "Closest local post"],
  queryMap.slice(0, 18).map((row) => [
    row.query,
    row.averageScore,
    `${row.averageMentionRate}%`,
    row.contentCoverage,
    row.bestPost ? `${row.bestPost.title} (${Math.round(row.bestPost.score * 100)}%)` : "none",
  ]),
)}

## What This Means

The content inventory is much stronger than the AI answer visibility. That usually means the next work should not be only "write more blogs." We need to make pages easier for AI systems to understand and cite: schema, concise answer blocks, comparison tables, stronger product-page links, and external mentions around the exact competitors and categories above.

The most urgent gaps are prompts where existing content appears to exist but AI systems still do not mention iBOLT. Those need refreshes, internal links, schema, and possibly stronger external corroboration. Prompts with no strong local content match need new solution pages or buying guides.

## Priority Action Plan

${mdTable(
  ["Prompt", "Action", "Closest post", "Competitor angle"],
  recommendedActions.slice(0, 16).map((row) => [
    row.prompt,
    row.action,
    row.closestPost ? `${row.closestPost} (${row.closestScore}%)` : "none",
    row.competitors.length ? row.competitors.slice(0, 4).join(", ") : "category leaders",
  ]),
)}

## Expanded Benchmark Areas

The file \`expanded-benchmark-prompts.csv\` contains ${expandedPrompts.length} additional prompts. It covers title-derived prompts from the full blog inventory, unbranded variants of iBOLT topics, low-visibility gap variants, and competitor displacement prompts such as RAM Mounts, Arkon, iOttie, ProClip, Mount-It, and marine competitors.
`;
}

function buildHtml({ current, competitor, inventory, queryMap, sitemapUrls, expandedPrompts, recommendedActions }) {
  const totalAnswers = competitor.answers.length;
  const mentionedAnswers = competitor.answers.filter((answer) => answer.brandMention).length;
  const competitorOnly = competitor.competitorOnlyAnswers.length;
  const coverageCounts = queryMap.reduce((acc, item) => {
    acc[item.contentCoverage] = (acc[item.contentCoverage] || 0) + 1;
    return acc;
  }, {});
  const topCompetitors = competitor.rows.slice(0, 12).map((row) => `
    <tr><td>${escapeHtml(row.brand)}</td><td>${escapeHtml(row.type)}</td><td>${row.answerCount}</td><td>${row.coMentionWithIbolt}</td><td>${row.competitorOnly}</td><td>${escapeHtml(row.categories)}</td></tr>
  `).join("");
  const topGaps = queryMap.slice(0, 20).map((row) => `
    <tr><td>${escapeHtml(row.query)}</td><td>${row.averageScore}</td><td>${row.averageMentionRate}%</td><td>${row.contentCoverage}</td><td>${escapeHtml(row.bestPost?.title || "none")}</td></tr>
  `).join("");
  const actions = recommendedActions.slice(0, 18).map((row) => `
    <tr><td>${escapeHtml(row.prompt)}</td><td>${escapeHtml(row.action)}</td><td>${escapeHtml(row.closestPost || "none")}</td><td>${escapeHtml(row.competitors.slice(0, 4).join(", ") || "category leaders")}</td></tr>
  `).join("");
  const categories = inventory.categoryRows.map((row) => `
    <tr><td>${escapeHtml(row.category)}</td><td>${row.postCount}</td><td>${row.liveCount}</td><td>${row.avgScore}</td></tr>
  `).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT AI Visibility Deep Dive</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1220px;margin:0 auto;padding:34px 26px 60px}
    h1{font-size:34px;margin:0 0 8px} h2{font-size:22px;margin:34px 0 14px}
    p{color:#334155;line-height:1.55;max-width:960px}.meta{color:#64748b;font-size:14px}
    .cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:24px 0}
    .card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}.k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}.v{font-size:31px;font-weight:800;margin-top:8px}.s{font-size:13px;color:#64748b}
    figure{background:#fff;border:1px solid #d7dee8;border-radius:14px;margin:14px 0;padding:10px;overflow:auto}figure img{display:block;width:100%;height:auto}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden}th,td{font-size:14px;text-align:left;vertical-align:top;padding:11px 12px;border-bottom:1px solid #edf2f7}th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:12px;letter-spacing:.04em}
    .takeaway{border-left:6px solid #2563eb;background:#fff;border-radius:10px;padding:16px 18px;border-top:1px solid #d7dee8;border-right:1px solid #d7dee8;border-bottom:1px solid #d7dee8}
    @media print{body{background:#fff}.cards{grid-template-columns:repeat(5,1fr)}figure,.card,table{break-inside:avoid}}
  </style>
</head>
<body><main>
  <div class="meta">Run ID: ${escapeHtml(current.run.id)} | Public sitemap URLs: ${sitemapUrls.length}</div>
  <h1>iBOLT AI Visibility Deep Dive</h1>
  <p class="takeaway"><strong>Readout:</strong> iBOLT has a meaningful content base, but broad AI answers still mostly omit it. Competitors and adjacent brands appear without iBOLT in ${competitorOnly} answers, which shows where we need stronger pages, schema, comparisons, and external corroboration.</p>
  <section class="cards">
    <div class="card"><div class="k">AI answers</div><div class="v">${totalAnswers}</div><div class="s">raw responses analyzed</div></div>
    <div class="card"><div class="k">iBOLT mentions</div><div class="v">${pct(mentionedAnswers,totalAnswers)}%</div><div class="s">${mentionedAnswers}/${totalAnswers} answers</div></div>
    <div class="card"><div class="k">Competitor-only</div><div class="v">${competitorOnly}</div><div class="s">answers had others but not iBOLT</div></div>
    <div class="card"><div class="k">Local posts</div><div class="v">${inventory.posts.length}</div><div class="s">published in local DB</div></div>
    <div class="card"><div class="k">Coverage map</div><div class="v">${coverageCounts.strong || 0}/${queryMap.length}</div><div class="s">strong prompt-to-post matches</div></div>
    <div class="card"><div class="k">Next prompts</div><div class="v">${expandedPrompts.length}</div><div class="s">expanded benchmark backlog</div></div>
  </section>
  <h2>Charts</h2>
  <figure><img src="competitor-mentions.svg" alt="Competitor mentions"/></figure>
  <figure><img src="competitor-only.svg" alt="Competitor-only answers"/></figure>
  <figure><img src="blog-topic-inventory.svg" alt="Blog topic inventory"/></figure>
  <figure><img src="query-content-coverage.svg" alt="Query content coverage"/></figure>
  <h2>Who We Are Mentioned Next To</h2>
  <table><thead><tr><th>Brand</th><th>Type</th><th>Answers</th><th>With iBOLT</th><th>Without iBOLT</th><th>Categories</th></tr></thead><tbody>${topCompetitors}</tbody></table>
  <h2>Prompts Versus Existing Blog Coverage</h2>
  <table><thead><tr><th>Prompt</th><th>AI score</th><th>Mention</th><th>Coverage</th><th>Closest local post</th></tr></thead><tbody>${topGaps}</tbody></table>
  <h2>Priority Action Plan</h2>
  <table><thead><tr><th>Prompt</th><th>Recommended action</th><th>Closest post</th><th>Competitor angle</th></tr></thead><tbody>${actions}</tbody></table>
  <h2>Blog Inventory</h2>
  <table><thead><tr><th>Topic</th><th>Local posts</th><th>Shopify article IDs</th><th>Avg score</th></tr></thead><tbody>${categories}</tbody></table>
</main></body></html>`;
}

async function main() {
  const benchmarkDir = process.argv[2] ? path.resolve(process.argv[2]) : await latestBenchmarkDir();
  const summary = JSON.parse(await readFile(path.join(benchmarkDir, "summary.json"), "utf8"));
  const current = summary.current;
  const blogPosts = sqliteJson(`
    SELECT id,title,slug,status,word_count,overall_score,shopify_article_id,shopify_blog_id,html,markdown
    FROM blog_posts
    WHERE status='published'
    ORDER BY generated_at DESC
  `);
  let sitemapXml = "";
  try {
    const response = await fetch(BLOG_SITEMAP_URL);
    sitemapXml = await response.text();
  } catch {
    sitemapXml = "";
  }
  const sitemapUrls = parseXmlLocs(sitemapXml);
  const competitor = buildCompetitorAnalysis(current);
  const inventory = buildBlogInventory(blogPosts, sitemapUrls);
  const queryMap = mapQueriesToPosts(current.querySummaries, inventory.posts);
  const expandedPrompts = buildExpandedPromptSet({ competitor, inventory, queryMap });
  const recommendedActions = buildRecommendedActions({ competitor, queryMap });
  const outDir = path.join(benchmarkDir, "deep-dive");
  await mkdir(outDir, { recursive: true });

  await writeFile(path.join(outDir, "deep-visibility-data.json"), JSON.stringify({
    runId: current.run.id,
    sitemapUrl: BLOG_SITEMAP_URL,
    sitemapUrlCount: sitemapUrls.length,
    competitorRows: competitor.rows,
    competitorOnlyAnswers: competitor.competitorOnlyAnswers,
    blogCategoryRows: inventory.categoryRows,
    queryContentMap: queryMap,
    expandedPrompts,
    recommendedActions,
  }, null, 2));
  await writeFile(path.join(outDir, "competitor-analysis.csv"), csv([
    ["brand", "type", "answer_count", "with_ibolt", "without_ibolt", "providers", "categories", "example_queries"],
    ...competitor.rows.map((row) => [row.brand, row.type, row.answerCount, row.coMentionWithIbolt, row.competitorOnly, row.providers, row.categories, row.exampleQueries]),
  ]));
  await writeFile(path.join(outDir, "query-blog-coverage.csv"), csv([
    ["query", "category", "avg_score", "mention_rate", "coverage", "closest_post", "closest_score", "weakest_providers"],
    ...queryMap.map((row) => [row.query, row.category, row.averageScore, row.averageMentionRate, row.contentCoverage, row.bestPost?.title || "", row.bestPost ? Math.round(row.bestPost.score * 100) : 0, row.weakestProviders]),
  ]));
  await writeFile(path.join(outDir, "expanded-benchmark-prompts.csv"), csv([
    ["prompt", "category", "source", "priority", "reason", "closest_post"],
    ...expandedPrompts.map((row) => [row.prompt, row.category, row.source, row.priority, row.reason, row.closestPost]),
  ]));
  await writeFile(path.join(outDir, "expanded-benchmark-prompts.json"), JSON.stringify(expandedPrompts, null, 2));
  await writeFile(path.join(outDir, "recommended-actions.csv"), csv([
    [
      "prompt",
      "category",
      "avg_score",
      "mention_rate",
      "content_coverage",
      "closest_post",
      "closest_score",
      "priority",
      "recommended_action",
      "why",
      "content_action",
      "schema_action",
      "competitors",
      "weakest_providers",
    ],
    ...recommendedActions.map((row) => [
      row.prompt,
      row.category,
      row.averageScore,
      row.mentionRate,
      row.contentCoverage,
      row.closestPost,
      row.closestScore,
      row.priority,
      row.action,
      row.why,
      row.contentAction,
      row.schemaAction,
      row.competitors,
      row.weakestProviders,
    ]),
  ]));

  const topCompetitorMax = Math.max(1, ...competitor.rows.slice(0, 14).map((row) => row.answerCount));
  await writeFile(path.join(outDir, "competitor-mentions.svg"), barChart({
    title: "Brands Mentioned In AI Answers",
    subtitle: "Answer-level frequency across ChatGPT, Gemini, and Claude raw responses.",
    color: "#2563eb",
    rows: competitor.rows.slice(0, 14).map((row) => ({
      label: row.brand,
      note: row.type,
      value: row.answerCount,
      max: topCompetitorMax,
      display: row.answerCount,
    })),
  }));
  const competitorOnlyMax = Math.max(1, ...competitor.rows.slice(0, 14).map((row) => row.competitorOnly));
  await writeFile(path.join(outDir, "competitor-only.svg"), barChart({
    title: "Competitors Appearing Without iBOLT",
    subtitle: "These answers mention another brand or adjacent brand but omit iBOLT.",
    color: "#dc2626",
    rows: competitor.rows
      .filter((row) => row.competitorOnly > 0)
      .slice(0, 14)
      .map((row) => ({
        label: row.brand,
        note: row.categories,
        value: row.competitorOnly,
        max: competitorOnlyMax,
        display: row.competitorOnly,
      })),
  }));
  const maxPosts = Math.max(1, ...inventory.categoryRows.map((row) => row.postCount));
  await writeFile(path.join(outDir, "blog-topic-inventory.svg"), barChart({
    title: "Local Blog Inventory By Topic",
    subtitle: "Classified from title, slug, and body text in the local blog_posts table.",
    color: "#16a34a",
    rows: inventory.categoryRows.map((row) => ({
      label: row.category,
      note: `${row.liveCount} with Shopify article IDs; avg score ${row.avgScore}`,
      value: row.postCount,
      max: maxPosts,
      display: row.postCount,
    })),
  }));
  const coverageOrder = ["strong", "partial", "missing"];
  const coverageCounts = coverageOrder.map((name) => ({
    label: name,
    note: "benchmark prompts mapped to closest local blog content",
    value: queryMap.filter((row) => row.contentCoverage === name).length,
    max: queryMap.length,
    display: queryMap.filter((row) => row.contentCoverage === name).length,
  }));
  await writeFile(path.join(outDir, "query-content-coverage.svg"), barChart({
    title: "Benchmark Prompt Coverage In Current Blog Inventory",
    subtitle: "Strong content matches do not yet guarantee AI visibility.",
    color: "#7c3aed",
    rows: coverageCounts,
  }));
  await writeFile(path.join(outDir, "deep-visibility-report.md"), buildMarkdown({
    current,
    competitor,
    inventory,
    queryMap,
    sitemapUrls,
    expandedPrompts,
    recommendedActions,
  }));
  await writeFile(path.join(outDir, "deep-visibility-report.html"), buildHtml({
    current,
    competitor,
    inventory,
    queryMap,
    sitemapUrls,
    expandedPrompts,
    recommendedActions,
  }));

  console.log(outDir);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
