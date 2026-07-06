import { useQuery } from "@tanstack/react-query";
import { companyScopedUrl, getCompanyScopedHeaders, useActiveCompanyId } from "@/lib/company";

export type ServicePackage = {
  id: string;
  name: string;
  price: string;
  cadence: string;
  bestFor: string;
  description: string;
  deliverables: string[];
  outcomes: string[];
};

export type PromptPackTemplate = {
  id: string;
  name: string;
  intent: string;
  prompt: string;
};

export type OutboundScript = {
  id: string;
  name: string;
  channel: string;
  goal: string;
  template: string;
};

export type OpsChecklistItem = {
  id: string;
  label: string;
  owner: string;
  frequency: string;
};

export type FixQueueItem = {
  id: string;
  title: string;
  area: string;
  priority: "High" | "Medium" | "Low";
  status: string;
  impact: string;
  owner: string;
  eta: string;
};

export type ReportSummary = {
  currentScore: number;
  targetScore: number;
  promptCoverage: number;
  citationRate: number;
  summary: string;
  wins: string[];
  risks: string[];
};

export type ServiceOpsData = {
  servicePackages: ServicePackage[];
  promptPackTemplates: PromptPackTemplate[];
  outboundScripts: OutboundScript[];
  auditChecklist: OpsChecklistItem[];
  monthlyFulfillmentChecklist: OpsChecklistItem[];
  fixQueue: FixQueueItem[];
  reportSummary: ReportSummary;
  source: "api" | "local";
};

export const SERVICE_OPS_DEFAULTS: ServiceOpsData = {
  source: "local",
  servicePackages: [
    {
      id: "visibility-audit",
      name: "AI Visibility Audit",
      price: "$1,500 one-time",
      cadence: "7 business days",
      bestFor: "Prospects who need a baseline before committing to retainers.",
      description: "A focused diagnostic that measures how the brand appears in answer engines and what content fixes are most likely to move the score.",
      deliverables: [
        "Prompt pack across category, comparison, local, and buying-intent queries",
        "AI answer capture with mention, citation, and sentiment notes",
        "Competitor visibility map",
        "Prioritized fix queue with page-level recommendations",
      ],
      outcomes: ["Baseline score", "Fastest fixes", "Retainer scope"],
    },
    {
      id: "monthly-control",
      name: "Monthly Visibility Control",
      price: "$3,500/mo",
      cadence: "Monthly sprint",
      bestFor: "Brands that already publish content but are not being recommended by ChatGPT, Claude, Perplexity, or Gemini.",
      description: "A managed monthly program for prompt testing, source strengthening, content edits, and executive reporting.",
      deliverables: [
        "Monthly prompt retest and gap analysis",
        "4-8 content updates or new answer assets",
        "Citation and source readiness improvements",
        "Client report with score movement and next actions",
      ],
      outcomes: ["More answer mentions", "Clear backlog", "Executive-ready reporting"],
    },
    {
      id: "category-domination",
      name: "Category Domination",
      price: "$7,500/mo",
      cadence: "Biweekly operating rhythm",
      bestFor: "Category leaders or challenger brands targeting high-value commercial queries.",
      description: "A higher-touch operating program for broader prompt coverage, competitor displacement, and ongoing entity authority work.",
      deliverables: [
        "100+ prompt coverage map with priority segments",
        "Biweekly fix queue triage and publishing support",
        "Competitor displacement playbooks",
        "Sales enablement packet for AI visibility proof",
      ],
      outcomes: ["Category coverage", "Competitor pressure", "Sales proof"],
    },
  ],
  promptPackTemplates: [
    {
      id: "category-recommendation",
      name: "Category Recommendation",
      intent: "Find whether the brand is mentioned when buyers ask for a shortlist.",
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
  ],
  outboundScripts: [
    {
      id: "cold-email",
      name: "Cold Email",
      channel: "Email",
      goal: "Open a conversation around measurable AI visibility gaps.",
      template: "Subject: Quick AI visibility check for {companyName}\n\nHi {contactName},\n\nI checked how answer engines tend to respond when buyers ask about {category}. The useful question is not just whether {companyName} ranks in Google, but whether AI tools mention, cite, and explain it when a {audience} asks for options.\n\nWe run a short visibility audit that captures those prompts, compares competitors, and turns the misses into a fix queue your team can act on.\n\nWorth sending over a sample prompt pack for {companyName}?",
    },
    {
      id: "linkedin",
      name: "LinkedIn DM",
      channel: "LinkedIn",
      goal: "Create a low-friction follow-up after a profile view or warm touch.",
      template: "Hi {contactName}, I am mapping how AI tools answer buyer questions in {category}. If {companyName} is investing in content or demand gen, the gap worth checking is whether ChatGPT, Claude, Gemini, and Perplexity actually name and cite you. I can send a small sample prompt pack if useful.",
    },
    {
      id: "audit-follow-up",
      name: "Audit Follow-Up",
      channel: "Email",
      goal: "Convert an audit review into a managed-service next step.",
      template: "Hi {contactName},\n\nThe audit showed three practical fixes for {companyName}: expand answer-ready pages, tighten comparison language, and strengthen proof sources around {category}.\n\nThe monthly program handles that operating loop: retest prompts, ship fixes, document score movement, and keep a prioritized queue in front of the team.\n\nShould we review the first month plan together?",
    },
    {
      id: "call-opener",
      name: "Call Opener",
      channel: "Sales call",
      goal: "Frame the service in operational terms instead of generic SEO.",
      template: "The way we think about this is simple: when your best buyer asks an AI tool who to trust for {category}, do you show up, are you cited, and is the answer accurate enough to create demand? This ops program measures that, fixes the weak pages and proof gaps, then reports the movement every month.",
    },
  ],
  auditChecklist: [
    { id: "scope-prompts", label: "Confirm target audience, buying scenarios, and priority categories", owner: "Strategist", frequency: "Audit kickoff" },
    { id: "competitor-set", label: "Lock competitor set and known alternatives", owner: "Strategist", frequency: "Audit kickoff" },
    { id: "run-prompts", label: "Run prompt pack across selected AI providers", owner: "Analyst", frequency: "Audit execution" },
    { id: "capture-evidence", label: "Capture answers, citations, mentions, and sentiment notes", owner: "Analyst", frequency: "Audit execution" },
    { id: "map-gaps", label: "Map answer gaps to source, page, and message fixes", owner: "Content lead", frequency: "Audit synthesis" },
    { id: "score-readiness", label: "Score visibility, citation readiness, and content control", owner: "Strategist", frequency: "Audit synthesis" },
    { id: "build-report", label: "Prepare executive report and prioritized fix queue", owner: "Strategist", frequency: "Audit closeout" },
  ],
  monthlyFulfillmentChecklist: [
    { id: "monthly-retest", label: "Rerun priority prompt set and compare score movement", owner: "Analyst", frequency: "Week 1" },
    { id: "queue-triage", label: "Refresh fix queue with impact, owner, and effort", owner: "Strategist", frequency: "Week 1" },
    { id: "content-briefs", label: "Write briefs for new or updated answer-ready pages", owner: "Content lead", frequency: "Week 2" },
    { id: "page-edits", label: "Ship approved page edits, schema notes, and internal links", owner: "Editor", frequency: "Week 2-3" },
    { id: "source-work", label: "Improve citation sources, proof blocks, and third-party mentions", owner: "Strategist", frequency: "Week 3" },
    { id: "qa-retest", label: "Run QA prompts against fixed pages and record changes", owner: "Analyst", frequency: "Week 4" },
    { id: "client-report", label: "Send monthly report with wins, risks, and next sprint plan", owner: "Strategist", frequency: "Week 4" },
  ],
  fixQueue: [
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
      title: "Add proof blocks to category pages",
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
  ],
  reportSummary: {
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
  },
};

function withSource(data: Omit<ServiceOpsData, "source">, source: ServiceOpsData["source"]): ServiceOpsData {
  return { ...data, source };
}

function isNonEmptyArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0;
}

