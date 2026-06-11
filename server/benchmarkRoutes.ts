import { Router, type Request, type Response } from "express";
import {
  BENCHMARK_PROVIDERS,
  createBenchmarkQuery,
  generateContentPlan,
  getBenchmarkProviderConfigStatus,
  getBenchmarkRunSummary,
  getLatestBenchmarkRunSummary,
  listBenchmarkQueries,
  listBenchmarkRuns,
  materializeContentPlanItem,
  normalizeBenchmarkProvider,
  runAiBenchmark,
  updateBenchmarkQuery,
  type BenchmarkProvider,
} from "./aiBenchmark";
import { getCompanyIdFromRequest, requireBlogMutationRole } from "./companyContext";
import { getVerticalById } from "./contextBanks";

async function assertBenchmarkVertical(companyId: string, verticalId: unknown): Promise<string | null> {
  if (verticalId === undefined || verticalId === null || verticalId === "") return null;
  if (typeof verticalId !== "string") throw new Error("verticalId must be a string.");
  const vertical = await getVerticalById(verticalId, companyId);
  if (!vertical) throw new Error("Vertical not found for active company.");
  return verticalId;
}

function parseProviders(input: unknown): BenchmarkProvider[] {
  if (!Array.isArray(input)) {
    return [...BENCHMARK_PROVIDERS];
  }

  const requested = Array.from(new Set(
    input
      .map((value) => normalizeBenchmarkProvider(value))
      .filter((value): value is BenchmarkProvider => Boolean(value)),
  ));

  return requested.length > 0 ? requested : [...BENCHMARK_PROVIDERS];
}

function withGenericBenchmarkAliases<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => withGenericBenchmarkAliases(item)) as T;
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const source = value as Record<string, unknown>;
  const mapped: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(source)) {
    mapped[key] = withGenericBenchmarkAliases(entry);
  }

  if ("iboltAngle" in source && !("brandAngle" in source)) {
    mapped.brandAngle = source.iboltAngle;
  }
  if ("brandMentioned" in source && !("targetBrandMentioned" in source)) {
    mapped.targetBrandMentioned = source.brandMentioned;
  }
  if ("iboltCited" in source && !("targetDomainCited" in source)) {
    mapped.targetDomainCited = source.iboltCited;
  }

  return mapped as T;
}

