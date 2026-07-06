import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Bot,
  Briefcase,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Copy,
  Download,
  FileText,
  Gauge,
  Globe2,
  Mail,
  MapPin,
  MessageSquare,
  PackageCheck,
  Phone,
  Search,
  Star,
  UserPlus,
  Users,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  SERVICE_OPS_DEFAULTS,
  type OpsChecklistItem,
  type ServicePackage,
  useServiceOps,
} from "@/hooks/useServiceOps";
import { copyTextToClipboard } from "@/lib/clipboard";
import { companyScopedUrl, getCompanyScopedHeaders, useActiveCompanyId } from "@/lib/company";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type ProspectIntake = {
  companyName: string;
  website: string;
  contactName: string;
  category: string;
  audience: string;
  market: string;
  competitors: string;
  priorityPages: string;
  painPoints: string;
  currentGoal: string;
  notes: string;
  budgetRange: string;
};

type CustomerFinderCandidate = {
  id: string;
  source: string;
  sourceId?: string | null;
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
};

type FinderConfig = {
  googlePlacesConfigured: boolean;
  provider: string;
  envNames: string[];
};

type FinderForm = {
  city: string;
  niche: string;
  query: string;
  limit: string;
  minRating: string;
  minReviews: string;
  requireWebsite: boolean;
};

const DEFAULT_INTAKE: ProspectIntake = {
  companyName: "iBolt Mounts",
  website: "https://iboltmounts.com",
  contactName: "Yakub",
  category: "commercial device mounting solutions",
  audience: "fleet, warehouse, and field operations teams",
  market: "United States",
  competitors: "RAM Mounts, ProClip, Arkon",
  priorityPages: "/collections/forklift-tablet-mounts, /collections/truck-mounts, /blogs/news",
  painPoints: "unclear compatibility, weak proof on comparison queries, and low citation coverage",
  currentGoal: "Increase AI answer mentions for commercial mounting use cases and turn gaps into monthly fixes.",
  notes: "Focus on buyer prompts where the customer asks for durable options, ELD-ready mounting, AMPS compatibility, or rugged tablet setups.",
  budgetRange: "$3,500-$7,500/mo",
};

const DEFAULT_FINDER_FORM: FinderForm = {
  city: "Scottsdale, AZ",
  niche: "med spa",
  query: "",
  limit: "20",
  minRating: "4",
  minReviews: "20",
  requireWebsite: true,
};

const TOKEN_LABELS: Record<string, keyof ProspectIntake> = {
  companyName: "companyName",
  contactName: "contactName",
  category: "category",
  audience: "audience",
  market: "market",
  competitors: "competitors",
  painPoint: "painPoints",
};

function replaceTokens(template: string, intake: ProspectIntake): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const intakeKey = TOKEN_LABELS[key];
    if (!intakeKey) return match;
    return intake[intakeKey]?.trim() || match;
  });
}

function seedChecklistState(current: Record<string, boolean>, items: OpsChecklistItem[]): Record<string, boolean> {
  let changed = false;
  const next = { ...current };

  for (const item of items) {
    if (!(item.id in next)) {
      next[item.id] = false;
      changed = true;
    }
  }

  return changed ? next : current;
}

function getChecklistProgress(items: OpsChecklistItem[], checked: Record<string, boolean>) {
  if (items.length === 0) return 0;
  const complete = items.filter((item) => checked[item.id]).length;
  return Math.round((complete / items.length) * 100);
}

function packageToClipboard(pkg: ServicePackage) {
  return [
    `${pkg.name} - ${pkg.price}`,
    `Cadence: ${pkg.cadence}`,
    `Best for: ${pkg.bestFor}`,
    "",
    pkg.description,
    "",
    "Deliverables:",
    ...pkg.deliverables.map((item) => `- ${item}`),
    "",
    "Outcomes:",
    ...pkg.outcomes.map((item) => `- ${item}`),
  ].join("\n");
}

