import { randomUUID } from "crypto";
import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { companySettings } from "@shared/schema";
import { db } from "./db";
import {
  getBenchmarkRunSummary,
  getLatestBenchmarkRunSummary,
  type BenchmarkRunSummary,
} from "./aiBenchmark";
import {
  getCompanyContext,
  getCompanyIdFromRequest,
  requireBlogMutationRole,
  type CompanyContext,
} from "./companyContext";

const SERVICE_OPS_KEY = "serviceOps";

const PROSPECT_STATUSES = [
  "new",
  "contacted",
  "qualified",
  "audit_requested",
  "auditing",
  "proposal_sent",
  "active_client",
  "lost",
] as const;

type ProspectStatus = typeof PROSPECT_STATUSES[number];

interface Prospect {
  id: string;
  businessName: string;
  websiteUrl: string | null;
  city: string;
  niche: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  status: ProspectStatus;
  source: string | null;
  notes: string | null;
  tags: string[];
  priority: number;
  currentVisibilityScore: number | null;
  lastBenchmarkRunId: string | null;
  benchmarkSummary: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

interface OfferPackage {
  id: string;
  name: string;
  stage: "diagnostic" | "implementation" | "retainer";
  priceRange: string;
  billingCadence: "one_time" | "monthly";
  summary: string;
  bestFor: string[];
  deliverables: string[];
  proofPoints: string[];
  setupRequirements: string[];
  successMetrics: string[];
  cta: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ServiceOpsState {
  prospects: Prospect[];
  offerPackages: OfferPackage[];
}

interface ServicePackageCard {
  id: string;
  name: string;
  price: string;
  cadence: string;
  bestFor: string;
  description: string;
  deliverables: string[];
  outcomes: string[];
}

type BenchmarkQuerySummary = BenchmarkRunSummary["querySummaries"][number];
type BenchmarkGapSummary = BenchmarkRunSummary["biggestGaps"][number];

interface PromptPackInput {
  city: string;
  niche: string;
  businessName: string;
  websiteUrl: string | null;
  services: string[];
  competitors: string[];
}

interface CustomerFinderSearchInput {
  city: string;
  niche: string;
  query: string;
  limit: number;
  minRating: number | null;
  minReviews: number | null;
  requireWebsite: boolean;
}

interface CustomerFinderCandidate {
  id: string;
  source: "google_places";
  sourceId: string | null;
  businessName: string;
  websiteUrl: string | null;
  city: string;
  niche: string;
  phone: string | null;
  address: string | null;
  googleMapsUrl: string | null;
  rating: number | null;
  reviewCount: number | null;
  category: string | null;
  status: string | null;
  fitScore: number;
  fitReasons: string[];
  outreachAngle: string;
  promptAngle: string;
}

const DEFAULT_OFFERS: OfferPackage[] = [
  {
    id: "ai-visibility-snapshot",
    name: "AI Visibility Snapshot",
    stage: "diagnostic",
    priceRange: "$750-$1,500",
    billingCadence: "one_time",
    summary: "Baseline answer-share benchmark, prompt pack, citation review, and prioritized fix plan.",
    bestFor: [
      "Prospects that need proof before committing to implementation",
      "Local businesses unsure how they appear in AI answers",
      "Niches where competitors are already being recommended",
    ],
    deliverables: [
      "City and niche prompt pack across buyer, comparison, and local-intent questions",
      "Multi-provider visibility benchmark summary",
      "Mention, citation, and top-three recommendation readout",
      "30-day fix plan with owners, priority, and retest prompts",
    ],
    proofPoints: [
      "Shows exactly where the business is absent, mispositioned, or uncited",
      "Converts abstract AI visibility into query-level evidence",
      "Creates a concrete retest loop for the next sales step",
    ],
    setupRequirements: [
      "Business name, website, city, niche, and 3-5 competitors",
      "Core services or product categories",
      "Known proof assets such as reviews, certifications, awards, or case studies",
    ],
    successMetrics: [
      "Benchmark coverage established",
      "Highest-loss prompts identified",
      "Fix plan accepted or moved to implementation proposal",
    ],
    cta: "Offer a visibility snapshot before pitching ongoing implementation.",
    isDefault: true,
    createdAt: "2026-06-29T00:00:00.000Z",
    updatedAt: "2026-06-29T00:00:00.000Z",
  },
  {
    id: "answer-share-sprint",
    name: "30-Day Answer-Share Sprint",
    stage: "implementation",
    priceRange: "$2,500-$6,000",
    billingCadence: "one_time",
    summary: "Focused implementation sprint that fixes the highest-impact answer gaps and retests them.",
    bestFor: [
      "Prospects with a completed snapshot and clear answer gaps",
      "Businesses with thin service pages or weak local proof",
      "Teams that want a defined implementation window before a retainer",
    ],
    deliverables: [
      "Entity and positioning updates for priority pages",
      "FAQ, comparison, and proof-section briefs",
      "Citation/source target list",
      "Retest benchmark with before/after summary",
    ],
    proofPoints: [
      "Ties every edit to a failed or weak prompt",
      "Prioritizes source clarity before volume content",
      "Gives the client a short feedback cycle",
    ],
    setupRequirements: [
      "CMS or editor access, or an agreed handoff process",
      "Approved claims and proof assets",
      "Baseline benchmark summary",
    ],
    successMetrics: [
      "Priority prompts retested",
      "Average coverage score improved",
      "More answers mention or cite the target business",
    ],
    cta: "Use the snapshot findings to scope a fixed sprint.",
    isDefault: true,
    createdAt: "2026-06-29T00:00:00.000Z",
    updatedAt: "2026-06-29T00:00:00.000Z",
  },
  {
    id: "managed-ai-visibility-retainer",
    name: "Managed AI Visibility Retainer",
    stage: "retainer",
    priceRange: "$3,000-$8,000",
    billingCadence: "monthly",
    summary: "Ongoing benchmark, fix, publish, and retest cycle for AI answer visibility.",
    bestFor: [
      "Clients in competitive local niches",
      "Businesses expanding into new cities or services",
      "Teams that need monthly answer-share reporting",
    ],
    deliverables: [
      "Monthly benchmark refresh",
      "Prompt expansion and competitor watchlist updates",
      "Content and source-authority implementation backlog",
      "Executive visibility scorecard",
    ],
    proofPoints: [
      "Creates a recurring operating cadence",
      "Keeps prompt coverage aligned with real buyer questions",
      "Turns benchmark movement into client-facing reporting",
    ],
    setupRequirements: [
      "Approved monthly implementation capacity",
      "Access to analytics, CMS, and local proof sources where available",
      "Shared definition of priority cities, services, and competitors",
    ],
    successMetrics: [
      "Mention rate trend",
      "Citation rate trend",
      "Top-three recommendation rate trend",
      "Priority gap closure",
    ],
    cta: "Move sprint clients into a monthly benchmark and fix cycle.",
    isDefault: true,
    createdAt: "2026-06-29T00:00:00.000Z",
    updatedAt: "2026-06-29T00:00:00.000Z",
  },
];

const DEFAULT_PROMPT_PACK_TEMPLATES = [
  {
    id: "category-recommendation",
    name: "Category Recommendation",
    intent: "Find whether the brand is mentioned when buyers ask for a local shortlist.",
    prompt: "What are the best {category} providers for {audience} in {market}? Include why each option is worth considering.",
  },
  {
    id: "problem-solution",
    name: "Problem/Solution",
    intent: "Test whether answer engines connect the brand to urgent buyer pain.",
    prompt: "I am a {audience} dealing with {painPoint}. What should I compare before choosing a {category} solution?",
  },
  {
    id: "competitor-comparison",
    name: "Competitor Comparison",
    intent: "Reveal competitor framing, missing proof, and displacement opportunities.",
    prompt: "Compare {companyName} against {competitors} for {audience}. Where does each option fit best?",
  },
  {
    id: "purchase-readiness",
    name: "Purchase Readiness",
    intent: "Check whether AI answers surface proof that helps a buyer act.",
    prompt: "What evidence should I look for before buying from {companyName} for {category}? Include product, service, and trust signals.",
  },
  {
    id: "source-citation",
    name: "Citation Path",
    intent: "Identify which pages need stronger facts, structure, or external validation.",
    prompt: "Which sources should I trust when researching {category} options for {audience}, and what pages should answer my key questions?",
  },
];

const DEFAULT_OUTBOUND_SCRIPT_TEMPLATES = [
  {
    id: "cold-email",
    name: "Cold Email",
    channel: "Email",
    goal: "Open a conversation around measurable AI visibility gaps.",
    template: "Subject: Quick AI visibility check for {companyName}\n\nHi {contactName},\n\nI checked how answer engines respond when buyers ask about {category} in {market}. The useful question is not just whether {companyName} ranks in Google, but whether AI tools mention, cite, and explain it when a {audience} asks for options.\n\nWe run a short visibility audit that captures those prompts, compares competitors, and turns the misses into a fix queue your team can act on.\n\nWorth sending over a sample prompt pack for {companyName}?",
  },
  {
    id: "linkedin",
    name: "LinkedIn DM",
    channel: "LinkedIn",
    goal: "Create a low-friction follow-up after a profile view or warm touch.",
    template: "Hi {contactName}, I am mapping how AI tools answer buyer questions in {category}. If {companyName} is investing in content or local demand, the gap worth checking is whether ChatGPT, Claude, and Gemini actually name and cite you. I can send a small sample prompt pack if useful.",
  },
  {
    id: "audit-follow-up",
    name: "Audit Follow-Up",
    channel: "Email",
    goal: "Convert an audit review into a managed-service next step.",
    template: "Hi {contactName},\n\nThe audit showed practical fixes for {companyName}: expand answer-ready pages, tighten comparison language, and strengthen proof sources around {category}.\n\nThe monthly program handles that operating loop: retest prompts, ship fixes, document score movement, and keep a prioritized queue in front of the team.\n\nShould we review the first month plan together?",
  },
  {
    id: "call-opener",
    name: "Call Opener",
    channel: "Sales call",
    goal: "Frame the service in operational terms instead of generic SEO.",
    template: "The way we think about this is simple: when your best buyer asks an AI tool who to trust for {category}, do you show up, are you cited, and is the answer accurate enough to create demand? This ops program measures that, fixes the weak pages and proof gaps, then reports the movement every month.",
  },
];

const DEFAULT_AUDIT_CHECKLIST = [
  { id: "scope-prompts", label: "Confirm target audience, buying scenarios, and priority categories", owner: "Strategist", frequency: "Audit kickoff" },
  { id: "competitor-set", label: "Lock competitor set and known alternatives", owner: "Strategist", frequency: "Audit kickoff" },
  { id: "run-prompts", label: "Run prompt pack across selected AI providers", owner: "Analyst", frequency: "Audit execution" },
  { id: "capture-evidence", label: "Capture answers, citations, mentions, and sentiment notes", owner: "Analyst", frequency: "Audit execution" },
  { id: "map-gaps", label: "Map answer gaps to source, page, and message fixes", owner: "Content lead", frequency: "Audit synthesis" },
  { id: "score-readiness", label: "Score visibility, citation readiness, and content control", owner: "Strategist", frequency: "Audit synthesis" },
  { id: "build-report", label: "Prepare executive report and prioritized fix queue", owner: "Strategist", frequency: "Audit closeout" },
];

const DEFAULT_MONTHLY_FULFILLMENT_CHECKLIST = [
  { id: "monthly-retest", label: "Rerun priority prompt set and compare score movement", owner: "Analyst", frequency: "Week 1" },
  { id: "queue-triage", label: "Refresh fix queue with impact, owner, and effort", owner: "Strategist", frequency: "Week 1" },
  { id: "content-briefs", label: "Write briefs for new or updated answer-ready pages", owner: "Content lead", frequency: "Week 2" },
  { id: "page-edits", label: "Ship approved page edits, schema notes, and internal links", owner: "Editor", frequency: "Week 2-3" },
  { id: "source-work", label: "Improve citation sources, proof blocks, and third-party mentions", owner: "Strategist", frequency: "Week 3" },
  { id: "qa-retest", label: "Run QA prompts against fixed pages and record changes", owner: "Analyst", frequency: "Week 4" },
  { id: "client-report", label: "Send monthly report with wins, risks, and next sprint plan", owner: "Strategist", frequency: "Week 4" },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringFrom(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArrayFrom(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function numberFrom(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizeUrl(value: unknown): string | null {
  const input = stringFrom(value);
  if (!input) return null;
  const normalized = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  try {
    const url = new URL(normalized);
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72) || randomUUID();
}

function normalizeProspectStatus(value: unknown): ProspectStatus {
  return PROSPECT_STATUSES.includes(value as ProspectStatus) ? value as ProspectStatus : "new";
}

function normalizeProspect(value: unknown): Prospect | null {
  const item = asRecord(value);
  const businessName = stringFrom(item.businessName) || stringFrom(item.name);
  if (!businessName) return null;
  const now = new Date().toISOString();

  return {
    id: stringFrom(item.id) || randomUUID(),
    businessName,
    websiteUrl: normalizeUrl(item.websiteUrl || item.url),
    city: stringFrom(item.city) || "",
    niche: stringFrom(item.niche) || stringFrom(item.industry) || "",
    contactName: stringFrom(item.contactName),
    contactEmail: stringFrom(item.contactEmail || item.email),
    contactPhone: stringFrom(item.contactPhone || item.phone),
    status: normalizeProspectStatus(item.status),
    source: stringFrom(item.source),
    notes: stringFrom(item.notes),
    tags: stringArrayFrom(item.tags),
    priority: numberFrom(item.priority, 50, 0, 100),
    currentVisibilityScore: item.currentVisibilityScore === null
      ? null
      : typeof item.currentVisibilityScore === "number" && Number.isFinite(item.currentVisibilityScore)
        ? Math.min(100, Math.max(0, Math.round(item.currentVisibilityScore)))
        : null,
    lastBenchmarkRunId: stringFrom(item.lastBenchmarkRunId),
    benchmarkSummary: item.benchmarkSummary && typeof item.benchmarkSummary === "object"
      ? asRecord(item.benchmarkSummary)
      : null,
    createdAt: stringFrom(item.createdAt) || now,
    updatedAt: stringFrom(item.updatedAt) || now,
  };
}

function normalizeOfferStage(value: unknown): OfferPackage["stage"] {
  return value === "implementation" || value === "retainer" || value === "diagnostic" ? value : "diagnostic";
}

function normalizeBillingCadence(value: unknown): OfferPackage["billingCadence"] {
  return value === "monthly" ? "monthly" : "one_time";
}

function normalizeOfferPackage(value: unknown, fallback?: OfferPackage): OfferPackage | null {
  const item = asRecord(value);
  const name = stringFrom(item.name) || fallback?.name;
  if (!name) return null;
  const now = new Date().toISOString();

  return {
    id: stringFrom(item.id) || fallback?.id || slugify(name),
    name,
    stage: normalizeOfferStage(item.stage ?? fallback?.stage),
    priceRange: stringFrom(item.priceRange) || fallback?.priceRange || "Custom",
    billingCadence: normalizeBillingCadence(item.billingCadence ?? fallback?.billingCadence),
    summary: stringFrom(item.summary) || fallback?.summary || "",
    bestFor: stringArrayFrom(item.bestFor).length ? stringArrayFrom(item.bestFor) : fallback?.bestFor || [],
    deliverables: stringArrayFrom(item.deliverables).length ? stringArrayFrom(item.deliverables) : fallback?.deliverables || [],
    proofPoints: stringArrayFrom(item.proofPoints).length ? stringArrayFrom(item.proofPoints) : fallback?.proofPoints || [],
    setupRequirements: stringArrayFrom(item.setupRequirements).length
      ? stringArrayFrom(item.setupRequirements)
      : fallback?.setupRequirements || [],
    successMetrics: stringArrayFrom(item.successMetrics).length
      ? stringArrayFrom(item.successMetrics)
      : fallback?.successMetrics || [],
    cta: stringFrom(item.cta) || fallback?.cta || "",
    isDefault: Boolean(item.isDefault ?? fallback?.isDefault ?? false),
    createdAt: stringFrom(item.createdAt) || fallback?.createdAt || now,
    updatedAt: stringFrom(item.updatedAt) || now,
  };
}

function normalizeServiceOpsState(value: unknown): ServiceOpsState {
  const input = asRecord(value);
  const savedOffers = Array.isArray(input.offerPackages)
    ? input.offerPackages
        .map((offer) => normalizeOfferPackage(offer))
        .filter((offer): offer is OfferPackage => Boolean(offer))
    : [];
  const savedOfferById = new Map(savedOffers.map((offer) => [offer.id, offer]));
  const defaultOffers = DEFAULT_OFFERS.map((offer) => savedOfferById.get(offer.id) || offer);
  const extraOffers = savedOffers.filter((offer) => !DEFAULT_OFFERS.some((defaultOffer) => defaultOffer.id === offer.id));

  return {
    prospects: Array.isArray(input.prospects)
      ? input.prospects
          .map((prospect) => normalizeProspect(prospect))
          .filter((prospect): prospect is Prospect => Boolean(prospect))
      : [],
    offerPackages: [...defaultOffers, ...extraOffers],
  };
}

function offerToServicePackage(offer: OfferPackage): ServicePackageCard {
  return {
    id: offer.id,
    name: offer.name,
    price: offer.priceRange,
    cadence: offer.billingCadence === "monthly" ? "Monthly retainer" : "One-time sprint",
    bestFor: offer.bestFor.join("; "),
    description: offer.summary,
    deliverables: offer.deliverables,
    outcomes: offer.successMetrics.length ? offer.successMetrics : offer.proofPoints,
  };
}

function buildDashboardFixQueue(summary: BenchmarkRunSummary | null) {
  if (!summary || summary.querySummaries.length === 0) {
    return [
      {
        id: "comparison-page",
        title: "Create answer-ready comparison page for priority alternatives",
        area: "Content",
        priority: "High",
        status: "Ready",
        impact: "Improves competitor displacement prompts",
        owner: "Content lead",
        eta: "10 days",
      },
      {
        id: "proof-blocks",
        title: "Add proof blocks to priority pages",
        area: "Trust",
        priority: "High",
        status: "In review",
        impact: "Improves citation and confidence signals",
        owner: "Editor",
        eta: "5 days",
      },
      {
        id: "faq-expansion",
        title: "Expand FAQ answers around buying objections",
        area: "On-page",
        priority: "Medium",
        status: "Queued",
        impact: "Captures problem/solution prompts",
        owner: "Editor",
        eta: "14 days",
      },
      {
        id: "source-cleanup",
        title: "Clean up source list and external validation targets",
        area: "Sources",
        priority: "Medium",
        status: "Queued",
        impact: "Raises citation readiness",
        owner: "Strategist",
        eta: "21 days",
      },
    ];
  }

  return [...summary.querySummaries]
    .sort((a, b) => a.averageScore - b.averageScore || b.priority - a.priority)
    .slice(0, 6)
    .map((query, index) => ({
      id: `benchmark-gap-${query.queryId}`,
      title: `Ship answer-ready fix for "${query.query}"`,
      area: query.averageMentionRate < 35 ? "Visibility" : "Content",
      priority: index < 2 ? "High" : "Medium",
      status: "Ready",
      impact: `Current score ${query.averageScore}/100; mention rate ${query.averageMentionRate}%.`,
      owner: index < 2 ? "Strategist" : "Editor",
      eta: index < 2 ? "7 days" : "14 days",
    }));
}

function buildReportSummary(summary: BenchmarkRunSummary | null) {
  if (!summary || summary.querySummaries.length === 0) {
    return {
      currentScore: 46,
      targetScore: 72,
      promptCoverage: 64,
      citationRate: 18,
      summary: "The account has enough content to begin retesting, but AI answers still miss the brand on comparison and problem-aware prompts. The fastest gains should come from stronger proof blocks, clearer category pages, and a comparison asset that can be cited.",
      wins: [
        "Brand mentioned on direct-name and branded category prompts",
        "Existing pages give the team a short path to answer-ready edits",
        "Competitor gaps are clear enough to support a first-month sprint",
      ],
      risks: [
        "Low citation rate on generic buyer prompts",
        "Competitors are framed more clearly in shortlist answers",
        "Current content lacks structured proof for commercial buyers",
      ],
    };
  }

  const averageScore = Math.round(
    summary.querySummaries.reduce((sum, query) => sum + query.averageScore, 0) / summary.querySummaries.length,
  );
  const averageMentionRate = Math.round(
    summary.querySummaries.reduce((sum, query) => sum + query.averageMentionRate, 0) / summary.querySummaries.length,
  );
  const providerCitationRate = summary.providerSummaries.length
    ? Math.round(summary.providerSummaries.reduce((sum, provider) => sum + provider.citationRate, 0) / summary.providerSummaries.length)
    : 0;
  const topGap = summary.biggestGaps[0];

  return {
    currentScore: averageScore,
    targetScore: Math.min(100, Math.max(72, averageScore + 22)),
    promptCoverage: averageMentionRate,
    citationRate: providerCitationRate,
    summary: topGap
      ? `Latest benchmark shows ${summary.querySummaries.length} tracked prompts with an average score of ${averageScore}/100. Highest-priority gap: "${topGap.query}" on ${topGap.provider}.`
      : `Latest benchmark shows ${summary.querySummaries.length} tracked prompts with an average score of ${averageScore}/100. Next move is to turn the weakest prompts into page, FAQ, source, and comparison fixes.`,
    wins: summary.topWins.slice(0, 3).map((win) => `${win.provider} scored ${win.score}/100 on "${win.query}"`),
    risks: summary.biggestGaps.slice(0, 3).map((gap) => `${gap.provider} gap on "${gap.query}": ${gap.reason}`),
  };
}

async function buildServiceOpsDashboard(companyId: string) {
  const state = await loadServiceOpsState(companyId);
  const latestSummary = await getLatestBenchmarkRunSummary(companyId);
  return {
    servicePackages: state.offerPackages.map(offerToServicePackage),
    offerPackages: state.offerPackages,
    prospects: state.prospects,
    promptPackTemplates: DEFAULT_PROMPT_PACK_TEMPLATES,
    outboundScripts: DEFAULT_OUTBOUND_SCRIPT_TEMPLATES,
    auditChecklist: DEFAULT_AUDIT_CHECKLIST,
    monthlyFulfillmentChecklist: DEFAULT_MONTHLY_FULFILLMENT_CHECKLIST,
    fixQueue: buildDashboardFixQueue(latestSummary),
    reportSummary: buildReportSummary(latestSummary),
  };
}

async function getCompanySettingsRecord(companyId: string): Promise<Record<string, unknown>> {
  const [row] = await db
    .select()
    .from(companySettings)
    .where(eq(companySettings.companyId, companyId))
    .limit(1);
  return asRecord(row?.settings);
}

async function loadServiceOpsState(companyId: string): Promise<ServiceOpsState> {
  const settings = await getCompanySettingsRecord(companyId);
  return normalizeServiceOpsState(settings[SERVICE_OPS_KEY]);
}

async function persistServiceOpsState(companyId: string, state: ServiceOpsState): Promise<ServiceOpsState> {
  const existingSettings = await getCompanySettingsRecord(companyId);
  const nextSettings = {
    ...existingSettings,
    [SERVICE_OPS_KEY]: {
      prospects: state.prospects,
      offerPackages: state.offerPackages,
      updatedAt: new Date().toISOString(),
    },
  };

  const [existing] = await db
    .select({ id: companySettings.id })
    .from(companySettings)
    .where(eq(companySettings.companyId, companyId))
    .limit(1);

  if (existing) {
    await db
      .update(companySettings)
      .set({ settings: nextSettings, updatedAt: new Date() })
      .where(eq(companySettings.companyId, companyId));
  } else {
    await db.insert(companySettings).values({
      companyId,
      settings: nextSettings,
      updatedAt: new Date(),
    });
  }

  return state;
}

function prospectPayloadFromBody(body: unknown): Prospect {
  const candidate = normalizeProspect(body);
  if (!candidate) {
    throw new Error("businessName is required.");
  }
  return candidate;
}

function updateProspectPayload(existing: Prospect, body: unknown): Prospect {
  const input = asRecord(body);
  const merged = normalizeProspect({
    ...existing,
    ...input,
    id: existing.id,
    businessName: stringFrom(input.businessName) || stringFrom(input.name) || existing.businessName,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  });
  if (!merged) throw new Error("businessName is required.");
  return merged;
}

function promptPackInputFrom(body: unknown): PromptPackInput {
  const input = asRecord(body);
  const businessName = stringFrom(input.businessName) || stringFrom(input.name);
  const city = stringFrom(input.city);
  const niche = stringFrom(input.niche) || stringFrom(input.industry);
  if (!businessName || !city || !niche) {
    throw new Error("businessName, city, and niche are required.");
  }
  return {
    businessName,
    city,
    niche,
    websiteUrl: normalizeUrl(input.websiteUrl || input.url),
    services: stringArrayFrom(input.services),
    competitors: stringArrayFrom(input.competitors),
  };
}

function buildPromptPack(input: PromptPackInput, companyContext: CompanyContext) {
  const services = input.services.length ? input.services : [input.niche];
  const competitorPhrase = input.competitors.length
    ? ` Compare against ${input.competitors.slice(0, 5).join(", ")} where relevant.`
    : "";
  const brand = companyContext.brandProfile.displayName || companyContext.company.name;

  const promptTemplates = [
    {
      intent: "local_recommendation",
      priority: 100,
      prompt: `Who are the best ${input.niche} providers in ${input.city} for a customer who wants reliable service and clear proof?${competitorPhrase}`,
      visibilitySignal: "Target business appears in recommendation set with a reason tied to proof, location, or specialization.",
    },
    {
      intent: "comparison",
      priority: 95,
      prompt: `Compare ${input.businessName} with other ${input.niche} options in ${input.city}. What would make one provider a better fit than another?`,
      visibilitySignal: "Answer can identify the target business and position it accurately against alternatives.",
    },
    {
      intent: "buyer_question",
      priority: 90,
      prompt: `What should I ask before hiring a ${input.niche} company in ${input.city}? Include signs that a provider is trustworthy.`,
      visibilitySignal: "Answer includes criteria the business can prove on its own site and third-party profiles.",
    },
    {
      intent: "pain_point",
      priority: 85,
      prompt: `I need help with ${services[0]} in ${input.city}. Which ${input.niche} providers should I consider and why?`,
      visibilitySignal: "Target business surfaces for a concrete service or pain point.",
    },
    {
      intent: "entity_verification",
      priority: 80,
      prompt: `What does ${input.businessName} do, where is it located, and what services is it known for?`,
      visibilitySignal: "Answer has correct entity facts and does not confuse the business with another company.",
    },
    {
      intent: "source_citation",
      priority: 75,
      prompt: `Find credible sources about ${input.businessName}${input.websiteUrl ? ` (${input.websiteUrl})` : ""} and summarize what they prove about the business.`,
      visibilitySignal: "Answer cites the target site, local listings, reviews, or other credible proof sources.",
    },
    {
      intent: "near_me",
      priority: 70,
      prompt: `What ${input.niche} businesses near ${input.city} are worth shortlisting for ${services.slice(0, 3).join(", ")}?`,
      visibilitySignal: "Target business appears for near-me style local discovery prompts.",
    },
  ];

  return {
    generatedFor: {
      businessName: input.businessName,
      city: input.city,
      niche: input.niche,
      websiteUrl: input.websiteUrl,
      services,
      competitors: input.competitors,
    },
    operator: {
      companyId: companyContext.company.id,
      brand,
    },
    prompts: promptTemplates.map((template, index) => ({
      id: `${slugify(input.businessName)}-${template.intent}-${index + 1}`,
      providerTargets: ["chatgpt", "claude", "gemini_plain", "gemini_google_search"],
      expectedGoodAnswer: `${input.businessName} is mentioned accurately for ${input.niche} in ${input.city}, with support from owned or third-party proof sources.`,
      ...template,
    })),
    benchmarkConfig: {
      recommendedProviders: ["chatgpt", "claude", "gemini_plain", "gemini_google_search"],
      minPromptsForSnapshot: 5,
      retestCadence: "Run before fixes, after priority page updates, and again after source updates are indexed.",
    },
    usageNotes: [
      `Use this pack as a sales diagnostic for ${brand}'s managed AI visibility workflow.`,
      "Score mention presence, citation presence, top-three placement, and factual accuracy separately.",
      "Turn weak prompts into page edits, FAQ additions, local proof updates, or citation targets.",
    ],
  };
}

function buildOutboundScripts(input: PromptPackInput, companyContext: CompanyContext, offer?: OfferPackage | null) {
  const brand = companyContext.brandProfile.displayName || companyContext.company.name;
  const packageName = offer?.name || "AI Visibility Snapshot";
  const service = input.services[0] || input.niche;

  return {
    generatedFor: {
      businessName: input.businessName,
      city: input.city,
      niche: input.niche,
      websiteUrl: input.websiteUrl,
      packageName,
    },
    subjectLines: [
      `${input.businessName} in AI answers for ${input.city}`,
      `Quick visibility check for ${input.niche} searches`,
      `Are AI tools recommending ${input.businessName}?`,
    ],
    coldEmail: {
      opener: `I was checking how AI tools answer "${input.niche} in ${input.city}" questions and noticed there is usually a clear winner set in those answers.`,
      body: `For ${input.businessName}, the useful question is not just whether your site ranks in Google. It is whether ChatGPT, Claude, and Gemini understand what you do, when to recommend you, and which sources prove it.\n\n${brand} runs a ${packageName}: a prompt pack, benchmark summary, and prioritized fix plan for the city/service questions your buyers are likely to ask.`,
      close: `Worth sending over a small sample prompt pack for ${service} in ${input.city}?`,
    },
    linkedinDm: `Noticed ${input.businessName} serves ${input.city} in ${input.niche}. We are helping businesses see whether AI answers mention, cite, or skip them when buyers ask for local recommendations. I can send a short prompt sample if useful.`,
    voicemail: `Hi, this is a quick note for ${input.businessName}. We are checking how AI tools recommend ${input.niche} providers in ${input.city}. I wanted to share what those answers look like and where your business is or is not showing up. I will send a short email with the details.`,
    followUps: [
      `I can keep this simple: 5-7 buyer prompts, screenshots or exports from the major AI tools, and a fix list ranked by impact.`,
      `The first pass usually shows whether the issue is entity clarity, weak service-page proof, missing citations, or competitor answer-share.`,
      `If you already track SEO, this sits beside it: same buyer intent, different answer surface.`,
    ],
    discoveryQuestions: [
      `Which ${input.niche} services in ${input.city} are highest value for you right now?`,
      "Which competitors do buyers compare you against most often?",
      "What proof assets are strongest: reviews, case studies, certifications, photos, local awards, or partner listings?",
      "Who can approve website copy or profile updates if the benchmark finds gaps?",
    ],
  };
}

function querySummaryFromUnknown(value: unknown): BenchmarkQuerySummary[] {
  const input = asRecord(value);
  const summaries = Array.isArray(input.querySummaries) ? input.querySummaries : [];
  const normalized: BenchmarkQuerySummary[] = [];

  for (const summary of summaries) {
    const item = asRecord(summary);
    const query = stringFrom(item.query);
    if (!query) continue;
    normalized.push({
      queryId: stringFrom(item.queryId) || randomUUID(),
      query,
      category: stringFrom(item.category) || "unknown",
      label: stringFrom(item.label),
      verticalId: stringFrom(item.verticalId),
      priority: numberFrom(item.priority, 50, 0, 100),
      persona: stringFrom(item.persona),
      painPoint: stringFrom(item.painPoint),
      iboltAngle: stringFrom(item.iboltAngle) || stringFrom(item.brandAngle),
      targetProducts: stringArrayFrom(item.targetProducts),
      benchmarkBaseline: item.benchmarkBaseline && typeof item.benchmarkBaseline === "object"
        ? asRecord(item.benchmarkBaseline)
        : null,
      averageScore: numberFrom(item.averageScore, 0, 0, 100),
      averageMentionRate: numberFrom(item.averageMentionRate, 0, 0, 100),
      weakestProviders: [],
      results: [],
    });
  }

  return normalized;
}

function biggestGapsFromUnknown(value: unknown): BenchmarkGapSummary[] {
  const input = asRecord(value);
  const gaps = Array.isArray(input.biggestGaps) ? input.biggestGaps : [];
  const normalized: BenchmarkGapSummary[] = [];

  for (const gap of gaps) {
    const item = asRecord(gap);
    const query = stringFrom(item.query);
    if (!query) continue;
    normalized.push({
      queryId: stringFrom(item.queryId) || randomUUID(),
      query,
      provider: "chatgpt",
      score: numberFrom(item.score, 0, 0, 100),
      reason: stringFrom(item.reason) || "Low benchmark score or missing target-brand coverage.",
    });
  }

  return normalized;
}

function buildFixPlanFromSummary(
  summary: BenchmarkRunSummary | Record<string, unknown> | null,
  input: {
    businessName: string;
    city: string;
    niche: string;
    websiteUrl: string | null;
  },
) {
  const querySummaries = summary && "querySummaries" in summary && Array.isArray(summary.querySummaries)
    ? summary.querySummaries
    : querySummaryFromUnknown(summary);
  const biggestGaps = summary && "biggestGaps" in summary && Array.isArray(summary.biggestGaps)
    ? summary.biggestGaps
    : biggestGapsFromUnknown(summary);
  const providerSummaries = summary && "providerSummaries" in summary && Array.isArray(summary.providerSummaries)
    ? summary.providerSummaries
    : [];

  const weakQueries = [...querySummaries]
    .sort((a, b) => a.averageScore - b.averageScore || b.priority - a.priority)
    .slice(0, 5);
  const gapQueries = biggestGaps.slice(0, 5);
  const averageScore = querySummaries.length
    ? Math.round(querySummaries.reduce((sum, query) => sum + query.averageScore, 0) / querySummaries.length)
    : null;
  const mentionRate = querySummaries.length
    ? Math.round(querySummaries.reduce((sum, query) => sum + query.averageMentionRate, 0) / querySummaries.length)
    : null;

  const tasks = [
    {
      id: "entity-profile",
      phase: "entity_clarity",
      priority: 100,
      title: `Clarify ${input.businessName} entity facts on owned pages`,
      why: "AI answers need consistent business name, city, niche, services, and proof before they can recommend the business reliably.",
      actions: [
        `Add or tighten an about/service intro that states ${input.businessName}, ${input.city}, ${input.niche}, and primary service areas.`,
        "Make phone, address/service area, hours, reviews, and proof assets easy to parse.",
        "Use the same business name and service language across site title tags, headings, schema, and profiles.",
      ],
      retestPrompts: [
        `What does ${input.businessName} do in ${input.city}?`,
        `Is ${input.businessName} a good option for ${input.niche} services?`,
      ],
    },
    {
      id: "priority-service-pages",
      phase: "content_fixes",
      priority: 90,
      title: "Build or improve pages for weak buyer prompts",
      why: weakQueries.length
        ? `Lowest-scoring prompts include: ${weakQueries.map((query) => `"${query.query}"`).join("; ")}.`
        : "No detailed query summary was available, so start with buyer-intent pages for the main niche and city.",
      actions: [
        "Map each weak prompt to one page or section that answers it directly.",
        "Add decision criteria, service details, local proof, and clear next steps.",
        "Avoid generic claims; use verifiable reviews, photos, credentials, project examples, or policies.",
      ],
      retestPrompts: weakQueries.slice(0, 3).map((query) => query.query),
    },
    {
      id: "source-citation",
      phase: "citation_fixes",
      priority: 80,
      title: "Strengthen sources AI tools can cite",
      why: "Citation gaps usually come from thin owned pages, inconsistent listings, or missing third-party proof.",
      actions: [
        "Update Google Business Profile, key directories, review profiles, partner listings, and social profiles with the same positioning.",
        "Create a source list for reviews, credentials, local awards, case studies, and press mentions.",
        "Add concise FAQ answers that cite owned proof and match real buyer questions.",
      ],
      retestPrompts: [
        `Find credible sources about ${input.businessName}${input.websiteUrl ? ` (${input.websiteUrl})` : ""}.`,
        `Which ${input.niche} providers in ${input.city} have strong proof?`,
      ],
    },
    {
      id: "competitor-positioning",
      phase: "competitive_positioning",
      priority: 70,
      title: "Create comparison language for answer-share gaps",
      why: gapQueries.length
        ? `Largest benchmark gaps include provider-specific misses on: ${gapQueries.map((gap) => `"${gap.query}"`).join("; ")}.`
        : "AI answers often prefer businesses with clearer differentiators and comparison-ready proof.",
      actions: [
        "Document where the business is a better fit and where it is not.",
        "Add comparison-safe copy that explains fit, service area, response model, specialties, and proof.",
        "Prepare sales-approved language for common alternatives and objections.",
      ],
      retestPrompts: gapQueries.slice(0, 3).map((gap) => gap.query),
    },
    {
      id: "retest-loop",
      phase: "measurement",
      priority: 60,
      title: "Retest after every implementation batch",
      why: "The managed-service value comes from showing before/after movement, not just publishing fixes.",
      actions: [
        "Rerun the same benchmark prompts after priority updates are live.",
        "Track mention rate, citation rate, top-three placement, factual accuracy, and average score.",
        "Move prompts that still fail into the next implementation batch.",
      ],
      retestPrompts: [
        ...weakQueries.slice(0, 2).map((query) => query.query),
        ...gapQueries.slice(0, 2).map((gap) => gap.query),
      ].filter(Boolean),
    },
  ];

  return {
    generatedFor: input,
    benchmarkAvailable: Boolean(summary),
    scorecard: {
      averageScore,
      averageMentionRate: mentionRate,
      providers: providerSummaries.map((provider) => ({
        provider: provider.provider,
        mentionRate: provider.mentionRate,
        citationRate: provider.citationRate,
        topThreeRate: provider.topThreeRate,
        avgScore: provider.avgScore,
      })),
    },
    priorityQueries: weakQueries.map((query) => ({
      queryId: query.queryId,
      query: query.query,
      category: query.category,
      averageScore: query.averageScore,
      averageMentionRate: query.averageMentionRate,
      priority: query.priority,
    })),
    biggestGaps: gapQueries,
    tasks,
    recommendedOffer: averageScore === null || averageScore < 45
      ? "30-Day Answer-Share Sprint"
      : averageScore < 70
        ? "AI Visibility Snapshot plus focused implementation sprint"
        : "Managed AI Visibility Retainer",
  };
}

function fixPlanInputFrom(body: unknown, prospect?: Prospect | null) {
  const input = asRecord(body);
  const businessName = stringFrom(input.businessName) || stringFrom(input.name) || prospect?.businessName;
  const city = stringFrom(input.city) || prospect?.city;
  const niche = stringFrom(input.niche) || stringFrom(input.industry) || prospect?.niche;
  if (!businessName || !city || !niche) {
    throw new Error("businessName, city, and niche are required unless prospectId has those fields.");
  }
  return {
    businessName,
    city,
    niche,
    websiteUrl: normalizeUrl(input.websiteUrl || input.url) || prospect?.websiteUrl || null,
  };
}

function getGooglePlacesApiKey() {
  return process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || "";
}

function buildCustomerFinderConfig() {
  const hasGooglePlacesKey = Boolean(getGooglePlacesApiKey());
  return {
    googlePlacesConfigured: hasGooglePlacesKey,
    provider: hasGooglePlacesKey ? "google_places" : "not_configured",
    envNames: ["GOOGLE_MAPS_API_KEY", "GOOGLE_PLACES_API_KEY"],
    maxPageSize: 20,
    supports: [
      "Local business discovery",
      "Website, phone, rating, review count, and map URL capture",
      "Lead fit scoring",
      "One-click prospect import",
    ],
  };
}

function optionalNumberFrom(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return null;
  return Math.min(max, Math.max(min, parsed));
}

function customerFinderSearchInputFrom(body: unknown): CustomerFinderSearchInput {
  const input = asRecord(body);
  const city = stringFrom(input.city);
  const niche = stringFrom(input.niche) || stringFrom(input.industry) || stringFrom(input.category);
  if (!city || !niche) {
    throw new Error("city and niche are required.");
  }
  const query = stringFrom(input.query) || `${niche} in ${city}`;
  return {
    city,
    niche,
    query,
    limit: numberFrom(input.limit, 20, 1, 20),
    minRating: optionalNumberFrom(input.minRating, 0, 5),
    minReviews: optionalNumberFrom(input.minReviews, 0, 1000000),
    requireWebsite: Boolean(input.requireWebsite ?? true),
  };
}

function titleCasePlaceType(value: string | null) {
  if (!value) return null;
  return value
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function scoreCustomerFinderCandidate(candidate: {
  websiteUrl: string | null;
  phone: string | null;
  rating: number | null;
  reviewCount: number | null;
  category: string | null;
  status: string | null;
}) {
  let score = 35;
  if (candidate.websiteUrl) score += 22;
  if (candidate.phone) score += 8;
  if (candidate.category) score += 5;
  if (candidate.status === "OPERATIONAL") score += 5;

  if (candidate.rating !== null) {
    if (candidate.rating >= 4.7) score += 15;
    else if (candidate.rating >= 4.3) score += 12;
    else if (candidate.rating >= 4) score += 8;
    else if (candidate.rating < 3.5) score -= 8;
  }

  if (candidate.reviewCount !== null) {
    if (candidate.reviewCount >= 250) score += 15;
    else if (candidate.reviewCount >= 100) score += 12;
    else if (candidate.reviewCount >= 30) score += 8;
    else if (candidate.reviewCount > 0) score += 4;
  }

  return Math.min(100, Math.max(0, Math.round(score)));
}

function buildCustomerFinderReasons(candidate: CustomerFinderCandidate) {
  const reasons = [
    candidate.websiteUrl
      ? "Has a public website we can audit, rewrite, and retest for AI visibility."
      : "No website returned by Places, so verify the owned site before pitching implementation.",
    candidate.rating !== null && candidate.reviewCount !== null
      ? `${candidate.rating.toFixed(1)} rating with ${candidate.reviewCount} Google reviews gives us proof signals to cite.`
      : "Rating or review count is missing, so the first audit should verify trust signals.",
    candidate.category
      ? `Places category came back as ${candidate.category}, which helps build local-intent prompt packs.`
      : "Category needs manual confirmation before outreach.",
    candidate.phone
      ? "Phone number is available for enrichment or manual contact research."
      : "No phone number returned; use website/contact-page enrichment next.",
  ];
  return reasons.slice(0, 4);
}

function buildCustomerFinderAngles(input: CustomerFinderSearchInput, businessName: string) {
  const buyerPrompt = `What are the best ${input.niche} options in ${input.city}, and which ones have strong proof?`;
  return {
    outreachAngle: `Open with the AI-visibility question: "When buyers ask ChatGPT for ${input.niche} in ${input.city}, does ${businessName} show up with proof, or do competitors get named first?"`,
    promptAngle: buyerPrompt,
  };
}

function shouldKeepCustomerFinderCandidate(candidate: CustomerFinderCandidate, input: CustomerFinderSearchInput) {
  if (input.requireWebsite && !candidate.websiteUrl) return false;
  if (input.minRating !== null && candidate.rating !== null && candidate.rating < input.minRating) return false;
  if (input.minReviews !== null && candidate.reviewCount !== null && candidate.reviewCount < input.minReviews) return false;
  return true;
}

function customerFinderCandidateFromGooglePlace(
  place: Record<string, unknown>,
  input: CustomerFinderSearchInput,
): CustomerFinderCandidate | null {
  const displayName = asRecord(place.displayName);
  const businessName = stringFrom(displayName.text) || stringFrom(place.name);
  if (!businessName) return null;

  const types = Array.isArray(place.types) ? place.types : [];
  const primaryType = stringFrom(place.primaryType) || stringFrom(types[0]);
  const base = {
    sourceId: stringFrom(place.id),
    websiteUrl: normalizeUrl(place.websiteUri),
    phone: stringFrom(place.nationalPhoneNumber) || stringFrom(place.internationalPhoneNumber),
    address: stringFrom(place.formattedAddress),
    googleMapsUrl: normalizeUrl(place.googleMapsUri),
    rating: numberOrNull(place.rating),
    reviewCount: numberOrNull(place.userRatingCount),
    category: titleCasePlaceType(primaryType),
    status: stringFrom(place.businessStatus),
  };
  const angles = buildCustomerFinderAngles(input, businessName);
  const candidate: CustomerFinderCandidate = {
    id: `google-places-${slugify(base.sourceId || businessName)}`,
    source: "google_places",
    businessName,
    city: input.city,
    niche: input.niche,
    ...base,
    fitScore: scoreCustomerFinderCandidate(base),
    fitReasons: [],
    ...angles,
  };
  candidate.fitReasons = buildCustomerFinderReasons(candidate);
  return candidate;
}

async function searchGooglePlacesForCustomers(input: CustomerFinderSearchInput) {
  const apiKey = getGooglePlacesApiKey();
  if (!apiKey) {
    return {
      provider: "not_configured",
      needsGoogleKey: true,
      candidates: [] as CustomerFinderCandidate[],
      message: "Google Places is not configured. Add GOOGLE_MAPS_API_KEY or GOOGLE_PLACES_API_KEY to .env, restart the server, then run the finder.",
    };
  }

  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.nationalPhoneNumber",
        "places.internationalPhoneNumber",
        "places.websiteUri",
        "places.googleMapsUri",
        "places.rating",
        "places.userRatingCount",
        "places.businessStatus",
        "places.primaryType",
        "places.types",
      ].join(","),
    },
    body: JSON.stringify({
      textQuery: input.query,
      pageSize: input.limit,
    }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Google Places search failed (${response.status}): ${responseText.slice(0, 500)}`);
  }

  const payload = responseText ? JSON.parse(responseText) : {};
  const places = Array.isArray(payload.places) ? payload.places : [];
  const candidates = places
    .map((place: unknown) => customerFinderCandidateFromGooglePlace(asRecord(place), input))
    .filter((candidate: CustomerFinderCandidate | null): candidate is CustomerFinderCandidate => Boolean(candidate))
    .filter((candidate: CustomerFinderCandidate) => shouldKeepCustomerFinderCandidate(candidate, input))
    .sort((a: CustomerFinderCandidate, b: CustomerFinderCandidate) => b.fitScore - a.fitScore);

  return {
    provider: "google_places",
    needsGoogleKey: false,
    candidates,
    rawCount: places.length,
    message: `Found ${candidates.length} matching businesses from ${places.length} Google Places results.`,
  };
}

function importedCustomerCandidateToProspect(value: unknown): Prospect | null {
  const input = asRecord(value);
  const businessName = stringFrom(input.businessName) || stringFrom(input.name);
  const city = stringFrom(input.city);
  const niche = stringFrom(input.niche) || stringFrom(input.category);
  if (!businessName || !city || !niche) return null;

  const rating = numberOrNull(input.rating);
  const reviewCount = numberOrNull(input.reviewCount);
  const notes = [
    stringFrom(input.address) ? `Address: ${stringFrom(input.address)}` : null,
    stringFrom(input.googleMapsUrl) ? `Google Maps: ${stringFrom(input.googleMapsUrl)}` : null,
    rating !== null ? `Google rating: ${rating}${reviewCount !== null ? ` (${reviewCount} reviews)` : ""}` : null,
    stringFrom(input.outreachAngle) ? `Outreach angle: ${stringFrom(input.outreachAngle)}` : null,
    stringFrom(input.promptAngle) ? `Starter prompt: ${stringFrom(input.promptAngle)}` : null,
  ].filter(Boolean).join("\n");

  return normalizeProspect({
    businessName,
    websiteUrl: input.websiteUrl,
    city,
    niche,
    contactPhone: input.phone,
    status: "new",
    source: stringFrom(input.source) || "customer_finder",
    notes,
    tags: [
      "customer-finder",
      stringFrom(input.source),
      stringFrom(input.category),
      rating !== null && rating >= 4.5 ? "high-rating" : null,
      reviewCount !== null && reviewCount >= 100 ? "review-rich" : null,
    ].filter(Boolean),
    priority: numberFrom(input.fitScore, 50, 0, 100),
  });
}

function isSameProspect(left: Prospect, right: Prospect) {
  const leftWebsite = left.websiteUrl?.toLowerCase() || "";
  const rightWebsite = right.websiteUrl?.toLowerCase() || "";
  if (leftWebsite && rightWebsite && leftWebsite === rightWebsite) return true;
  return left.businessName.toLowerCase() === right.businessName.toLowerCase()
    && left.city.toLowerCase() === right.city.toLowerCase();
}

export function registerServiceOpsRoutes(app: { use: (path: string, router: Router) => void }) {
  const router = Router();
  router.use(requireBlogMutationRole("editor"));

  router.get("/", async (req: Request, res: Response) => {
    try {
      res.json(await buildServiceOpsDashboard(getCompanyIdFromRequest(req)));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/customer-finder/config", (_req: Request, res: Response) => {
    res.json(buildCustomerFinderConfig());
  });

  router.post("/customer-finder/search", async (req: Request, res: Response) => {
    try {
      const input = customerFinderSearchInputFrom(req.body);
      const result = await searchGooglePlacesForCustomers(input);
      res.json({
        search: input,
        ...result,
      });
    } catch (error: any) {
      const status = error.message?.includes("required") ? 400 : error.message?.includes("Google Places search failed") ? 502 : 500;
      res.status(status).json({ error: error.message });
    }
  });

  router.post("/customer-finder/import", async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      const body = asRecord(req.body);
      const incoming = Array.isArray(body.candidates)
        ? body.candidates
        : body.candidate
          ? [body.candidate]
          : [];
      if (!incoming.length) {
        return res.status(400).json({ error: "candidate or candidates are required." });
      }

      const state = await loadServiceOpsState(companyId);
      const imported: Prospect[] = [];
      const skipped: Prospect[] = [];

      for (const candidate of incoming) {
        const prospect = importedCustomerCandidateToProspect(candidate);
        if (!prospect) continue;
        if (state.prospects.some((existing) => isSameProspect(existing, prospect)) || imported.some((existing) => isSameProspect(existing, prospect))) {
          skipped.push(prospect);
          continue;
        }
        imported.push({
          ...prospect,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }

      if (imported.length) {
        state.prospects = [...imported, ...state.prospects];
        await persistServiceOpsState(companyId, state);
      }

      res.status(imported.length ? 201 : 200).json({
        importedCount: imported.length,
        skippedCount: skipped.length,
        imported,
        skipped,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/prospects", async (req: Request, res: Response) => {
    try {
      const state = await loadServiceOpsState(getCompanyIdFromRequest(req));
      const status = stringFrom(req.query.status);
      const prospects = status
        ? state.prospects.filter((prospect) => prospect.status === status)
        : state.prospects;
      res.json({ prospects });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/prospects", async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      const state = await loadServiceOpsState(companyId);
      const prospect = prospectPayloadFromBody(req.body);
      prospect.createdAt = new Date().toISOString();
      prospect.updatedAt = prospect.createdAt;
      state.prospects = [prospect, ...state.prospects];
      await persistServiceOpsState(companyId, state);
      res.status(201).json({ prospect });
    } catch (error: any) {
      res.status(error.message?.includes("required") ? 400 : 500).json({ error: error.message });
    }
  });

  router.patch("/prospects/:id", async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      const state = await loadServiceOpsState(companyId);
      const index = state.prospects.findIndex((prospect) => prospect.id === req.params.id);
      if (index < 0) return res.status(404).json({ error: "Prospect not found." });
      const prospect = updateProspectPayload(state.prospects[index], req.body);
      state.prospects[index] = prospect;
      await persistServiceOpsState(companyId, state);
      res.json({ prospect });
    } catch (error: any) {
      res.status(error.message?.includes("required") ? 400 : 500).json({ error: error.message });
    }
  });

  router.get("/offers", async (req: Request, res: Response) => {
    try {
      const state = await loadServiceOpsState(getCompanyIdFromRequest(req));
      res.json({ offers: state.offerPackages });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/packages", async (req: Request, res: Response) => {
    try {
      const state = await loadServiceOpsState(getCompanyIdFromRequest(req));
      res.json({
        servicePackages: state.offerPackages.map(offerToServicePackage),
        offerPackages: state.offerPackages,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/service-packages", async (req: Request, res: Response) => {
    try {
      const state = await loadServiceOpsState(getCompanyIdFromRequest(req));
      res.json({
        servicePackages: state.offerPackages.map(offerToServicePackage),
        offerPackages: state.offerPackages,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/offers", async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      const state = await loadServiceOpsState(companyId);
      const offer = normalizeOfferPackage({
        ...asRecord(req.body),
        id: stringFrom(asRecord(req.body).id) || slugify(stringFrom(asRecord(req.body).name) || "custom-offer"),
        isDefault: false,
      });
      if (!offer) return res.status(400).json({ error: "name is required." });
      if (state.offerPackages.some((existing) => existing.id === offer.id)) {
        return res.status(409).json({ error: "An offer with this id already exists." });
      }
      state.offerPackages = [...state.offerPackages, offer];
      await persistServiceOpsState(companyId, state);
      res.status(201).json({ offer });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch("/offers/:id", async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      const state = await loadServiceOpsState(companyId);
      const index = state.offerPackages.findIndex((offer) => offer.id === req.params.id);
      if (index < 0) return res.status(404).json({ error: "Offer not found." });
      const offer = normalizeOfferPackage(
        {
          ...state.offerPackages[index],
          ...asRecord(req.body),
          id: state.offerPackages[index].id,
          updatedAt: new Date().toISOString(),
        },
        state.offerPackages[index],
      );
      if (!offer) return res.status(400).json({ error: "name is required." });
      state.offerPackages[index] = offer;
      await persistServiceOpsState(companyId, state);
      res.json({ offer });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/prompt-pack", async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      const input = promptPackInputFrom(req.body);
      res.json(buildPromptPack(input, await getCompanyContext(companyId)));
    } catch (error: any) {
      res.status(error.message?.includes("required") ? 400 : 500).json({ error: error.message });
    }
  });

  const generatePromptPackAlias = async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      const body = asRecord(req.body);
      const companyContext = await getCompanyContext(companyId);
      const input = promptPackInputFrom({
        businessName: stringFrom(body.businessName) || companyContext.company.name,
        city: stringFrom(body.city) || companyContext.company.primaryMarket || "local market",
        niche: stringFrom(body.niche) || stringFrom(body.category) || companyContext.brandProfile.shortDescription || "local service",
        websiteUrl: stringFrom(body.websiteUrl) || companyContext.company.websiteUrl,
        services: stringArrayFrom(body.services).length ? stringArrayFrom(body.services) : stringArrayFrom(body.categories),
        competitors: stringArrayFrom(body.competitors).length
          ? stringArrayFrom(body.competitors)
          : companyContext.competitors.map((competitor) => competitor.name),
      });
      res.json(buildPromptPack(input, companyContext));
    } catch (error: any) {
      res.status(error.message?.includes("required") ? 400 : 500).json({ error: error.message });
    }
  };

  router.post("/generate-local-prompt-pack", generatePromptPackAlias);
  router.post("/local-prompt-pack/generate", generatePromptPackAlias);
  router.post("/local-prompt-pack", generatePromptPackAlias);
  router.post("/prompt-pack/local", generatePromptPackAlias);

  router.get("/checklists", (_req: Request, res: Response) => {
    res.json({
      auditChecklist: DEFAULT_AUDIT_CHECKLIST,
      monthlyFulfillmentChecklist: DEFAULT_MONTHLY_FULFILLMENT_CHECKLIST,
    });
  });

  router.get("/service-checklists", (_req: Request, res: Response) => {
    res.json({
      auditChecklist: DEFAULT_AUDIT_CHECKLIST,
      monthlyFulfillmentChecklist: DEFAULT_MONTHLY_FULFILLMENT_CHECKLIST,
    });
  });

  router.get("/outbound-scripts", async (req: Request, res: Response) => {
    try {
      const companyContext = await getCompanyContext(getCompanyIdFromRequest(req));
      res.json({
        scripts: buildOutboundScripts(
          {
            businessName: "Example Business",
            city: "Example City",
            niche: "local service",
            websiteUrl: null,
            services: ["priority service"],
            competitors: [],
          },
          companyContext,
          DEFAULT_OFFERS[0],
        ),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  const buildOutboundSnapshotAlias = async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      const body = asRecord(req.body);
      const companyContext = await getCompanyContext(companyId);
      const input = {
        businessName: stringFrom(body.businessName) || companyContext.company.name,
        city: stringFrom(body.city) || companyContext.company.primaryMarket || "local market",
        niche: stringFrom(body.niche) || stringFrom(body.category) || companyContext.brandProfile.shortDescription || "local service",
        websiteUrl: normalizeUrl(body.websiteUrl || companyContext.company.websiteUrl),
      };
      const benchmarkSummary = stringFrom(body.runId)
        ? await getBenchmarkRunSummary(stringFrom(body.runId) as string, companyId)
        : await getLatestBenchmarkRunSummary(companyId);
      const promptPack = buildPromptPack({
        ...input,
        services: stringArrayFrom(body.services),
        competitors: stringArrayFrom(body.competitors).length
          ? stringArrayFrom(body.competitors)
          : companyContext.competitors.map((competitor) => competitor.name),
      }, companyContext);
      const outbound = buildOutboundScripts({
        ...input,
        services: stringArrayFrom(body.services),
        competitors: stringArrayFrom(body.competitors),
      }, companyContext, DEFAULT_OFFERS[0]);
      const fixPlan = buildFixPlanFromSummary(benchmarkSummary, input);
      res.json({
        generatedAt: new Date().toISOString(),
        promptPack,
        outbound,
        fixPlan,
      });
    } catch (error: any) {
      res.status(error.message?.includes("required") ? 400 : 500).json({ error: error.message });
    }
  };

  router.post("/build-outbound-snapshot", buildOutboundSnapshotAlias);
  router.post("/outbound-snapshot/build", buildOutboundSnapshotAlias);
  router.post("/outbound-snapshot", buildOutboundSnapshotAlias);
  router.post("/snapshots/outbound", buildOutboundSnapshotAlias);

  router.post("/outbound-scripts/generate", async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      const state = await loadServiceOpsState(companyId);
      const body = asRecord(req.body);
      const prospect = stringFrom(body.prospectId)
        ? state.prospects.find((candidate) => candidate.id === body.prospectId) || null
        : null;
      const input = promptPackInputFrom({
        ...body,
        businessName: stringFrom(body.businessName) || prospect?.businessName,
        city: stringFrom(body.city) || prospect?.city,
        niche: stringFrom(body.niche) || prospect?.niche,
        websiteUrl: stringFrom(body.websiteUrl) || prospect?.websiteUrl,
      });
      const offer = stringFrom(body.offerId)
        ? state.offerPackages.find((candidate) => candidate.id === body.offerId) || null
        : DEFAULT_OFFERS[0];
      res.json(buildOutboundScripts(input, await getCompanyContext(companyId), offer));
    } catch (error: any) {
      res.status(error.message?.includes("required") ? 400 : 500).json({ error: error.message });
    }
  });

  router.post("/fix-plan", async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      const state = await loadServiceOpsState(companyId);
      const body = asRecord(req.body);
      const prospect = stringFrom(body.prospectId)
        ? state.prospects.find((candidate) => candidate.id === body.prospectId) || null
        : null;
      const input = fixPlanInputFrom(body, prospect);
      const runId = stringFrom(body.runId) || prospect?.lastBenchmarkRunId;
      const submittedSummary = body.benchmarkSummary && typeof body.benchmarkSummary === "object"
        ? asRecord(body.benchmarkSummary)
        : prospect?.benchmarkSummary;
      const benchmarkSummary = runId
        ? await getBenchmarkRunSummary(runId, companyId)
        : submittedSummary
          ? submittedSummary
          : await getLatestBenchmarkRunSummary(companyId);
      const fixPlan = buildFixPlanFromSummary(benchmarkSummary, input);

      if (prospect && fixPlan.benchmarkAvailable) {
        const index = state.prospects.findIndex((candidate) => candidate.id === prospect.id);
        if (index >= 0) {
          state.prospects[index] = {
            ...state.prospects[index],
            currentVisibilityScore: fixPlan.scorecard.averageScore,
            lastBenchmarkRunId: runId || state.prospects[index].lastBenchmarkRunId,
            benchmarkSummary: submittedSummary || state.prospects[index].benchmarkSummary,
            updatedAt: new Date().toISOString(),
          };
          await persistServiceOpsState(companyId, state);
        }
      }

      res.json(fixPlan);
    } catch (error: any) {
      res.status(error.message?.includes("required") ? 400 : 500).json({ error: error.message });
    }
  });

  app.use("/api/blog/service-ops", router);
}