export function registerBenchmarkRoutes(app: { use: (path: string, router: Router) => void }) {
  const router = Router();
  router.use(requireBlogMutationRole("editor"));

  router.get("/providers", (_req: Request, res: Response) => {
    res.json(getBenchmarkProviderConfigStatus());
  });

  router.get("/queries", async (req: Request, res: Response) => {
    try {
      res.json(withGenericBenchmarkAliases(await listBenchmarkQueries(getCompanyIdFromRequest(req))));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/queries", async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      const {
        category,
        label,
        query,
        verticalId,
        intentType,
        priority,
        benchmarkGoal,
        persona,
        painPoint,
        iboltAngle,
        brandAngle,
        targetProducts,
        benchmarkBaseline,
        notes,
        status,
      } = req.body || {};
      if (!category || !query) {
        return res.status(400).json({ error: "category and query are required" });
      }

      const created = await createBenchmarkQuery({
        companyId,
        category,
        label: label || null,
        query,
        verticalId: await assertBenchmarkVertical(companyId, verticalId),
        intentType: intentType || "buyer_guide",
        priority: priority ?? 50,
        benchmarkGoal: benchmarkGoal || null,
        persona: persona || null,
        painPoint: painPoint || null,
        brandAngle: brandAngle || iboltAngle || null,
        iboltAngle: iboltAngle || brandAngle || null,
        targetProducts: targetProducts || [],
        benchmarkBaseline: benchmarkBaseline || null,
        benchmarkBaselinedAt: benchmarkBaseline ? new Date() : null,
        notes: notes || null,
        status: status || "active",
      });

      res.json(withGenericBenchmarkAliases(created));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/queries/bulk", async (req: Request, res: Response) => {
    try {
      const { category, queries, benchmarkGoal, priority } = req.body || {};
      if (!category || !Array.isArray(queries) || queries.length === 0) {
        return res.status(400).json({ error: "category and queries are required" });
      }

      const normalized = queries
        .map((value: unknown) => {
          if (typeof value === "string") {
            return { query: value.trim() };
          }
          if (value && typeof value === "object") {
            const item = value as Record<string, unknown>;
            return {
              query: typeof item.query === "string" ? item.query.trim() : "",
              label: typeof item.label === "string" ? item.label : null,
              persona: typeof item.persona === "string" ? item.persona : null,
              painPoint: typeof item.painPoint === "string" ? item.painPoint : typeof item.pain === "string" ? item.pain : null,
              iboltAngle: typeof item.iboltAngle === "string"
                ? item.iboltAngle
                : typeof item.brandAngle === "string"
                  ? item.brandAngle
                  : typeof item.angle === "string"
                    ? item.angle
                    : null,
              targetProducts: Array.isArray(item.targetProducts)
                ? item.targetProducts.filter((product): product is string => typeof product === "string")
                : typeof item.targetProducts === "string"
                  ? item.targetProducts.split(/[\n,]+/).map((product) => product.trim()).filter(Boolean)
                  : [],
              benchmarkGoal: typeof item.benchmarkGoal === "string" ? item.benchmarkGoal : benchmarkGoal || null,
            };
          }
          return { query: "" };
        })
        .filter((value) => value.query);

      const seenQueries = new Set<string>();
      const deduped = normalized.filter((value) => {
        const key = value.query.toLowerCase();
        if (seenQueries.has(key)) return false;
        seenQueries.add(key);
        return true;
      });

      const created = [];
      const companyId = getCompanyIdFromRequest(req);
      for (const item of deduped) {
        try {
          created.push(await createBenchmarkQuery({
            category,
            companyId,
            query: item.query,
            benchmarkGoal: item.benchmarkGoal || benchmarkGoal || null,
            intentType: "buyer_guide",
            priority: priority ?? 50,
            label: item.label || null,
            verticalId: null,
            persona: item.persona || null,
            painPoint: item.painPoint || null,
            iboltAngle: item.iboltAngle || null,
            targetProducts: item.targetProducts || [],
            benchmarkBaseline: null,
            benchmarkBaselinedAt: null,
            notes: null,
            status: "active",
          }));
        } catch {
          // Ignore duplicates and continue with the rest.
        }
      }

      res.json(withGenericBenchmarkAliases({ createdCount: created.length, created }));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch("/queries/:id", async (req: Request, res: Response) => {
    try {
      const updates = { ...(req.body || {}) };
      const companyId = getCompanyIdFromRequest(req);
      if (updates.brandAngle && !updates.iboltAngle) {
        updates.iboltAngle = updates.brandAngle;
      }
      if (updates.iboltAngle && !updates.brandAngle) {
        updates.brandAngle = updates.iboltAngle;
      }
      if ("verticalId" in updates) {
        updates.verticalId = await assertBenchmarkVertical(companyId, updates.verticalId);
      }
      res.json(withGenericBenchmarkAliases(await updateBenchmarkQuery(req.params.id, updates, companyId)));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/runs", async (req: Request, res: Response) => {
    try {
      const limit = req.query.limit ? Number.parseInt(String(req.query.limit), 10) : 10;
      res.json(withGenericBenchmarkAliases(await listBenchmarkRuns(Number.isFinite(limit) ? limit : 10, getCompanyIdFromRequest(req))));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/runs/:id", async (req: Request, res: Response) => {
    try {
      const summary = await getBenchmarkRunSummary(req.params.id, getCompanyIdFromRequest(req));
      if (!summary) return res.status(404).json({ error: "Benchmark run not found" });
      res.json(withGenericBenchmarkAliases(summary));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/latest", async (req: Request, res: Response) => {
    try {
      res.json(withGenericBenchmarkAliases(await getLatestBenchmarkRunSummary(getCompanyIdFromRequest(req))));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/content-plan", async (req: Request, res: Response) => {
    try {
      const runId = req.query.runId ? String(req.query.runId) : undefined;
      const limit = req.query.limit ? Number.parseInt(String(req.query.limit), 10) : 8;
      res.json(withGenericBenchmarkAliases(await generateContentPlan(runId, Number.isFinite(limit) ? limit : 8, getCompanyIdFromRequest(req))));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/content-plan/materialize", async (req: Request, res: Response) => {
    try {
      const { item, generateNow, queueForGeneration } = req.body || {};
      if (!item || !item.queryId || !item.primaryKeyword || !item.title) {
        return res.status(400).json({ error: "A valid content plan item is required." });
      }

      const result = await materializeContentPlanItem({
        item,
        generateNow: Boolean(generateNow),
        queueForGeneration: Boolean(queueForGeneration),
        companyId: getCompanyIdFromRequest(req),
      });

      res.json(withGenericBenchmarkAliases(result));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/run", async (req: Request, res: Response) => {
    try {
      const { name, queryIds, providers, concurrency } = req.body || {};

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const sendEvent = (event: string, data: unknown) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const summary = await runAiBenchmark(
        {
          name,
          queryIds: Array.isArray(queryIds) ? queryIds : undefined,
          providers: parseProviders(providers),
          concurrency: typeof concurrency === "number" ? concurrency : undefined,
          companyId: getCompanyIdFromRequest(req),
        },
        (event) => {
          sendEvent(event.type, event);
        },
      );

      sendEvent("done", withGenericBenchmarkAliases(summary));
      res.end();
    } catch (error: any) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  });

  router.post("/loop", async (req: Request, res: Response) => {
    try {
      const { name, queryIds, providers, concurrency, planLimit } = req.body || {};
      const summary = await runAiBenchmark({
        name: name || `AI Search Improvement Loop ${new Date().toISOString().slice(0, 10)}`,
        queryIds: Array.isArray(queryIds) ? queryIds : undefined,
        providers: parseProviders(providers),
        concurrency: typeof concurrency === "number" ? concurrency : undefined,
        companyId: getCompanyIdFromRequest(req),
      });
      const contentPlan = await generateContentPlan(
        summary.run.id,
        typeof planLimit === "number" && Number.isFinite(planLimit) ? planLimit : 8,
        getCompanyIdFromRequest(req),
      );

      res.json(withGenericBenchmarkAliases({ summary, contentPlan }));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.use("/api/blog/benchmark", router);
}
