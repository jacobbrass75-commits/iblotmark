import { type ReactNode, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  BookOpenText,
  Boxes,
  Camera,
  FileText,
  Home,
  Layers3,
  ListChecks,
  PackageSearch,
  PenLine,
  Search,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { companyScopedUrl, getActiveCompanyId, setActiveCompanyId, useActiveCompanyId } from "@/lib/company";
import { queryClient } from "@/lib/queryClient";

const navItems = [
  { href: "/blog", label: "Dashboard", icon: Home },
  { href: "/blog/setup", label: "Setup", icon: ListChecks },
  { href: "/blog/generate", label: "Generate", icon: PenLine },
  { href: "/blog/keywords", label: "Keywords", icon: Search },
  { href: "/blog/posts", label: "Posts", icon: FileText },
  { href: "/blog/products", label: "Products", icon: Boxes },
  { href: "/blog/catalog", label: "Catalog", icon: BookOpenText },
  { href: "/blog/photos", label: "Assets", icon: Camera },
  { href: "/blog/context", label: "Context", icon: Layers3 },
  { href: "/blog/benchmark", label: "Visibility", icon: BarChart3 },
];

function isActive(pathname: string, href: string) {
  if (href === "/blog") return pathname === "/blog";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BlogShell({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const activeCompanyId = useActiveCompanyId();
  const { data: companies = [], isLoading: companiesLoading } = useQuery<any[]>({
    queryKey: ["/api/blog/company"],
    staleTime: 10 * 60 * 1000,
  });
  const activeCompanyIsAccessible = Boolean(
    activeCompanyId && companies.some((company: any) => company.id === activeCompanyId),
  );
  const { data: context } = useQuery<any>({
    queryKey: [companyScopedUrl("/api/blog/company/context")],
    enabled: activeCompanyIsAccessible,
    staleTime: 10 * 60 * 1000,
  });
  const { data: setup } = useQuery<any>({
    queryKey: [companyScopedUrl("/api/blog/company/setup-status")],
    enabled: activeCompanyIsAccessible,
    staleTime: 2 * 60 * 1000,
  });

  useEffect(() => {
    if (companiesLoading) return;
    if (companies.length === 0) {
      if (getActiveCompanyId()) {
        setActiveCompanyId(null);
        queryClient.invalidateQueries();
      }
      return;
    }
    const storedCompanyId = activeCompanyId || getActiveCompanyId();
    const selected = storedCompanyId && companies.some((company: any) => company.id === storedCompanyId)
      ? storedCompanyId
      : companies[0].id;
    if (selected !== storedCompanyId) {
      setActiveCompanyId(selected);
      queryClient.invalidateQueries();
    }
  }, [activeCompanyId, companies, companiesLoading]);

  const companyName = context?.company?.name || "Content Workspace";
  const brandName = context?.brandProfile?.displayName || companyName;
  const setupItems = Array.isArray(setup?.items) ? setup.items : [];
  const setupIncomplete = setupItems.some((item: any) => !item.complete);
  const coreSetupIncomplete = setupItems.some((item: any) => ["company", "brand"].includes(item.key) && !item.complete);
  const isSetupRoute = location === "/blog/setup" || location === "/blog/settings" || location === "/blog/integrations";
  const shouldGateForSetup = coreSetupIncomplete && !isSetupRoute;
  const needsWorkspaceBootstrap = !companiesLoading && companies.length === 0;
  const waitingForWorkspaceSelection = companiesLoading || (!activeCompanyIsAccessible && companies.length > 0);

  return (
    <div className="min-h-screen bg-muted/25 pb-14">
      <div className="border-b bg-background/95 backdrop-blur">
        <div className="flex min-h-14 items-center gap-3 px-4 lg:px-6">
          <Button variant="ghost" size="icon" className="shrink-0" aria-label="Open blog dashboard" onClick={() => setLocation("/blog")}>
            <PackageSearch className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{brandName}</div>
            <div className="truncate text-xs text-muted-foreground">Content Intelligence</div>
          </div>
          {companies.length > 1 ? (
            <select
              value={activeCompanyId || context?.company?.id || ""}
              className="hidden max-w-[220px] rounded-md border bg-background px-2 py-1 text-sm sm:block"
              onChange={(event) => {
                setActiveCompanyId(event.target.value || null);
                queryClient.invalidateQueries();
                setLocation("/blog");
              }}
            >
              {companies.map((company: any) => (
                <option key={company.id} value={company.id}>{company.name}</option>
              ))}
            </select>
          ) : (
            <Badge variant="outline" className="hidden sm:inline-flex">
              Workspace
            </Badge>
          )}
          <Button variant="ghost" size="icon" aria-label="Open blog settings" onClick={() => setLocation("/blog/settings")}>
            <Settings className="h-4 w-4" />
          </Button>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:hidden">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Button
                key={item.href}
                variant={isActive(location, item.href) ? "secondary" : "ghost"}
                size="sm"
                className="shrink-0 gap-2"
                onClick={() => setLocation(item.href)}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Button>
            );
          })}
        </nav>
      </div>

      <div className="flex">
        <aside className="sticky top-0 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 border-r bg-background/80 p-3 md:block">
          <div className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Button
                  key={item.href}
                  variant={isActive(location, item.href) ? "secondary" : "ghost"}
                  className={cn("w-full justify-start gap-2")}
                  onClick={() => setLocation(item.href)}
                >
                  <Icon className="h-4 w-4" />
                  <span className="truncate">{item.label}</span>
                </Button>
              );
            })}
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          {setupIncomplete && !isSetupRoute && (
            <div className="border-b bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  Finish workspace setup before relying on generated content or publishing.
                </span>
                <Button size="sm" variant="outline" onClick={() => setLocation("/blog/setup")}>
                  Open setup
                </Button>
              </div>
            </div>
          )}
          {waitingForWorkspaceSelection ? (
            <main className="container mx-auto max-w-3xl px-4 py-10">
              <div className="rounded-lg border bg-background p-6">
                <h1 className="text-xl font-semibold">Opening Workspace</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  Loading your company workspaces.
                </p>
              </div>
            </main>
          ) : needsWorkspaceBootstrap && !isSetupRoute ? (
            <main className="container mx-auto max-w-3xl px-4 py-10">
              <div className="rounded-lg border bg-background p-6">
                <h1 className="text-xl font-semibold">Create Your Company Workspace</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  Set up a company before using content, catalog, asset, benchmark, or publishing workflows.
                </p>
                <Button className="mt-4" onClick={() => setLocation("/blog/setup")}>
                  Start setup
                </Button>
              </div>
            </main>
          ) : shouldGateForSetup ? (
            <main className="container mx-auto max-w-3xl px-4 py-10">
              <div className="rounded-lg border bg-background p-6">
                <h1 className="text-xl font-semibold">Complete Company Setup</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  Add the company profile and brand guidance before using operational content workflows.
                </p>
                <Button className="mt-4" onClick={() => setLocation("/blog/setup")}>
                  Continue setup
                </Button>
              </div>
            </main>
          ) : children}
        </div>
      </div>
    </div>
  );
}
