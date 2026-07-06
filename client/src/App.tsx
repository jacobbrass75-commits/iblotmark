import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { BlogShell } from "@/components/BlogShell";
import { DataTicker } from "@/components/DataTicker";
import { BootSequence } from "@/components/BootSequence";

const Login = lazy(() => import("@/pages/Login"));
const Register = lazy(() => import("@/pages/Register"));
const BlogDashboard = lazy(() => import("@/pages/BlogDashboard"));
const SetupChecklist = lazy(() => import("@/pages/SetupChecklist"));
const KeywordManager = lazy(() => import("@/pages/KeywordManager"));
const BatchGenerator = lazy(() => import("@/pages/BatchGenerator"));
const BlogPosts = lazy(() => import("@/pages/BlogPosts"));
const PostReview = lazy(() => import("@/pages/PostReview"));
const IndustryContext = lazy(() => import("@/pages/IndustryContext"));
const ProductCatalog = lazy(() => import("@/pages/ProductCatalog"));
const InventoryCount = lazy(() => import("@/pages/InventoryCount"));
const CatalogImport = lazy(() => import("@/pages/CatalogImport"));
const PhotoBank = lazy(() => import("@/pages/PhotoBank"));
const AiBenchmark = lazy(() => import("@/pages/AiBenchmark"));
const ServiceOps = lazy(() => import("@/pages/ServiceOps"));
const NotFound = lazy(() => import("@/pages/not-found"));
const enableLegacyScholarMark = import.meta.env.VITE_ENABLE_LEGACY_SCHOLARMARK === "true";
const legacyPages = enableLegacyScholarMark
  ? {
      Home: lazy(() => import("@/pages/Home")),
      Projects: lazy(() => import("@/pages/Projects")),
      ProjectWorkspace: lazy(() => import("@/pages/ProjectWorkspace")),
      ProjectDocument: lazy(() => import("@/pages/ProjectDocument")),
      Pricing: lazy(() => import("@/pages/Pricing")),
      Chat: lazy(() => import("@/pages/Chat")),
      WritingPage: lazy(() => import("@/pages/WritingPage")),
      WebClips: lazy(() => import("@/pages/WebClips")),
      ExtensionAuth: lazy(() => import("@/pages/ExtensionAuth")),
      AdminAnalytics: lazy(() => import("@/pages/AdminAnalytics")),
    }
  : null;

function RouteFallback() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center px-6">
      <div className="text-center space-y-2">
        <div className="text-xs font-mono uppercase tracking-[0.3em] text-muted-foreground">
          Loading View
        </div>
        <div className="h-2 w-40 rounded-full bg-border overflow-hidden">
          <div className="h-full w-1/2 animate-pulse bg-primary/60" />
        </div>
      </div>
    </div>
  );
}

function RedirectToBlog() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    setLocation("/blog");
  }, [setLocation]);

  return null;
}

function Router() {
  const blogRoute = (children: ReactNode) => (
    <ProtectedRoute>
      <BlogShell>{children}</BlogShell>
    </ProtectedRoute>
  );

  return (
    <Switch>
      <Route path="/sign-in" component={Login} />
      <Route path="/sign-up" component={Register} />
      {enableLegacyScholarMark && legacyPages ? (
        <>
          <Route path="/pricing" component={legacyPages.Pricing} />
          <Route path="/extension-auth">{() => <ProtectedRoute><legacyPages.ExtensionAuth /></ProtectedRoute>}</Route>
          <Route path="/">{() => <ProtectedRoute><legacyPages.Home /></ProtectedRoute>}</Route>
          <Route path="/projects">{() => <ProtectedRoute><legacyPages.Projects /></ProtectedRoute>}</Route>
          <Route path="/web-clips">{() => <ProtectedRoute><legacyPages.WebClips /></ProtectedRoute>}</Route>
          <Route path="/projects/:id">{() => <ProtectedRoute><legacyPages.ProjectWorkspace /></ProtectedRoute>}</Route>
          <Route path="/projects/:projectId/documents/:docId">{() => <ProtectedRoute><legacyPages.ProjectDocument /></ProtectedRoute>}</Route>
          <Route path="/chat">{() => <ProtectedRoute><legacyPages.Chat /></ProtectedRoute>}</Route>
          <Route path="/chat/:conversationId">{() => <ProtectedRoute><legacyPages.Chat /></ProtectedRoute>}</Route>
          <Route path="/write">{() => <ProtectedRoute><legacyPages.WritingPage /></ProtectedRoute>}</Route>
          <Route path="/writing">{() => <ProtectedRoute><legacyPages.WritingPage /></ProtectedRoute>}</Route>
          <Route path="/admin/analytics">{() => <ProtectedRoute><legacyPages.AdminAnalytics /></ProtectedRoute>}</Route>
        </>
      ) : (
        <>
          <Route path="/">{() => <RedirectToBlog />}</Route>
          <Route path="/pricing">{() => <RedirectToBlog />}</Route>
          <Route path="/extension-auth">{() => <RedirectToBlog />}</Route>
          <Route path="/projects">{() => <RedirectToBlog />}</Route>
          <Route path="/web-clips">{() => <RedirectToBlog />}</Route>
          <Route path="/projects/:id">{() => <RedirectToBlog />}</Route>
          <Route path="/projects/:projectId/documents/:docId">{() => <RedirectToBlog />}</Route>
          <Route path="/chat">{() => <RedirectToBlog />}</Route>
          <Route path="/chat/:conversationId">{() => <RedirectToBlog />}</Route>
          <Route path="/write">{() => <RedirectToBlog />}</Route>
          <Route path="/writing">{() => <RedirectToBlog />}</Route>
          <Route path="/admin/analytics">{() => <RedirectToBlog />}</Route>
        </>
      )}
      <Route path="/blog">{() => blogRoute(<BlogDashboard />)}</Route>
      <Route path="/blog/setup">{() => blogRoute(<SetupChecklist />)}</Route>
      <Route path="/blog/settings">{() => blogRoute(<SetupChecklist />)}</Route>
      <Route path="/blog/integrations">{() => blogRoute(<SetupChecklist />)}</Route>
      <Route path="/blog/keywords">{() => blogRoute(<KeywordManager />)}</Route>
      <Route path="/blog/generate">{() => blogRoute(<BatchGenerator />)}</Route>
      <Route path="/blog/posts">{() => blogRoute(<BlogPosts />)}</Route>
      <Route path="/blog/posts/:id">{() => blogRoute(<PostReview />)}</Route>
      <Route path="/blog/context">{() => blogRoute(<IndustryContext />)}</Route>
      <Route path="/blog/products">{() => blogRoute(<ProductCatalog />)}</Route>
      <Route path="/blog/inventory">{() => blogRoute(<InventoryCount />)}</Route>
      <Route path="/blog/catalog">{() => blogRoute(<CatalogImport />)}</Route>
      <Route path="/blog/photos">{() => blogRoute(<PhotoBank />)}</Route>
      <Route path="/blog/benchmark">{() => blogRoute(<AiBenchmark />)}</Route>
      <Route path="/blog/service-ops">{() => blogRoute(<ServiceOps />)}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const [booted, setBooted] = useState(false);
  const [location] = useLocation();
  const isBlogRoute = location === "/blog" || location.startsWith("/blog/");

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        {!isBlogRoute && !booted && <BootSequence onComplete={() => setBooted(true)} />}
        <div className="min-h-screen pb-6 eva-scanlines">
          <Suspense fallback={<RouteFallback />}>
            <Router />
          </Suspense>
        </div>
        {!isBlogRoute && <DataTicker />}
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
