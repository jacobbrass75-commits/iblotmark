import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Circle, ExternalLink, Plus, Trash2, UserPlus, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { companyScopedUrl, setActiveCompanyId, useActiveCompanyId } from "@/lib/company";

const actionByKey: Record<string, { label: string; href: string }> = {
  company: { label: "Edit", href: "/blog/setup" },
  brand: { label: "Edit", href: "/blog/setup" },
  products: { label: "Products", href: "/blog/products" },
  photos: { label: "Assets", href: "/blog/photos" },
  keywords: { label: "Keywords", href: "/blog/keywords" },
  shopify: { label: "Publishing", href: "/blog/settings" },
  "first-post": { label: "Generate", href: "/blog/generate" },
};

const roleOptions = ["viewer", "reviewer", "editor", "admin", "owner"];

function lines(value: string): string[] {
  return value.split(/\n+/).map((item) => item.trim()).filter(Boolean);
}

function joinLines(value: unknown): string {
  return Array.isArray(value) ? value.join("\n") : "";
}

function parseCompetitors(value: string): Array<{ name: string; domains: string[] }> {
  return lines(value).map((line) => {
    const [namePart, domainPart = ""] = line.split("|");
    return {
      name: namePart.trim(),
      domains: domainPart.split(/[, ]+/).map((domain) => domain.trim()).filter(Boolean),
    };
  }).filter((item) => item.name);
}

function formatCompetitors(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((item: any) => `${item.name || ""}${item.domains?.length ? ` | ${item.domains.join(", ")}` : ""}`)
    .filter(Boolean)
    .join("\n");
}

