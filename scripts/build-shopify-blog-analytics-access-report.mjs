import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const OUT_DIR =
  process.argv[2] ||
  path.join(
    "content-output",
    `shopify-blog-analytics-access-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );

function parseDotEnv(text) {
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    env[line.slice(0, index)] = line.slice(index + 1);
  }
  return env;
}

async function loadEnv() {
  let fileEnv = {};
  try {
    fileEnv = parseDotEnv(await readFile(".env", "utf8"));
  } catch {
    fileEnv = {};
  }
  return { ...fileEnv, ...process.env };
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(rows, headers) {
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function articleUrl(shop, blogHandle, articleHandle) {
  return `https://${shop}.com/blogs/${blogHandle}/${articleHandle}`;
}

function countMatches(text, pattern) {
  return (text.match(pattern) || []).length;
}

async function shopifyRest({ shop, token, endpoint }) {
  const url = `https://${shop}.myshopify.com/admin/api/${API_VERSION}/${endpoint}`;
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
  });
  const body = await res.json().catch(async () => ({ raw: await res.text() }));
  return { res, body };
}

async function shopifyAdminRest({ shop, token, endpoint }) {
  const url = `https://${shop}.myshopify.com/admin/${endpoint}`;
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
  });
  const body = await res.json().catch(async () => ({ raw: await res.text() }));
  return { res, body };
}

