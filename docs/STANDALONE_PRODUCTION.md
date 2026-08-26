# Standalone Blog Writer Production Notes

This deployment mode runs the company-configurable blog writer as the primary product. The iBolt workspace is a local/demo seed only and is disabled by default in production; new brands must be configured through company, brand, product, asset, keyword, benchmark, and publishing setup.

## Required Environment

Set these before `NODE_ENV=production`:

- `JWT_SECRET`: non-default random value, at least 32 characters.
- `INTEGRATION_ENCRYPTION_KEY`: non-default random value, at least 32 characters. Used for integration token encryption.
- `PUBLIC_BASE_URL` or `APP_BASE_URL`: public deployment origin used for signed asset URLs.
- `PUBLIC_ASSET_SIGNING_SECRET`: non-default random value for public photo URL signatures.
- `DATABASE_PATH=./data/standalone-blog-writer.db`: default standalone SQLite path. Existing fork databases at `./data/sourceannotator.db` are still detected when no standalone database exists.
- `CLERK_SECRET_KEY` and `VITE_CLERK_PUBLISHABLE_KEY`: live Clerk production auth keys (`sk_live_...` and `pk_live_...`). The client sign-in UI requires the `VITE_` key.
- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`: required for blog generation.
- `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET`: Shopify app credentials for plug-and-play OAuth installs.
- `SHOPIFY_API_VERSION=2026-04`: configurable Shopify Admin API version. Keep this on a currently supported stable Shopify version.
- `SHOPIFY_OAUTH_SCOPES=read_products,read_inventory,read_content,write_content`
- Do not configure global Shopify access-token environment variables for publishing. Publishing uses encrypted per-company OAuth tokens stored by the Shopify install flow.
- `DEFAULT_COMPANY_ID`: optional fallback workspace id. Do not rely on the iBolt demo id in production.
- `VITE_ENABLE_LEGACY_SCHOLARMARK=false`: standalone UI mode.
- `ENABLE_LEGACY_SCHOLARMARK=false`: standalone API mode.
- `IBOLT_BLOG_ALLOW_UNAUTHENTICATED=false`
- `BLOG_ALLOW_UNVALIDATED_COMPANY_SELECTION=false`
- `IBOLT_INTERNAL_AUTH_BYPASS=false`
- `BLOG_ALLOW_UNSIGNED_PUBLIC_PHOTOS=false`
- `BLOG_SEED_IBOLT_DEMO=false`
- `ALLOW_IBOLT_DEMO_SCRIPTS=false`
- `ALLOW_CHROME_EXTENSION_ORIGINS=false`

Optional feature gates should stay false unless intentionally used:

- `BLOG_ALLOW_LOCAL_FILE_IMPORTS=false`
- `BLOG_ALLOW_LOCAL_PHOTO_IMPORTS=false`
- `BLOG_ALLOW_LEGACY_CONTENT_IMPORT=false`
- `BLOG_ALLOW_SHOPIFY_COLLECTION_MUTATION=false`

Production startup fails if the required auth/secret settings are missing or unsafe. Fresh standalone databases create blog-domain `company_id` columns as `NOT NULL`. Migrated databases are rebuilt automatically when every row already has a company id; startup fails if any legacy blog row is still missing a company and needs explicit backfill.

New Clerk users default to the `free` tier unless `publicMetadata.tier` is one of `free`, `pro`, or `max`. Keep tier changes in Clerk metadata so local usage limits stay synchronized.

Configure Clerk allowed origins and redirects for:

- `https://your-production-domain/sign-in`
- `https://your-production-domain/sign-up`
- `https://your-production-domain/blog`
- `https://your-production-domain/blog/setup`

Generate random secrets with a command such as:

```bash
openssl rand -base64 48
```

## New Company Onboarding

1. Create a company workspace in `/blog/setup`.
2. Fill the company profile: name, website, market, ecommerce platform.
3. Fill the brand profile: positioning, tone, CTAs, banned phrases, claims, competitors, and writing samples.
4. Configure product sources: Shopify OAuth/public Shopify URL, CSV, manual products, product URL import, or catalog PDF.
5. Upload and annotate product assets in `/blog/photos`.
6. Import keywords or create AI visibility benchmark queries.
7. Generate drafts, review selected products/assets, then publish to Shopify as draft by default.

New workspaces receive only a neutral starter vertical. They do not inherit iBolt verticals or catalog data.

## Memberships And Roles

Company routes are scoped by `x-company-id` and active membership. Supported roles are `owner`, `admin`, `editor`, `reviewer`, and `viewer`.

- Owners can manage every role, including other owners.
- Admins can manage non-owner members and company/integration settings.
- Editors can change content, product, keyword, context, catalog, and photo data.
- Reviewers can approve/publish review actions where enabled.
- Viewers can read company data only.

The membership API is available at `/api/blog/company/memberships`. Users must sign in once before they can be added by email or user id. The API prevents removing or demoting the last active owner.

## Scheduler Behavior

Scheduler configuration is stored per company in `company_settings.settings.scheduler`.

- `/api/blog/scheduler/start` persists the company scheduler config and starts timers for that process.
- `/api/blog/scheduler/stop` persists `enabled=false`.
- `/api/blog/scheduler/config` persists interval and feature changes.
- On server startup, enabled scheduler configs are restored.
- Each scheduler task takes a company/job lock in `company_job_locks`.
- Each task records a run row in `company_job_runs`, including status, duration, result, and error.
- Active jobs renew their leases while running. Expired leases are treated as failed stale runs before another worker can take the same company/job.
- `/api/blog/scheduler/runs` returns recent run history for the active company.
- Expired locks for the active company can be removed with `/api/blog/scheduler/locks/cleanup`.

Timers are still in-process, but task execution is now protected by database locks so duplicate workers skip the same company/job while a lock is live. For high-volume multi-instance production, keep one scheduler-capable instance or move timer dispatch behind a dedicated queue; keep the database locks as the final safety check.

## Legacy ScholarMark Isolation

Standalone mode disables legacy ScholarMark API surfaces such as documents, projects, chat, writing, web clips, extension, and admin analytics. The frontend redirects legacy routes to `/blog`.

Enable legacy routes only for a combined deployment:

```bash
ENABLE_LEGACY_SCHOLARMARK=true
VITE_ENABLE_LEGACY_SCHOLARMARK=true
```

## Preflight Checks

Run before shipping:

```bash
npm run check
npm run build
npm run preflight:standalone
npm run smoke:onboarding
```

The onboarding smoke creates a disposable non-iBolt company through the API, verifies setup-status transitions, adds brand guidance, adds a manual product, simulates an OAuth-backed encrypted Shopify connection, reads `CompanyContext`, and deletes the temporary workspace.

Then verify deployment-specific surfaces:

- Create a non-iBolt company.
- Confirm it has a neutral starter vertical only.
- Confirm product sync fails closed until a product source is configured.
- Confirm `/api/blog/company/context` and all operational lists are company-scoped.
- Confirm legacy APIs return 404 when legacy mode is disabled.
- Confirm Shopify publish is draft-first and uses a company-linked integration.
- Confirm unsigned public photo URLs return 404 and rendered Shopify HTML uses signed photo URLs.
- Confirm competitor/product URL imports reject localhost and private-network targets.
- Confirm tenant integrity passes on the production database before `npm start`.
