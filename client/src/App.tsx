import { useState } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { DataTicker } from "@/components/DataTicker";
import { BootSequence } from "@/components/BootSequence";
import Home from "@/pages/Home";
import Projects from "@/pages/Projects";
import ProjectWorkspace from "@/pages/ProjectWorkspace";
import ProjectDocument from "@/pages/ProjectDocument";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import Pricing from "@/pages/Pricing";
import Chat from "@/pages/Chat";
import WritingPage from "@/pages/WritingPage";
import WebClips from "@/pages/WebClips";
import ExtensionAuth from "@/pages/ExtensionAuth";
import AdminAnalytics from "@/pages/AdminAnalytics";
import NotFound from "@/pages/not-found";

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
          <Router />
        </div>
        <DataTicker />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