async function shopifyGraphql({ shop, token, query, variables }) {
  const res = await fetch(`https://${shop}.myshopify.com/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(async () => ({ raw: await res.text() }));
  return { res, body };
}

function nextPageEndpoint(linkHeader) {
  if (!linkHeader) return null;
  const next = linkHeader
    .split(",")
    .map((part) => part.trim())
    .find((part) => /rel="next"/.test(part));
  if (!next) return null;
  const match = next.match(/<https:\/\/[^/]+\/admin\/api\/[^/]+\/(.+?)>/);
  return match?.[1] || null;
}

async function pagedRest({ shop, token, endpoint, key }) {
  const rows = [];
  let current = endpoint;
  while (current) {
    const { res, body } = await shopifyRest({ shop, token, endpoint: current });
    if (!res.ok) {
      return { rows, error: body, status: res.status };
    }
    rows.push(...(body[key] || []));
    current = nextPageEndpoint(res.headers.get("link"));
  }
  return { rows, error: null, status: 200 };
}

async function main() {
  const env = await loadEnv();
  const shop = (env.SHOPIFY_SHOP || "iboltmounts").replace(/\.myshopify\.com$/i, "");
  const token = env.SHOPIFY_ACCESS_TOKEN || env.SHOPIFY_ADMIN_API_ACCESS_TOKEN;

  await mkdir(OUT_DIR, { recursive: true });

  if (!token) {
    const report = `# Shopify Blog Analytics Access Report\n\nStatus: blocked. No Shopify Admin access token is configured in the environment.\n`;
    await writeFile(path.join(OUT_DIR, "REPORT.md"), report);
    await writeFile(path.join(OUT_DIR, "REPORT.html"), `<pre>${htmlEscape(report)}</pre>`);
    return;
  }

  const scopesResponse = await shopifyAdminRest({ shop, token, endpoint: "oauth/access_scopes.json" });
  const scopes = (scopesResponse.body.access_scopes || []).map((scope) => scope.handle).sort();

  const shopifyql = await shopifyGraphql({
    shop,
    token,
    query:
      "query($query:String!){ shopifyqlQuery(query:$query){ tableData { columns { name dataType displayName } rows } parseErrors } }",
    variables: {
      query: "FROM sessions SHOW sessions TIMESERIES day SINCE -30d UNTIL today",
    },
  });

  const graphqlErrors = (shopifyql.body.errors || []).map((error) => error.message);
  const analyticsAllowed = Boolean(shopifyql.body?.data?.shopifyqlQuery?.tableData);
  const analyticsBlocker = analyticsAllowed
    ? ""
    : graphqlErrors.find((message) => message.toLowerCase().includes("access denied")) ||
      graphqlErrors[0] ||
      "ShopifyQL analytics query did not return table data.";

  const blogsResult = await pagedRest({ shop, token, endpoint: "blogs.json?limit=250", key: "blogs" });
  const blogs = blogsResult.rows;

  const articleRows = [];
  for (const blog of blogs) {
    const articlesResult = await pagedRest({
      shop,
      token,
      endpoint: `blogs/${blog.id}/articles.json?limit=250&published_status=any`,
      key: "articles",
    });
    for (const article of articlesResult.rows) {
      const body = article.body_html || "";
      const url = articleUrl("iboltmounts", blog.handle, article.handle);
      articleRows.push({
        blog_id: blog.id,
        blog_handle: blog.handle,
        blog_title: blog.title,
        article_id: article.id,
        title: article.title,
        handle: article.handle,
        live_url: url,
        published_at: article.published_at || "",
        created_at: article.created_at || "",
        updated_at: article.updated_at || "",
        author: article.author || "",
        tags: article.tags || "",
        visible_status: article.published_at ? "published" : "unpublished",
        body_chars: body.length,
        product_links: countMatches(body, /iboltmounts\.com\/products\//gi),
        add_to_cart_links: countMatches(body, /\/cart\/add|cart\/add\?/gi),
        image_count: countMatches(body, /<img\b/gi),
      });
    }
  }

  articleRows.sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));

  const analyticsStatus = [
    {
      check: "installed_scopes",
      status: scopes.join(", "),
      result: scopes.includes("read_reports") ? "has_read_reports" : "missing_read_reports",
      note: "ShopifyQL analytics requires read_reports. Current token should not expose secrets in this report.",
    },
    {
      check: "shopifyql_sessions_probe",
      status: analyticsAllowed ? "allowed" : "blocked",
      result: analyticsAllowed ? "table_data_returned" : "access_denied_or_no_data",
      note: analyticsBlocker,
    },
    {
      check: "content_inventory",
      status: blogsResult.status === 200 ? "allowed" : "blocked",
      result: `${blogs.length} blogs, ${articleRows.length} articles readable`,
      note: "read_content allows article metadata and HTML inspection, but not sessions, page views, add-to-cart rate, or conversion analytics.",
    },
  ];

  await writeFile(
    path.join(OUT_DIR, "analytics-access-status.csv"),
    csv(analyticsStatus, ["check", "status", "result", "note"]),
  );
  await writeFile(
    path.join(OUT_DIR, "shopify-blog-article-inventory.csv"),
    csv(articleRows, [
      "blog_id",
      "blog_handle",
      "blog_title",
      "article_id",
      "title",
      "handle",
      "live_url",
      "published_at",
      "created_at",
      "updated_at",
      "author",
      "tags",
      "visible_status",
      "body_chars",
      "product_links",
      "add_to_cart_links",
      "image_count",
    ]),
  );

  const topRows = articleRows.slice(0, 20);
  const report = `# Shopify Blog Analytics Access Report

## Status

- Analytics API: ${analyticsAllowed ? "available" : "blocked"}
- Installed scopes: ${scopes.join(", ") || "none returned"}
- Required missing scope: ${scopes.includes("read_reports") ? "none" : "read_reports"}
- Content inventory readable: ${blogs.length} blogs, ${articleRows.length} articles

## What This Means

The current Shopify token can read and update blog content, but it cannot read Shopify Analytics. Shopify's Admin GraphQL \`shopifyqlQuery\` analytics endpoint returned: ${analyticsBlocker || "table data returned"}.

So we can audit which blog posts exist, which posts are live, product-link density, add-to-cart link presence, image count, and publish metadata. We cannot reliably pull blog sessions, page views, add-to-cart rate, checkout rate, conversion rate, or revenue by landing page until the Shopify app/token is reinstalled with \`read_reports\` access and protected customer data requirements are approved, or until someone exports the report from the logged-in Shopify Admin UI.

## Files

- \`analytics-access-status.csv\`
- \`shopify-blog-article-inventory.csv\`

## Next Analytics Pull Once Access Is Available

1. Pull sessions/page views by landing page for \`/blogs/news/*\`.
2. Pull add-to-cart and checkout conversion by landing page.
3. Join blog URLs to AI visibility rows from the benchmark packets.
4. Prioritize pages where AI visibility is weak but Shopify traffic or conversion intent is high.

## Latest Readable Articles

| Published | Blog | Article | Product Links | Add-To-Cart Links | Images |
| --- | --- | --- | ---: | ---: | ---: |
${topRows
  .map(
    (row) =>
      `| ${row.published_at || "unpublished"} | ${row.blog_handle} | [${row.title}](${row.live_url}) | ${row.product_links} | ${row.add_to_cart_links} | ${row.image_count} |`,
  )
  .join("\n")}
`;

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Shopify Blog Analytics Access Report</title>
  <style>
    body{font-family:Arial,sans-serif;max-width:1100px;margin:32px auto;padding:0 20px;line-height:1.5;color:#111827}
    h1,h2{line-height:1.15}
    .status{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:20px 0}
    .card{border:1px solid #d1d5db;border-radius:8px;padding:14px;background:#f9fafb}
    .card strong{display:block;font-size:13px;color:#4b5563;text-transform:uppercase;letter-spacing:.03em}
    table{width:100%;border-collapse:collapse;margin-top:16px;font-size:14px}
    th,td{border-bottom:1px solid #e5e7eb;padding:8px;text-align:left;vertical-align:top}
    th{background:#f3f4f6}
    code{background:#f3f4f6;padding:2px 5px;border-radius:4px}
  </style>
</head>
<body>
  <h1>Shopify Blog Analytics Access Report</h1>
  <div class="status">
    <div class="card"><strong>Analytics API</strong>${analyticsAllowed ? "Available" : "Blocked"}</div>
    <div class="card"><strong>Installed Scopes</strong>${htmlEscape(scopes.join(", ") || "none returned")}</div>
    <div class="card"><strong>Content Inventory</strong>${blogs.length} blogs, ${articleRows.length} articles</div>
  </div>
  <h2>Read</h2>
  <p>The current Shopify token can read and update blog content, but it cannot read Shopify Analytics. The analytics endpoint returned: <code>${htmlEscape(analyticsBlocker || "table data returned")}</code>.</p>
  <p>Use this packet as proof of the access issue and as the current content inventory until <code>read_reports</code> is granted or the Shopify Admin UI report is exported.</p>
  <h2>Files</h2>
  <ul>
    <li><a href="analytics-access-status.csv">analytics-access-status.csv</a></li>
    <li><a href="shopify-blog-article-inventory.csv">shopify-blog-article-inventory.csv</a></li>
  </ul>
  <h2>Latest Readable Articles</h2>
  <table>
    <thead><tr><th>Published</th><th>Blog</th><th>Article</th><th>Product Links</th><th>Add-To-Cart Links</th><th>Images</th></tr></thead>
    <tbody>
      ${topRows
        .map(
          (row) =>
            `<tr><td>${htmlEscape(row.published_at || "unpublished")}</td><td>${htmlEscape(row.blog_handle)}</td><td><a href="${htmlEscape(row.live_url)}">${htmlEscape(row.title)}</a></td><td>${row.product_links}</td><td>${row.add_to_cart_links}</td><td>${row.image_count}</td></tr>`,
        )
        .join("\n")}
    </tbody>
  </table>
</body>
</html>
`;

  await writeFile(path.join(OUT_DIR, "REPORT.md"), report);
  await writeFile(path.join(OUT_DIR, "REPORT.html"), html);

  console.log(`Wrote ${OUT_DIR}`);
  console.log(`Analytics API: ${analyticsAllowed ? "available" : "blocked"}`);
  console.log(`Content inventory: ${blogs.length} blogs, ${articleRows.length} articles`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