function csvEscape(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function customerFinderCandidatesToCsv(candidates: CustomerFinderCandidate[]) {
  const headers = [
    "Business",
    "Website",
    "Phone",
    "City",
    "Niche",
    "Rating",
    "Reviews",
    "Score",
    "Address",
    "Google Maps",
    "Outreach Angle",
  ];
  const rows = candidates.map((candidate) => [
    candidate.businessName,
    candidate.websiteUrl,
    candidate.phone,
    candidate.city,
    candidate.niche,
    candidate.rating,
    candidate.reviewCount,
    candidate.fitScore,
    candidate.address,
    candidate.googleMapsUrl,
    candidate.outreachAngle,
  ]);
  return [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
}

export default function ServiceOps() {
  const { toast } = useToast();
  const activeCompanyId = useActiveCompanyId();
  const queryClient = useQueryClient();
  const { data: ops = SERVICE_OPS_DEFAULTS, isFetching } = useServiceOps();
  const [selectedPackageId, setSelectedPackageId] = useState(SERVICE_OPS_DEFAULTS.servicePackages[1].id);
  const [intake, setIntake] = useState<ProspectIntake>(DEFAULT_INTAKE);
  const [finderForm, setFinderForm] = useState<FinderForm>(DEFAULT_FINDER_FORM);
  const [finderConfig, setFinderConfig] = useState<FinderConfig | null>(null);
  const [finderResults, setFinderResults] = useState<CustomerFinderCandidate[]>([]);
  const [finderStatus, setFinderStatus] = useState<string | null>(null);
  const [finderProvider, setFinderProvider] = useState("not_configured");
  const [finderLoading, setFinderLoading] = useState(false);
  const [importingLeadId, setImportingLeadId] = useState<string | null>(null);
  const [auditChecked, setAuditChecked] = useState<Record<string, boolean>>({});
  const [monthlyChecked, setMonthlyChecked] = useState<Record<string, boolean>>({});
  const [reportDraft, setReportDraft] = useState(SERVICE_OPS_DEFAULTS.reportSummary.summary);

  useEffect(() => {
    if (!activeCompanyId) return;
    let cancelled = false;

    fetch(companyScopedUrl("/api/blog/service-ops/customer-finder/config"), {
      headers: getCompanyScopedHeaders(),
      credentials: "include",
    })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!cancelled && data) {
          setFinderConfig(data);
          setFinderProvider(data.provider || "not_configured");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFinderConfig(null);
          setFinderProvider("not_configured");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeCompanyId]);

  useEffect(() => {
    if (!ops.servicePackages.some((pkg) => pkg.id === selectedPackageId)) {
      setSelectedPackageId(ops.servicePackages[0]?.id || SERVICE_OPS_DEFAULTS.servicePackages[0].id);
    }
  }, [ops.servicePackages, selectedPackageId]);

  useEffect(() => {
    setAuditChecked((current) => seedChecklistState(current, ops.auditChecklist));
  }, [ops.auditChecklist]);

  useEffect(() => {
    setMonthlyChecked((current) => seedChecklistState(current, ops.monthlyFulfillmentChecklist));
  }, [ops.monthlyFulfillmentChecklist]);

  useEffect(() => {
    setReportDraft(ops.reportSummary.summary);
  }, [ops.reportSummary.summary]);

  const selectedPackage = useMemo(
    () => ops.servicePackages.find((pkg) => pkg.id === selectedPackageId) || ops.servicePackages[0] || SERVICE_OPS_DEFAULTS.servicePackages[0],
    [ops.servicePackages, selectedPackageId],
  );

  const generatedPrompts = useMemo(
    () => ops.promptPackTemplates.map((template) => ({
      ...template,
      prompt: replaceTokens(template.prompt, intake),
    })),
    [ops.promptPackTemplates, intake],
  );

  const generatedScripts = useMemo(
    () => ops.outboundScripts.map((script) => ({
      ...script,
      template: replaceTokens(script.template, intake),
    })),
    [ops.outboundScripts, intake],
  );

  const promptPackText = useMemo(
    () => generatedPrompts.map((prompt, index) => `${index + 1}. ${prompt.name}\nIntent: ${prompt.intent}\nPrompt: ${prompt.prompt}`).join("\n\n"),
    [generatedPrompts],
  );

  const selectedPackageText = useMemo(() => packageToClipboard(selectedPackage), [selectedPackage]);
  const auditProgress = getChecklistProgress(ops.auditChecklist, auditChecked);
  const monthlyProgress = getChecklistProgress(ops.monthlyFulfillmentChecklist, monthlyChecked);
  const highPriorityFixes = ops.fixQueue.filter((item) => item.priority === "High").length;

  const copyToClipboard = async (label: string, value: string) => {
    try {
      await copyTextToClipboard(value);
      toast({ title: `${label} copied` });
    } catch (error: any) {
      toast({ title: "Copy failed", description: error.message, variant: "destructive" });
    }
  };

  const updateIntake = (field: keyof ProspectIntake, value: string) => {
    setIntake((current) => ({ ...current, [field]: value }));
  };

  const updateFinderForm = <Key extends keyof FinderForm>(field: Key, value: FinderForm[Key]) => {
    setFinderForm((current) => ({ ...current, [field]: value }));
  };

  const runCustomerFinderSearch = async () => {
    setFinderLoading(true);
    setFinderStatus(null);
    try {
      const response = await apiRequest("POST", "/api/blog/service-ops/customer-finder/search", {
        ...finderForm,
        limit: Number(finderForm.limit) || 20,
        minRating: finderForm.minRating === "" ? null : Number(finderForm.minRating),
        minReviews: finderForm.minReviews === "" ? null : Number(finderForm.minReviews),
      });
      const data = await response.json();
      setFinderResults(Array.isArray(data.candidates) ? data.candidates : []);
      setFinderProvider(data.provider || "unknown");
      setFinderStatus(data.message || `Found ${data.candidates?.length || 0} candidates.`);
      if (data.needsGoogleKey) {
        toast({
          title: "Google Places key needed",
          description: "Add GOOGLE_MAPS_API_KEY or GOOGLE_PLACES_API_KEY to .env, then restart the server.",
        });
      }
    } catch (error: any) {
      setFinderStatus(error.message);
      toast({ title: "Finder search failed", description: error.message, variant: "destructive" });
    } finally {
      setFinderLoading(false);
    }
  };

  const importCustomerFinderCandidate = async (candidate: CustomerFinderCandidate) => {
    setImportingLeadId(candidate.id);
    try {
      const response = await apiRequest("POST", "/api/blog/service-ops/customer-finder/import", {
        candidates: [candidate],
      });
      const data = await response.json();
      await queryClient.invalidateQueries({
        queryKey: [companyScopedUrl("/api/blog/service-ops"), activeCompanyId || "local"],
      });
      toast({
        title: data.importedCount ? "Prospect imported" : "Prospect already exists",
        description: data.importedCount
          ? `${candidate.businessName} is now in the service ops prospect list.`
          : `${candidate.businessName} matched an existing prospect.`,
      });
    } catch (error: any) {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    } finally {
      setImportingLeadId(null);
    }
  };

  const loadCandidateIntoIntake = (candidate: CustomerFinderCandidate) => {
    setIntake((current) => ({
      ...current,
      companyName: candidate.businessName,
      website: candidate.websiteUrl || "",
      contactName: "",
      category: candidate.niche,
      audience: `buyers looking for ${candidate.niche}`,
      market: candidate.city,
      competitors: "",
      painPoints: "unknown AI answer visibility, weak citation readiness, and competitor answer-share risk",
      currentGoal: `Find whether ${candidate.businessName} shows up when buyers ask AI tools for ${candidate.niche} in ${candidate.city}.`,
      notes: [
        candidate.address ? `Address: ${candidate.address}` : null,
        candidate.rating !== null ? `Google rating: ${candidate.rating}${candidate.reviewCount !== null ? ` (${candidate.reviewCount} reviews)` : ""}` : null,
        candidate.outreachAngle,
      ].filter(Boolean).join("\n"),
    }));
    toast({ title: "Loaded into intake", description: "Prompt pack and scripts now use this prospect." });
  };

  return (
    <main className="container mx-auto max-w-7xl px-4 py-6 space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">AI Visibility Service Ops</h1>
            <Badge variant={ops.source === "api" ? "secondary" : "outline"}>
              {ops.source === "api" ? "API data" : "Local defaults"}
            </Badge>
            {isFetching && <Badge variant="outline">Checking endpoint</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            Managed-service packaging, intake, prompt testing, outbound scripts, fulfillment checklists, and fix reporting.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => copyToClipboard("Selected package", selectedPackageText)}>
            <Copy className="h-4 w-4" />
            Copy package
          </Button>
          <Button size="sm" onClick={() => copyToClipboard("Prompt pack", promptPackText)}>
            <ClipboardList className="h-4 w-4" />
            Copy prompts
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Gauge className="h-4 w-4" />
              Current score
            </div>
            <div className="mt-2 text-3xl font-semibold">{ops.reportSummary.currentScore}</div>
            <Progress value={ops.reportSummary.currentScore} className="mt-3 h-2" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Bot className="h-4 w-4" />
              Prompt coverage
            </div>
            <div className="mt-2 text-3xl font-semibold">{ops.reportSummary.promptCoverage}%</div>
            <Progress value={ops.reportSummary.promptCoverage} className="mt-3 h-2" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FileText className="h-4 w-4" />
              Citation rate
            </div>
            <div className="mt-2 text-3xl font-semibold">{ops.reportSummary.citationRate}%</div>
            <Progress value={ops.reportSummary.citationRate} className="mt-3 h-2" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Wrench className="h-4 w-4" />
              High-priority fixes
            </div>
            <div className="mt-2 text-3xl font-semibold">{highPriorityFixes}</div>
            <div className="mt-3 text-xs text-muted-foreground">{ops.fixQueue.length} total queued actions</div>
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Service Packages</h2>
            <p className="text-sm text-muted-foreground">Select the package that should drive the intake and sales context.</p>
          </div>
          <Badge variant="outline">{selectedPackage.cadence}</Badge>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {ops.servicePackages.map((pkg) => {
            const selected = pkg.id === selectedPackageId;
            return (
              <button
                key={pkg.id}
                type="button"
                className={cn(
                  "rounded-lg border bg-background p-4 text-left transition-colors hover:bg-muted/50",
                  selected && "border-primary bg-primary/5",
                )}
                onClick={() => setSelectedPackageId(pkg.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Briefcase className="h-4 w-4" />
                      {pkg.name}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">{pkg.price}</div>
                  </div>
                  {selected && <Badge>Selected</Badge>}
                </div>
                <p className="mt-3 text-sm text-muted-foreground">{pkg.description}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {pkg.outcomes.map((outcome) => (
                    <Badge key={outcome} variant="outline" className="max-w-full whitespace-normal break-words text-left text-xs leading-5">
                      {outcome}
                    </Badge>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <Tabs defaultValue="finder" className="space-y-4">
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="finder">Finder</TabsTrigger>
          <TabsTrigger value="intake">Intake</TabsTrigger>
          <TabsTrigger value="prompts">Prompt Pack</TabsTrigger>
          <TabsTrigger value="scripts">Scripts</TabsTrigger>
          <TabsTrigger value="checklists">Checklists</TabsTrigger>
          <TabsTrigger value="queue">Fix Queue</TabsTrigger>
        </TabsList>

        <TabsContent value="finder">
          <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Search className="h-4 w-4" />
                      Potential Customer Finder
                    </CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Find local businesses, score audit fit, and import qualified prospects.
                    </p>
                  </div>
                  <Badge variant={finderConfig?.googlePlacesConfigured ? "secondary" : "outline"}>
                    {finderConfig?.googlePlacesConfigured ? "Google Places" : "Needs key"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {!finderConfig?.googlePlacesConfigured && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        <div className="font-medium">Google Places is not configured yet.</div>
                        <div className="mt-1">
                          Add <span className="font-mono">GOOGLE_MAPS_API_KEY</span> or <span className="font-mono">GOOGLE_PLACES_API_KEY</span> to the server env.
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                  <div className="space-y-2">
                    <Label htmlFor="finderCity">City</Label>
                    <Input id="finderCity" value={finderForm.city} onChange={(event) => updateFinderForm("city", event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="finderNiche">Niche</Label>
                    <Input id="finderNiche" value={finderForm.niche} onChange={(event) => updateFinderForm("niche", event.target.value)} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="finderQuery">Search query</Label>
                  <Input
                    id="finderQuery"
                    placeholder={`${finderForm.niche || "business"} in ${finderForm.city || "city"}`}
                    value={finderForm.query}
                    onChange={(event) => updateFinderForm("query", event.target.value)}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="finderLimit">Limit</Label>
                    <Input id="finderLimit" type="number" min="1" max="20" value={finderForm.limit} onChange={(event) => updateFinderForm("limit", event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="finderRating">Min rating</Label>
                    <Input id="finderRating" type="number" min="0" max="5" step="0.1" value={finderForm.minRating} onChange={(event) => updateFinderForm("minRating", event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="finderReviews">Min reviews</Label>
                    <Input id="finderReviews" type="number" min="0" value={finderForm.minReviews} onChange={(event) => updateFinderForm("minReviews", event.target.value)} />
                  </div>
                </div>

                <label className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm">
                  <Checkbox
                    checked={finderForm.requireWebsite}
                    onCheckedChange={(checked) => updateFinderForm("requireWebsite", Boolean(checked))}
                  />
                  <span>
                    <span className="block font-medium">Require website</span>
                    <span className="text-xs text-muted-foreground">Keeps the list focused on businesses we can audit and edit.</span>
                  </span>
                </label>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={runCustomerFinderSearch} disabled={finderLoading || !activeCompanyId}>
                    <Search className="h-4 w-4" />
                    {finderLoading ? "Searching..." : "Find customers"}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!finderResults.length}
                    onClick={() => copyToClipboard("Finder CSV", customerFinderCandidatesToCsv(finderResults))}
                  >
                    <Download className="h-4 w-4" />
                    Copy CSV
                  </Button>
                </div>

                {!activeCompanyId && (
                  <div className="text-sm text-muted-foreground">
                    Choose or create a company workspace before running lead discovery.
                  </div>
                )}
                {finderStatus && (
                  <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                    {finderStatus}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Users className="h-4 w-4" />
                      Leads found
                    </div>
                    <div className="mt-2 text-2xl font-semibold">{finderResults.length}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Gauge className="h-4 w-4" />
                      Avg score
                    </div>
                    <div className="mt-2 text-2xl font-semibold">
                      {finderResults.length
                        ? Math.round(finderResults.reduce((sum, candidate) => sum + candidate.fitScore, 0) / finderResults.length)
                        : 0}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Globe2 className="h-4 w-4" />
                      With sites
                    </div>
                    <div className="mt-2 text-2xl font-semibold">{finderResults.filter((candidate) => candidate.websiteUrl).length}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Star className="h-4 w-4" />
                      Provider
                    </div>
                    <div className="mt-2 break-words text-sm font-semibold capitalize leading-5">{finderProvider.replace(/_/g, " ")}</div>
                  </CardContent>
                </Card>
              </div>

              {finderResults.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center">
                    <Search className="mx-auto h-8 w-8 text-muted-foreground" />
                    <div className="mt-3 text-sm font-medium">No finder results yet</div>
                    <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                      Run a city and niche search to build a local prospect list. Once Google Places is configured, results include websites, reviews, map URLs, phone numbers, and fit scores.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-3">
                  {finderResults.map((candidate) => (
                    <Card key={candidate.id}>
                      <CardContent className="p-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-base font-semibold">{candidate.businessName}</h3>
                              <Badge>{candidate.fitScore}/100</Badge>
                              {candidate.category && <Badge variant="outline">{candidate.category}</Badge>}
                            </div>
                            {candidate.address && (
                              <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                                <MapPin className="h-4 w-4 shrink-0" />
                                <span>{candidate.address}</span>
                              </div>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" onClick={() => loadCandidateIntoIntake(candidate)}>
                              <ClipboardList className="h-4 w-4" />
                              Load intake
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => importCustomerFinderCandidate(candidate)}
                              disabled={importingLeadId === candidate.id}
                            >
                              <UserPlus className="h-4 w-4" />
                              {importingLeadId === candidate.id ? "Importing" : "Import"}
                            </Button>
                          </div>
                        </div>

                        <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
                          <div className="rounded-lg border p-3">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Star className="h-4 w-4" />
                              Rating
                            </div>
                            <div className="mt-1 font-medium">
                              {candidate.rating !== null ? candidate.rating.toFixed(1) : "Unknown"}
                              {candidate.reviewCount !== null && <span className="text-muted-foreground"> ({candidate.reviewCount} reviews)</span>}
                            </div>
                          </div>
                          <div className="rounded-lg border p-3">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Globe2 className="h-4 w-4" />
                              Website
                            </div>
                            <div className="mt-1 truncate font-medium">
                              {candidate.websiteUrl ? (
                                <a href={candidate.websiteUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                                  {candidate.websiteUrl.replace(/^https?:\/\//, "")}
                                </a>
                              ) : "Missing"}
                            </div>
                          </div>
                          <div className="rounded-lg border p-3">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Phone className="h-4 w-4" />
                              Contact
                            </div>
                            <div className="mt-1 truncate font-medium">
                              {candidate.phone || "Needs enrichment"}
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
                          <div className="rounded-lg border bg-muted/20 p-3">
                            <div className="text-sm font-medium">Fit reasons</div>
                            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                              {candidate.fitReasons.map((reason) => (
                                <li key={reason} className="flex gap-2">
                                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                                  <span>{reason}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div className="rounded-lg border bg-muted/20 p-3">
                            <div className="text-sm font-medium">Outreach angle</div>
                            <p className="mt-2 text-sm text-muted-foreground">{candidate.outreachAngle}</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Button variant="outline" size="sm" onClick={() => copyToClipboard("Outreach angle", candidate.outreachAngle)}>
                                <Copy className="h-4 w-4" />
                                Copy opener
                              </Button>
                              {candidate.googleMapsUrl && (
                                <Button variant="outline" size="sm" asChild>
                                  <a href={candidate.googleMapsUrl} target="_blank" rel="noreferrer">
                                    <MapPin className="h-4 w-4" />
                                    Maps
                                  </a>
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="intake">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <PackageCheck className="h-4 w-4" />
                  Prospect Intake
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="companyName">Company</Label>
                    <Input id="companyName" value={intake.companyName} onChange={(event) => updateIntake("companyName", event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="website">Website</Label>
                    <Input id="website" value={intake.website} onChange={(event) => updateIntake("website", event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="contactName">Contact</Label>
                    <Input id="contactName" value={intake.contactName} onChange={(event) => updateIntake("contactName", event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="budgetRange">Budget fit</Label>
                    <Select value={intake.budgetRange} onValueChange={(value) => updateIntake("budgetRange", value)}>
                      <SelectTrigger id="budgetRange">
                        <SelectValue placeholder="Select range" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="$1,500 audit">$1,500 audit</SelectItem>
                        <SelectItem value="$3,500-$7,500/mo">$3,500-$7,500/mo</SelectItem>
                        <SelectItem value="$7,500+/mo">$7,500+/mo</SelectItem>
                        <SelectItem value="Unknown">Unknown</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="category">Category</Label>
                    <Input id="category" value={intake.category} onChange={(event) => updateIntake("category", event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="audience">Target audience</Label>
                    <Input id="audience" value={intake.audience} onChange={(event) => updateIntake("audience", event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="market">Market</Label>
                    <Input id="market" value={intake.market} onChange={(event) => updateIntake("market", event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="competitors">Competitors</Label>
                    <Input id="competitors" value={intake.competitors} onChange={(event) => updateIntake("competitors", event.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="priorityPages">Priority pages</Label>
                  <Textarea id="priorityPages" className="min-h-[72px]" value={intake.priorityPages} onChange={(event) => updateIntake("priorityPages", event.target.value)} />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="painPoints">Visibility pain points</Label>
                    <Textarea id="painPoints" value={intake.painPoints} onChange={(event) => updateIntake("painPoints", event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="currentGoal">Commercial goal</Label>
                    <Textarea id="currentGoal" value={intake.currentGoal} onChange={(event) => updateIntake("currentGoal", event.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">Notes for the prompt pack</Label>
                  <Textarea id="notes" className="min-h-[100px]" value={intake.notes} onChange={(event) => updateIntake("notes", event.target.value)} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => setIntake(DEFAULT_INTAKE)}>
                    Reset sample
                  </Button>
                  <Button onClick={() => copyToClipboard("Intake", JSON.stringify(intake, null, 2))}>
                    <Copy className="h-4 w-4" />
                    Copy intake
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Selected Scope</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="text-sm font-semibold">{selectedPackage.name}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{selectedPackage.bestFor}</div>
                </div>
                <div className="space-y-2">
                  {selectedPackage.deliverables.map((item) => (
                    <div key={item} className="flex gap-2 text-sm">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                  <div className="font-medium">Generated focus</div>
                  <p className="mt-1 text-muted-foreground">
                    Build prompts around {intake.category || "the category"} for {intake.audience || "the target audience"}, then turn missed mentions and citations into a monthly fix queue.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="prompts">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Bot className="h-4 w-4" />
                  Generated Local Prompt Pack Preview
                </CardTitle>
                <Badge variant="outline">{generatedPrompts.length} prompts</Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                {generatedPrompts.map((prompt, index) => (
                  <div key={prompt.id} className="rounded-lg border p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="text-sm font-semibold">{index + 1}. {prompt.name}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{prompt.intent}</div>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => copyToClipboard(prompt.name, prompt.prompt)}>
                        <Copy className="h-4 w-4" />
                        Copy
                      </Button>
                    </div>
                    <p className="mt-3 rounded-md bg-muted/40 p-3 text-sm leading-6">{prompt.prompt}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Pack Notes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="rounded-lg border p-3">
                  <div className="font-medium">Prospect</div>
                  <div className="mt-1 text-muted-foreground">{intake.companyName} - {intake.website}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="font-medium">Pages to inspect</div>
                  <div className="mt-1 whitespace-pre-wrap text-muted-foreground">{intake.priorityPages}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="font-medium">Operator notes</div>
                  <div className="mt-1 whitespace-pre-wrap text-muted-foreground">{intake.notes}</div>
                </div>
                <Button className="w-full" onClick={() => copyToClipboard("Prompt pack", promptPackText)}>
                  <ClipboardList className="h-4 w-4" />
                  Copy full prompt pack
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="scripts">
          <div className="grid gap-4 lg:grid-cols-2">
            {generatedScripts.map((script) => (
              <Card key={script.id}>
                <CardHeader className="flex flex-row items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      {script.channel === "Email" ? <Mail className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
                      {script.name}
                    </CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">{script.goal}</p>
                  </div>
                  <Badge variant="outline">{script.channel}</Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Textarea className="min-h-[220px] font-mono text-xs leading-5" value={script.template} readOnly />
                  <Button variant="outline" size="sm" onClick={() => copyToClipboard(script.name, script.template)}>
                    <Copy className="h-4 w-4" />
                    Copy script
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="checklists">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ClipboardCheck className="h-4 w-4" />
                  Audit Checklist
                </CardTitle>
                <Badge variant="outline">{auditProgress}%</Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <Progress value={auditProgress} className="h-2" />
                <div className="space-y-2">
                  {ops.auditChecklist.map((item) => (
                    <label key={item.id} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm hover:bg-muted/40">
                      <Checkbox
                        checked={Boolean(auditChecked[item.id])}
                        onCheckedChange={(checked) => setAuditChecked((current) => ({ ...current, [item.id]: Boolean(checked) }))}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{item.label}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">{item.owner} - {item.frequency}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ClipboardList className="h-4 w-4" />
                  Monthly Fulfillment Checklist
                </CardTitle>
                <Badge variant="outline">{monthlyProgress}%</Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <Progress value={monthlyProgress} className="h-2" />
                <div className="space-y-2">
                  {ops.monthlyFulfillmentChecklist.map((item) => (
                    <label key={item.id} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm hover:bg-muted/40">
                      <Checkbox
                        checked={Boolean(monthlyChecked[item.id])}
                        onCheckedChange={(checked) => setMonthlyChecked((current) => ({ ...current, [item.id]: Boolean(checked) }))}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{item.label}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">{item.owner} - {item.frequency}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="queue">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Wrench className="h-4 w-4" />
                  Fix Queue
                </CardTitle>
                <Badge variant="outline">{ops.fixQueue.length} actions</Badge>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Action</TableHead>
                      <TableHead>Area</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>ETA</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ops.fixQueue.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="font-medium">{item.title}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{item.impact}</div>
                        </TableCell>
                        <TableCell>{item.area}</TableCell>
                        <TableCell>
                          <Badge variant={item.priority === "High" ? "default" : "outline"}>{item.priority}</Badge>
                        </TableCell>
                        <TableCell>{item.status}</TableCell>
                        <TableCell>{item.owner}</TableCell>
                        <TableCell>{item.eta}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Report Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground">Target score</div>
                    <div className="mt-1 text-2xl font-semibold">{ops.reportSummary.targetScore}</div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground">Current score</div>
                    <div className="mt-1 text-2xl font-semibold">{ops.reportSummary.currentScore}</div>
                  </div>
                </div>
                <Textarea className="min-h-[150px]" value={reportDraft} onChange={(event) => setReportDraft(event.target.value)} />
                <div className="space-y-3">
                  <div>
                    <div className="text-sm font-medium">Wins</div>
                    <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                      {ops.reportSummary.wins.map((item) => (
                        <li key={item} className="flex gap-2">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="text-sm font-medium">Risks</div>
                    <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                      {ops.reportSummary.risks.map((item) => (
                        <li key={item} className="flex gap-2">
                          <Gauge className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <Button className="w-full" onClick={() => copyToClipboard("Report summary", reportDraft)}>
                  <Copy className="h-4 w-4" />
                  Copy report summary
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </main>
  );
}