function normalizeServiceOpsData(payload: unknown): ServiceOpsData {
  const raw = ((payload as any)?.data || payload || {}) as Partial<ServiceOpsData>;

  return {
    source: "api",
    servicePackages: isNonEmptyArray(raw.servicePackages) ? raw.servicePackages as ServicePackage[] : SERVICE_OPS_DEFAULTS.servicePackages,
    promptPackTemplates: isNonEmptyArray(raw.promptPackTemplates) ? raw.promptPackTemplates as PromptPackTemplate[] : SERVICE_OPS_DEFAULTS.promptPackTemplates,
    outboundScripts: isNonEmptyArray(raw.outboundScripts) ? raw.outboundScripts as OutboundScript[] : SERVICE_OPS_DEFAULTS.outboundScripts,
    auditChecklist: isNonEmptyArray(raw.auditChecklist) ? raw.auditChecklist as OpsChecklistItem[] : SERVICE_OPS_DEFAULTS.auditChecklist,
    monthlyFulfillmentChecklist: isNonEmptyArray(raw.monthlyFulfillmentChecklist)
      ? raw.monthlyFulfillmentChecklist as OpsChecklistItem[]
      : SERVICE_OPS_DEFAULTS.monthlyFulfillmentChecklist,
    fixQueue: isNonEmptyArray(raw.fixQueue) ? raw.fixQueue as FixQueueItem[] : SERVICE_OPS_DEFAULTS.fixQueue,
    reportSummary: raw.reportSummary || SERVICE_OPS_DEFAULTS.reportSummary,
  };
}

export function useServiceOps() {
  const activeCompanyId = useActiveCompanyId();
  const url = companyScopedUrl("/api/blog/service-ops");

  return useQuery<ServiceOpsData>({
    queryKey: [url, activeCompanyId || "local"],
    queryFn: async () => {
      if (!activeCompanyId) {
        return SERVICE_OPS_DEFAULTS;
      }

      try {
        const res = await fetch(url, {
          headers: getCompanyScopedHeaders(),
          credentials: "include",
        });

        if (!res.ok) {
          return SERVICE_OPS_DEFAULTS;
        }

        return normalizeServiceOpsData(await res.json());
      } catch {
        return withSource(SERVICE_OPS_DEFAULTS, "local");
      }
    },
  });
}
