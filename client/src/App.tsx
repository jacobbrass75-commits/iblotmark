import { Suspense, lazy, useState } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { DataTicker } from "@/components/DataTicker";
import { BootSequence } from "@/components/BootSequence";

const Home = lazy(() => import("@/pages/Home"));
const Projects = lazy(() => import("@/pages/Projects"));
const ProjectWorkspace = lazy(() => import("@/pages/ProjectWorkspace"));
const ProjectDocument = lazy(() => import("@/pages/ProjectDocument"));
const Login = lazy(() => import("@/pages/Login"));
const Register = lazy(() => import("@/pages/Register"));
const Pricing = lazy(() => import("@/pages/Pricing"));
const Chat = lazy(() => import("@/pages/Chat"));
const WritingPage = lazy(() => import("@/pages/WritingPage"));
const WebClips = lazy(() => import("@/pages/WebClips"));
const ExtensionAuth = lazy(() => import("@/pages/ExtensionAuth"));
const AdminAnalytics = lazy(() => import("@/pages/AdminAnalytics"));
const BlogDashboard = lazy(() => import("@/pages/BlogDashboard"));
const KeywordManager = lazy(() => import("@/pages/KeywordManager"));
const BatchGenerator = lazy(() => import("@/pages/BatchGenerator"));
const PostReview = lazy(() => import("@/pages/PostReview"));
const IndustryContext = lazy(() => import("@/pages/IndustryContext"));
const ProductCatalog = lazy(() => import("@/pages/ProductCatalog"));
const CatalogImport = lazy(() => import("@/pages/CatalogImport"));
const PhotoBank = lazy(() => import("@/pages/PhotoBank"));
const NotFound = lazy(() => import("@/pages/not-found"));

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

function Router() {
  return (
    <Switch>
      <Route path="/sign-in" component={Login} />
      <Route path="/sign-up" component={Register} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/extension-auth">{() => <ProtectedRoute><ExtensionAuth /></ProtectedRoute>}</Route>
      <Route path="/">{() => <ProtectedRoute><Home /></ProtectedRoute>}</Route>
      <Route path="/projects">{() => <ProtectedRoute><Projects /></ProtectedRoute>}</Route>
      <Route path="/web-clips">{() => <ProtectedRoute><WebClips /></ProtectedRoute>}</Route>
      <Route path="/projects/:id">{() => <ProtectedRoute><ProjectWorkspace /></ProtectedRoute>}</Route>
      <Route path="/projects/:projectId/documents/:docId">{() => <ProtectedRoute><ProjectDocument /></ProtectedRoute>}</Route>
      <Route path="/chat">{() => <ProtectedRoute><Chat /></ProtectedRoute>}</Route>
      <Route path="/chat/:conversationId">{() => <ProtectedRoute><Chat /></ProtectedRoute>}</Route>
      <Route path="/write">{() => <ProtectedRoute><WritingPage /></ProtectedRoute>}</Route>
      <Route path="/writing">{() => <ProtectedRoute><WritingPage /></ProtectedRoute>}</Route>
      <Route path="/admin/analytics">{() => <ProtectedRoute><AdminAnalytics /></ProtectedRoute>}</Route>
      <Route path="/blog">{() => <BlogDashboard />}</Route>
      <Route path="/blog/keywords">{() => <KeywordManager />}</Route>
      <Route path="/blog/generate">{() => <BatchGenerator />}</Route>
      <Route path="/blog/posts/:id">{() => <PostReview />}</Route>
      <Route path="/blog/context">{() => <IndustryContext />}</Route>
      <Route path="/blog/products">{() => <ProductCatalog />}</Route>
      <Route path="/blog/catalog">{() => <CatalogImport />}</Route>
      <Route path="/blog/photos">{() => <PhotoBank />}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const [booted, setBooted] = useState(false);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        {!booted && <BootSequence onComplete={() => setBooted(true)} />}
        <div className="min-h-screen pb-6 eva-scanlines">
          <Suspense fallback={<RouteFallback />}>
            <Router />
          </Suspense>
        </div>
        <DataTicker />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