export default function SetupChecklist() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const activeCompanyId = useActiveCompanyId();
  const { data: setup, isLoading } = useQuery<any>({
    queryKey: [companyScopedUrl("/api/blog/company/setup-status")],
    enabled: Boolean(activeCompanyId),
  });
  const { data: context } = useQuery<any>({
    queryKey: [companyScopedUrl("/api/blog/company/context")],
    enabled: Boolean(activeCompanyId),
  });
  const { data: companies = [] } = useQuery<any[]>({ queryKey: ["/api/blog/company"] });
  const membershipsQueryKey = companyScopedUrl("/api/blog/company/memberships");
  const {
    data: membershipData,
    error: membershipError,
    isLoading: membershipsLoading,
  } = useQuery<any>({
    queryKey: [membershipsQueryKey],
    enabled: Boolean(activeCompanyId),
  });

  const [companyForm, setCompanyForm] = useState({
    name: "",
    websiteUrl: "",
    primaryMarket: "",
    ecommercePlatform: "shopify",
  });
  const [brandForm, setBrandForm] = useState({
    displayName: "",
    productUrlPattern: "",
    shortDescription: "",
    positioning: "",
    toneTraits: "",
    bannedPhrases: "",
    preferredCtas: "",
    competitors: "",
    writingSamples: "",
  });
  const [shopifyForm, setShopifyForm] = useState({
    shop: "",
    defaultBlogId: "",
    productUrlPattern: "",
  });
  const [newCompany, setNewCompany] = useState({ name: "", websiteUrl: "" });
  const [newMember, setNewMember] = useState({ email: "", role: "viewer" });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const companyId = params.get("companyId");
    if (companyId && companies.some((company) => company.id === companyId)) {
      setActiveCompanyId(companyId);
      queryClient.invalidateQueries();
      window.history.replaceState({}, "", window.location.pathname);
    } else if (companyId && companies.length > 0) {
      window.history.replaceState({}, "", window.location.pathname);
      toast({
        title: "Workspace not available",
        description: "That company is not in your accessible workspace list.",
        variant: "destructive",
      });
    }
  }, [companies, toast]);

  useEffect(() => {
    if (!context) return;
    setCompanyForm({
      name: context.company?.name || "",
      websiteUrl: context.company?.websiteUrl || "",
      primaryMarket: context.company?.primaryMarket || "",
      ecommercePlatform: context.company?.ecommercePlatform || "shopify",
    });
    setBrandForm({
      displayName: context.brandProfile?.displayName || "",
      productUrlPattern: context.brandProfile?.productUrlPattern || "",
      shortDescription: context.brandProfile?.shortDescription || "",
      positioning: context.brandProfile?.positioning || "",
      toneTraits: joinLines(context.brandProfile?.toneTraits),
      bannedPhrases: joinLines(context.brandProfile?.bannedPhrases),
      preferredCtas: joinLines(context.brandProfile?.preferredCtas),
      competitors: formatCompetitors(context.competitors),
      writingSamples: joinLines(context.brandProfile?.writingSamples),
    });
    setShopifyForm({
      shop: context.integrations?.shopify?.shop || "",
      defaultBlogId: context.integrations?.shopify?.defaultBlogId ? String(context.integrations.shopify.defaultBlogId) : "",
      productUrlPattern: context.integrations?.shopify?.productUrlPattern || context.brandProfile?.productUrlPattern || "",
    });
  }, [context]);

  const saveProfile = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/blog/company/profile", {
        company: companyForm,
        brandProfile: {
          ...brandForm,
          websiteUrl: companyForm.websiteUrl,
          toneTraits: lines(brandForm.toneTraits),
          bannedPhrases: lines(brandForm.bannedPhrases),
          preferredCtas: lines(brandForm.preferredCtas),
          competitors: parseCompetitors(brandForm.competitors),
          writingSamples: lines(brandForm.writingSamples),
        },
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({ title: "Workspace saved" });
    },
  });

  const saveShopify = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/blog/company/integrations/shopify", {
        shopify: {
          shop: shopifyForm.shop,
          defaultBlogId: shopifyForm.defaultBlogId ? Number(shopifyForm.defaultBlogId) : null,
          productUrlPattern: shopifyForm.productUrlPattern,
        },
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({ title: "Shopify settings saved" });
    },
  });

  const connectShopify = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/blog/shopify/oauth/start", {
        shop: shopifyForm.shop,
        returnPath: "/blog/settings",
      });
      return res.json();
    },
    onSuccess: (data) => {
      window.location.href = data.installUrl;
    },
    onError: (error: any) => {
      toast({ title: "Shopify connect failed", description: error.message, variant: "destructive" });
    },
  });

  const createCompany = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/blog/company", {
        name: newCompany.name,
        websiteUrl: newCompany.websiteUrl,
      });
      return res.json();
    },
    onSuccess: (created) => {
      setActiveCompanyId(created.company.id);
      setNewCompany({ name: "", websiteUrl: "" });
      queryClient.invalidateQueries();
      toast({ title: "Company workspace created" });
    },
  });

  const addMembership = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/blog/company/memberships", {
        email: newMember.email,
        role: newMember.role,
      });
      return res.json();
    },
    onSuccess: () => {
      setNewMember({ email: "", role: "viewer" });
      queryClient.invalidateQueries({ queryKey: [membershipsQueryKey] });
      toast({ title: "Member added" });
    },
    onError: (error: any) => {
      toast({ title: "Could not add member", description: error.message, variant: "destructive" });
    },
  });

  const updateMembership = useMutation({
    mutationFn: async ({ id, role, status }: { id: string; role?: string; status?: string }) => {
      const payload: Record<string, string> = {};
      if (role) payload.role = role;
      if (status) payload.status = status;
      const res = await apiRequest("PATCH", `/api/blog/company/memberships/${id}`, payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [membershipsQueryKey] });
      toast({ title: "Member updated" });
    },
    onError: (error: any) => {
      toast({ title: "Could not update member", description: error.message, variant: "destructive" });
    },
  });

  const removeMembership = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/blog/company/memberships/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [membershipsQueryKey] });
      toast({ title: "Member removed" });
    },
    onError: (error: any) => {
      toast({ title: "Could not remove member", description: error.message, variant: "destructive" });
    },
  });

  const items = setup?.items || [];
  const completed = setup?.completed || 0;
  const total = setup?.total || items.length || 1;
  const progress = Math.round((completed / total) * 100);
  const memberships = Array.isArray(membershipData?.memberships) ? membershipData.memberships : [];
  const membershipAccessDenied = membershipError instanceof Error && membershipError.message.startsWith("403:");

  return (
    <main className="container mx-auto max-w-6xl px-4 py-6 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Setup</h1>
          <p className="text-sm text-muted-foreground">{setup?.company?.name || "Workspace"} readiness and company configuration</p>
        </div>
        <Button variant="outline" onClick={() => setLocation("/blog")}>Dashboard</Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span>Readiness</span>
              <Badge variant="secondary">{completed}/{total}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={isLoading ? 0 : progress} />
            <div className="space-y-2">
              {items.map((item: any) => {
                const action = actionByKey[item.key] || { label: "Open", href: "/blog" };
                return (
                  <div key={item.key} className="flex items-center gap-3 rounded-md border bg-background p-3">
                    <div className={item.complete ? "text-green-600" : "text-muted-foreground"}>
                      {item.complete ? <Check className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{item.label}</div>
                      <div className="text-xs text-muted-foreground">{item.complete ? "Complete" : "Needs setup"}</div>
                    </div>
                    <Button variant="ghost" size="sm" className="gap-2" onClick={() => setLocation(action.href)}>
                      {action.label}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{companies.length ? "Create Another Company" : "Create Company Workspace"}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <Input placeholder="Company name" value={newCompany.name} onChange={(e) => setNewCompany({ ...newCompany, name: e.target.value })} />
              <Input placeholder="Website URL" value={newCompany.websiteUrl} onChange={(e) => setNewCompany({ ...newCompany, websiteUrl: e.target.value })} />
              <Button className="gap-2" disabled={!newCompany.name || createCompany.isPending} onClick={() => createCompany.mutate()}>
                <Plus className="h-4 w-4" />
                Create
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Company And Brand</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Company name</Label>
                  <Input value={companyForm.name} onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Website</Label>
                  <Input value={companyForm.websiteUrl} onChange={(e) => setCompanyForm({ ...companyForm, websiteUrl: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Primary market</Label>
                  <Input value={companyForm.primaryMarket} onChange={(e) => setCompanyForm({ ...companyForm, primaryMarket: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Product URL pattern</Label>
                  <Input value={brandForm.productUrlPattern} onChange={(e) => setBrandForm({ ...brandForm, productUrlPattern: e.target.value })} placeholder="https://example.com/products/{handle}" />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Brand display name</Label>
                  <Input value={brandForm.displayName} onChange={(e) => setBrandForm({ ...brandForm, displayName: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Short description</Label>
                  <Input value={brandForm.shortDescription} onChange={(e) => setBrandForm({ ...brandForm, shortDescription: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Positioning</Label>
                <Textarea value={brandForm.positioning} onChange={(e) => setBrandForm({ ...brandForm, positioning: e.target.value })} />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Tone traits</Label>
                  <Textarea value={brandForm.toneTraits} onChange={(e) => setBrandForm({ ...brandForm, toneTraits: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Banned phrases</Label>
                  <Textarea value={brandForm.bannedPhrases} onChange={(e) => setBrandForm({ ...brandForm, bannedPhrases: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Preferred CTAs</Label>
                  <Textarea value={brandForm.preferredCtas} onChange={(e) => setBrandForm({ ...brandForm, preferredCtas: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Competitors</Label>
                  <Textarea value={brandForm.competitors} onChange={(e) => setBrandForm({ ...brandForm, competitors: e.target.value })} placeholder="Competitor | competitor.com" />
                </div>
              </div>
              <Button disabled={saveProfile.isPending || !activeCompanyId || !companyForm.name} onClick={() => saveProfile.mutate()}>
                {saveProfile.isPending ? "Saving..." : "Save Company And Brand"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span>Shopify Publishing</span>
                {context?.integrations?.shopify?.hasAccessToken ? (
                  <Badge variant="secondary">Token connected</Badge>
                ) : context?.integrations?.shopify ? (
                  <Badge variant="outline">Configured</Badge>
                ) : (
                  <Badge variant="outline">Not connected</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Shop</Label>
                  <Input value={shopifyForm.shop} onChange={(e) => setShopifyForm({ ...shopifyForm, shop: e.target.value })} placeholder="store-name or store-name.myshopify.com" />
                </div>
                <div className="space-y-1.5">
                  <Label>Default blog ID</Label>
                  <Input value={shopifyForm.defaultBlogId} onChange={(e) => setShopifyForm({ ...shopifyForm, defaultBlogId: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Product URL pattern</Label>
                  <Input value={shopifyForm.productUrlPattern} onChange={(e) => setShopifyForm({ ...shopifyForm, productUrlPattern: e.target.value })} />
                </div>
              </div>
              <Button disabled={saveShopify.isPending || !activeCompanyId || !shopifyForm.shop} onClick={() => saveShopify.mutate()}>
                {saveShopify.isPending ? "Saving..." : "Save Shopify Settings"}
              </Button>
              <Button
                className="ml-2 gap-2"
                variant="outline"
                disabled={connectShopify.isPending || !activeCompanyId || !shopifyForm.shop}
                onClick={() => connectShopify.mutate()}
              >
                <ExternalLink className="h-4 w-4" />
                {connectShopify.isPending ? "Preparing..." : "Connect With Shopify OAuth"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Team Access
                </span>
                <Badge variant="outline">{memberships.length || 0} member{memberships.length === 1 ? "" : "s"}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {membershipAccessDenied ? (
                <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                  Admin access is required to manage company members.
                </div>
              ) : (
                <>
                  <div className="grid gap-3 md:grid-cols-[1fr_160px_auto]">
                    <div className="space-y-1.5">
                      <Label>User email</Label>
                      <Input
                        value={newMember.email}
                        onChange={(e) => setNewMember({ ...newMember, email: e.target.value })}
                        placeholder="teammate@example.com"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Role</Label>
                      <select
                        className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                        value={newMember.role}
                        onChange={(e) => setNewMember({ ...newMember, role: e.target.value })}
                      >
                        {roleOptions.map((role) => (
                          <option key={role} value={role}>{role}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-end">
                      <Button
                        className="w-full gap-2"
                        disabled={!activeCompanyId || !newMember.email || addMembership.isPending}
                        onClick={() => addMembership.mutate()}
                      >
                        <UserPlus className="h-4 w-4" />
                        Add
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {membershipsLoading ? (
                      <div className="rounded-md border bg-background p-3 text-sm text-muted-foreground">Loading members...</div>
                    ) : memberships.length === 0 ? (
                      <div className="rounded-md border bg-background p-3 text-sm text-muted-foreground">No members found.</div>
                    ) : memberships.map((membership: any) => (
                      <div key={membership.id} className="grid gap-3 rounded-md border bg-background p-3 md:grid-cols-[1fr_150px_110px_auto] md:items-center">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{membership.email || membership.userId}</div>
                          <div className="truncate text-xs text-muted-foreground">{membership.userId}</div>
                        </div>
                        <select
                          className="h-9 rounded-md border bg-background px-2 text-sm"
                          value={membership.role}
                          disabled={updateMembership.isPending}
                          onChange={(e) => updateMembership.mutate({ id: membership.id, role: e.target.value })}
                        >
                          {roleOptions.map((role) => (
                            <option key={role} value={role}>{role}</option>
                          ))}
                        </select>
                        <select
                          className="h-9 rounded-md border bg-background px-2 text-sm"
                          value={membership.status}
                          disabled={updateMembership.isPending}
                          onChange={(e) => updateMembership.mutate({ id: membership.id, status: e.target.value })}
                        >
                          <option value="active">active</option>
                          <option value="inactive">inactive</option>
                        </select>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${membership.email || membership.userId}`}
                          disabled={removeMembership.isPending}
                          onClick={() => removeMembership.mutate(membership.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
