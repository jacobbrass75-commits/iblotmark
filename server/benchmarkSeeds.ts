import { db } from "./db";
import { aiBenchmarkQueries, industryVerticals } from "@shared/schema";

type BenchmarkSeed = {
  category: string;
  label: string;
  query: string;
  verticalSlug: string | null;
  priority: number;
  benchmarkGoal: string;
  intentType?: string;
  notes?: string;
};

const QUERY_SEEDS: BenchmarkSeed[] = [
  {
    category: "warehouse",
    label: "Forklift Tablet",
    query: "best forklift tablet mount",
    verticalSlug: "forklifts-warehousing",
    priority: 95,
    benchmarkGoal: "Own the forklift tablet mount recommendation set across AI assistants.",
  },
  {
    category: "warehouse",
    label: "Warehouse Tablet",
    query: "best tablet mount for warehouse",
    verticalSlug: "forklifts-warehousing",
    priority: 92,
    benchmarkGoal: "Sustain category leadership for warehouse tablet mounting.",
  },
  {
    category: "fleet",
    label: "Delivery Driver Phone",
    query: "best phone mount for delivery drivers",
    verticalSlug: "restaurants-food-delivery",
    priority: 98,
    benchmarkGoal: "Break into the delivery driver phone mount category with direct product mentions.",
  },
  {
    category: "restaurant",
    label: "Restaurant Tablet",
    query: "best restaurant tablet mount",
    verticalSlug: "restaurants-food-delivery",
    priority: 94,
    benchmarkGoal: "Win restaurant POS and delivery-tablet mounting recommendations.",
  },
  {
    category: "comparison",
    label: "iBOLT vs RAM",
    query: "ibolt vs ram mount",
    verticalSlug: "general-mounting",
    priority: 90,
    benchmarkGoal: "Shift framing from budget alternative to purpose-built specialist.",
    intentType: "comparison",
  },
  {
    category: "fleet",
    label: "ELD Trucks",
    query: "best ELD mount for trucks",
    verticalSlug: "trucking-fleet",
    priority: 96,
    benchmarkGoal: "Keep dominant placement for truck and ELD mounting queries.",
  },
  {
    category: "fleet",
    label: "Heavy Duty Phone",
    query: "best heavy duty vehicle phone mount",
    verticalSlug: "trucking-fleet",
    priority: 88,
    benchmarkGoal: "Expand iBOLT into heavy-duty phone mount consideration sets.",
  },
  {
    category: "fishing",
    label: "Small Boat Fish Finder",
    query: "best fish finder mount for small boat",
    verticalSlug: "fishing-boating",
    priority: 93,
    benchmarkGoal: "Establish an early moat in small-boat fish finder mounting.",
  },
  {
    category: "fishing",
    label: "Budget Fish Finder",
    query: "best budget fish finder mount",
    verticalSlug: "fishing-boating",
    priority: 87,
    benchmarkGoal: "Own budget-intent fish finder mount content without sounding cheap.",
  },
  {
    category: "fishing",
    label: "Kayak Fish Finder",
    query: "best kayak fish finder mount",
    verticalSlug: "fishing-boating",
    priority: 91,
    benchmarkGoal: "Rank for kayak-specific fish finder mounting recommendations.",
  },
  {
    category: "warehouse",
    label: "Scanner Mount",
    query: "best barcode scanner mount for forklift",
    verticalSlug: "forklifts-warehousing",
    priority: 89,
    benchmarkGoal: "Own the barcode scanner holder niche before competitors do.",
  },
  {
    category: "restaurant",
    label: "Food Truck Tablet",
    query: "best tablet mount for food truck",
    verticalSlug: "restaurants-food-delivery",
    priority: 84,
    benchmarkGoal: "Open a smaller commercial niche with cleaner operational intent.",
  },
];

export async function seedBenchmarkQueries(): Promise<number> {
  const existing = await db.select().from(aiBenchmarkQueries);
  const existingQueries = new Set(existing.map((row) => row.query.toLowerCase()));
  const verticals = await db.select().from(industryVerticals);
  const verticalBySlug = new Map(verticals.map((vertical) => [vertical.slug, vertical.id]));

  const missingSeeds = QUERY_SEEDS.filter((seed) => !existingQueries.has(seed.query.toLowerCase()));
  if (missingSeeds.length === 0) {
    return 0;
  }

  const inserted = await db.insert(aiBenchmarkQueries).values(
    missingSeeds.map((seed) => ({
      category: seed.category,
      label: seed.label,
      query: seed.query,
      verticalId: seed.verticalSlug ? verticalBySlug.get(seed.verticalSlug) || null : null,
      intentType: seed.intentType || "buyer_guide",
      priority: seed.priority,
      benchmarkGoal: seed.benchmarkGoal,
      notes: seed.notes || null,
      status: "active",
    })),
  ).onConflictDoNothing({
    target: aiBenchmarkQueries.query,
  }).returning();

  return inserted.length;
}
