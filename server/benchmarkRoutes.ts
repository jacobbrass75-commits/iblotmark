import { Router, type Request, type Response } from "express";
import {
  BENCHMARK_PROVIDERS,
  createBenchmarkQuery,
  generateContentPlan,
  getBenchmarkRunSummary,
  getLatestBenchmarkRunSummary,
  listBenchmarkQueries,
  listBenchmarkRuns,
  materializeContentPlanItem,
  runAiBenchmark,
  updateBenchmarkQuery,
  type BenchmarkProvider,
} from "./aiBenchmark";

function parseProviders(input: unknown): BenchmarkProvider[] {
  if (!Array.isArray(input)) {
    return [...BENCHMARK_PROVIDERS];
  }

  const requested = input.filter((value): value is BenchmarkProvider =>
    typeof value === "string" && BENCHMARK_PROVIDERS.includes(value as BenchmarkProvider),
  );

  return requested.length > 0 ? requested : [...BENCHMARK_PROVIDERS];
}

export function registerBenchmarkRoutes(app: { use: (path: string, router: Router) => void }) {
  const router = Router();

  router.get("/queries", async (_req: Request, res: Response) => {
    try {
      res.json(await listBenchmarkQueries());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/queries", async (req: Request, res: Response) => {
    try {
      const { category, label, query, verticalId, intentType, priority, benchmarkGoal, notes, status } = req.body || {};
      if (!category || !query) {
        return res.status(400).json({ error: "category and query are required" });
      }

      const created = await createBenchmarkQuery({
        category,
        label: label || null,
        query,
        verticalId: verticalId || null,
        intentType: intentType || "buyer_guide",
        priority: priority ?? 50,
        benchmarkGoal: benchmarkGoal || null,
        notes: notes || null,
        status: status || "active",
      });

      res.json(created);
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

      const normalized = Array.from(new Set(
        queries
          .filter((value: unknown): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean),
      ));

      const created = [];
      for (const query of normalized) {
        try {
          created.push(await createBenchmarkQuery({
            category,
            query,
            benchmarkGoal: benchmarkGoal || null,
            intentType: "buyer_guide",
            priority: priority ?? 50,
            label: null,
            verticalId: null,
            notes: null,
            status: "active",
          }));
        } catch {
          // Ignore duplicates and continue with the rest.
        }
      }

      res.json({ createdCount: created.length, created });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch("/queries/:id", async (req: Request, res: Response) => {
    try {
      res.json(await updateBenchmarkQuery(req.params.id, req.body || {}));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/runs", async (req: Request, res: Response) => {
    try {
      const limit = req.query.limit ? Number.parseInt(String(req.query.limit), 10) : 10;
      res.json(await listBenchmarkRuns(Number.isFinite(limit) ? limit : 10));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/runs/:id", async (req: Request, res: Response) => {
    try {
      const summary = await getBenchmarkRunSummary(req.params.id);
      if (!summary) return res.status(404).json({ error: "Benchmark run not found" });
      res.json(summary);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/latest", async (_req: Request, res: Response) => {
    try {
      res.json(await getLatestBenchmarkRunSummary());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/content-plan", async (req: Request, res: Response) => {
    try {
      const runId = req.query.runId ? String(req.query.runId) : undefined;
      const limit = req.query.limit ? Number.parseInt(String(req.query.limit), 10) : 8;
      res.json(await generateContentPlan(runId, Number.isFinite(limit) ? limit : 8));
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
      });

      res.json(result);
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
        },
        (event) => {
          sendEvent(event.type, event);
        },
      );

      sendEvent("done", summary);
      res.end();
    } catch (error: any) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  });

  app.use("/api/blog/benchmark", router);
}
