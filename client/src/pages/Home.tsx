import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, FileText, FolderOpen, Link2, MessageSquare, PenTool, Plus, Search, Upload } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useCreateProject, useProjects } from "@/hooks/useProjects";

interface DashboardStatus {
  counts: {
    projects: number;
    documents: number;
    annotations: number;
  };
  storage: {
    databaseBytes: number;
    sourceFilesBytes: number;
    totalBytes: number;
  };
  system: {
    uptimeSeconds: number;
    nodeVersion: string;
    platform: string;
    heapUsedBytes: number;
    heapTotalBytes: number;
  };
  documentsByStatus: {
    ready: number;
    processing: number;
    error: number;
    other: number;
  };
  capturedAt: number;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(exponent === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[exponent]}`;
}

function formatUptime(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(safeSeconds / 86_400);
  const hours = Math.floor((safeSeconds % 86_400) / 3_600);
  const minutes = Math.floor((safeSeconds % 3_600) / 60);
  const seconds = safeSeconds % 60;

  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");

  if (days > 0) {
    return `${days}d ${hh}:${mm}:${ss}`;
  }
  return `${hh}:${mm}:${ss}`;
}

export default function Home() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const createProject = useCreateProject();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [tickNow, setTickNow] = useState(Date.now());
  const [newProject, setNewProject] = useState({
    name: "",
    description: "",
    thesis: "",
    scope: "",
  });

  const { data: dashboard, isLoading: dashboardLoading } = useQuery<DashboardStatus>({
    queryKey: ["/api/system/status"],
    queryFn: async () => {
      const res = await fetch("/api/system/status");
      if (!res.ok) {
        throw new Error("Failed to fetch system status");
      }
      return res.json();
    },
    refetchInterval: 15_000,
  });

  useEffect(() => {
    const timer = window.setInterval(() => setTickNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const recentProjects = useMemo(() => projects.slice(0, 3), [projects]);

  const liveUptimeSeconds = useMemo(() => {
    if (!dashboard) return 0;
    const elapsed = Math.max(0, Math.floor((tickNow - dashboard.capturedAt) / 1_000));
    return dashboard.system.uptimeSeconds + elapsed;
  }, [dashboard, tickNow]);

  const heapPercent = useMemo(() => {
    if (!dashboard) return 0;
    return Math.min(100, Math.round((dashboard.system.heapUsedBytes / dashboard.system.heapTotalBytes) * 100));
  }, [dashboard]);

  const storageDbPercent = useMemo(() => {
    if (!dashboard || dashboard.storage.totalBytes <= 0) return 0;
    return Math.round((dashboard.storage.databaseBytes / dashboard.storage.totalBytes) * 100);
  }, [dashboard]);

  const storageSourcePercent = useMemo(() => {
    if (!dashboard || dashboard.storage.totalBytes <= 0) return 0;
    return 100 - storageDbPercent;
  }, [dashboard, storageDbPercent]);

  const handleCreateProject = async () => {
    if (!newProject.name.trim()) {
      toast({
        title: "Project name required",
        description: "Add a project name before creating it.",
        variant: "destructive",
      });
      return;
    }

    try {
      const project = await createProject.mutateAsync(newProject);
      setIsCreateOpen(false);
      setNewProject({ name: "", description: "", thesis: "", scope: "" });
      setLocation(`/projects/${project.id}`);
    } catch (error) {
      toast({
        title: "Create failed",
        description: error instanceof Error ? error.message : "Could not create project",
        variant: "destructive",
      });
    }
  };

  const projectsCount = dashboard?.counts.projects ?? projects.length;
  const documentsCount = dashboard?.counts.documents ?? 0;
  const annotationsCount = dashboard?.counts.annotations ?? 0;
  const totalStorageLabel = formatBytes(dashboard?.storage.totalBytes ?? 0);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-background/95 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" />
            <h1 className="font-sans uppercase tracking-[0.2em] font-bold text-primary">SCHOLARMARK</h1>
            <div className="eva-status-active" />
          </div>
          <div className="flex items-center gap-2">
            <Link href="/projects">
              <Button variant="outline" size="sm" className="uppercase tracking-wider text-xs font-mono" data-testid="button-projects">
                <FolderOpen className="h-4 w-4 mr-2" />
                Projects
              </Button>
            </Link>
            <Link href="/chat">
              <Button variant="outline" size="sm" className="uppercase tracking-wider text-xs font-mono" data-testid="button-chat">
                <MessageSquare className="h-4 w-4 mr-2" />
                Chat
              </Button>
            </Link>
            <Link href="/write">
              <Button variant="outline" size="sm" className="uppercase tracking-wider text-xs font-mono" data-testid="button-write">
                <PenTool className="h-4 w-4 mr-2" />
                Write
              </Button>
            </Link>
            <Link href="/web-clips">
              <Button variant="outline" size="sm" className="uppercase tracking-wider text-xs font-mono" data-testid="button-web-clips">
                <Link2 className="h-4 w-4 mr-2" />
                Web Clips
              </Button>
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-6 pb-8 space-y-6 eva-grid-bg">
        <Card className="eva-clip-panel eva-corner-decor border-border bg-card/80">
          <CardContent className="pt-8 pb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="space-y-3">
              <div className="eva-section-title">NERV Interface</div>
              <h2 className="text-3xl md:text-4xl font-sans uppercase tracking-[0.12em] text-primary leading-tight">
                NERV RESEARCH COMMAND CENTER
              </h2>
              <div className="flex items-center gap-3 text-sm font-mono text-chart-2">
                <div className="flex items-center gap-1.5">
                  <div className="eva-status-active" />
                  <div className="eva-status-active" />
                  <div className="eva-status-active" />
                </div>
                <span>SYSTEM ONLINE</span>
              </div>
            </div>

            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button
                  className="h-14 px-8 text-sm font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground hover:bg-primary/90"
                  data-testid="button-initialize-project"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  INITIALIZE NEW PROJECT
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Create New Project</DialogTitle>
                  <DialogDescription>
                    Define your research project. Thesis and scope improve annotation quality and retrieval.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Project Name</Label>
                    <Input
                      id="name"
                      value={newProject.name}
                      onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                      placeholder="e.g., Cold War Brainwashing Research"
                      data-testid="input-project-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      value={newProject.description}
                      onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                      className="resize-none"
                      data-testid="input-project-description"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="thesis">Thesis / Research Question</Label>
                    <Textarea
                      id="thesis"
                      value={newProject.thesis}
                      onChange={(e) => setNewProject({ ...newProject, thesis: e.target.value })}
                      className="resize-none"
                      data-testid="input-project-thesis"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="scope">Scope</Label>
                    <Textarea
                      id="scope"
                      value={newProject.scope}
                      onChange={(e) => setNewProject({ ...newProject, scope: e.target.value })}
                      className="resize-none"
                      data-testid="input-project-scope"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreateProject} disabled={createProject.isPending}>
                    {createProject.isPending ? "Creating..." : "Create Project"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>

        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <Card className="eva-clip-panel eva-corner-decor bg-card/70 border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm eva-section-title flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-primary" />
                Projects
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-3xl text-chart-2">{projectsCount}</div>
            </CardContent>
          </Card>

          <Card className="eva-clip-panel eva-corner-decor bg-card/70 border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm eva-section-title flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                Documents
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-3xl text-chart-3">{documentsCount}</div>
            </CardContent>
          </Card>

          <Card className="eva-clip-panel eva-corner-decor bg-card/70 border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm eva-section-title flex items-center gap-2">
                <Search className="h-4 w-4 text-primary" />
                Annotations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-3xl text-chart-2">{annotationsCount}</div>
            </CardContent>
          </Card>

          <Card className="eva-clip-panel eva-corner-decor bg-card/70 border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm eva-section-title flex items-center gap-2">
                <Upload className="h-4 w-4 text-primary" />
                Storage Used
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-3xl text-primary">{totalStorageLabel}</div>
            </CardContent>
          </Card>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card className="xl:col-span-2 eva-clip-panel eva-corner-decor bg-card/70 border-border">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="eva-section-title">Recent Projects</CardTitle>
              <Link href="/projects">
                <Button variant="ghost" className="text-xs uppercase tracking-[0.12em] font-mono text-primary" data-testid="button-view-all-projects">
                  VIEW ALL PROJECTS
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              {projectsLoading ? (
                <div className="text-sm text-muted-foreground font-mono">Loading projects...</div>
              ) : recentProjects.length === 0 ? (
                <div className="text-sm text-muted-foreground font-mono">No projects yet. Initialize your first project.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {recentProjects.map((project) => (
                    <Link key={project.id} href={`/projects/${project.id}`}>
                      <Card className="cursor-pointer hover-elevate eva-corner-decor bg-background/40 border-border">
                        <CardContent className="pt-4 pb-4 space-y-2">
                          <div className="font-sans uppercase tracking-[0.1em] text-sm line-clamp-2">{project.name}</div>
                          {project.description ? (
                            <p className="text-xs text-muted-foreground line-clamp-2">{project.description}</p>
                          ) : (
                            <p className="text-xs text-muted-foreground">No description</p>
                          )}
                          <div className="text-[11px] font-mono text-chart-3">
                            {new Date(project.createdAt).toLocaleDateString()}
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="eva-clip-panel eva-corner-decor bg-card/70 border-border">
            <CardHeader>
              <CardTitle className="eva-section-title">System Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm font-mono">
              {dashboardLoading || !dashboard ? (
                <div className="text-muted-foreground">Loading status...</div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-muted-foreground text-xs uppercase tracking-wider">Uptime</div>
                      <div className="text-chart-2">{formatUptime(liveUptimeSeconds)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs uppercase tracking-wider">Node</div>
                      <div className="text-chart-3">{dashboard.system.nodeVersion}</div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-muted-foreground text-xs uppercase tracking-wider">Platform</div>
                      <div className="text-primary">{dashboard.system.platform}</div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs uppercase tracking-wider text-muted-foreground">
                      <span>Heap Memory</span>
                      <span>{heapPercent}%</span>
                    </div>
                    <div className="h-2 rounded bg-muted overflow-hidden">
                      <div
                        className="h-full bg-chart-3 transition-all"
                        style={{ width: `${heapPercent}%` }}
                      />
                    </div>
                    <div className="text-xs text-chart-3">
                      {formatBytes(dashboard.system.heapUsedBytes)} / {formatBytes(dashboard.system.heapTotalBytes)}
                    </div>
                  </div>

                  <div className="space-y-1 text-xs">
                    <div className="text-muted-foreground uppercase tracking-wider">Document Status</div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2"><span className="eva-status-active" />Ready</span>
                      <span className="text-chart-2">{dashboard.documentsByStatus.ready}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2"><span className="eva-status-warning" />Processing</span>
                      <span className="text-primary">{dashboard.documentsByStatus.processing}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2"><span className="eva-status-error" />Error</span>
                      <span className="text-destructive">{dashboard.documentsByStatus.error}</span>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </section>

        <Card className="eva-clip-panel eva-corner-decor bg-card/70 border-border">
          <CardHeader>
            <CardTitle className="eva-section-title">Storage Allocation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 font-mono text-xs">
            <div className="h-5 rounded overflow-hidden border border-border flex">
              <div
                className="h-full bg-chart-3/80"
                style={{ width: `${storageDbPercent}%` }}
                title="Database"
              />
              <div
                className="h-full bg-primary/80"
                style={{ width: `${storageSourcePercent}%` }}
                title="Source Files"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="text-chart-3">DB: {formatBytes(dashboard?.storage.databaseBytes ?? 0)}</div>
              <div className="text-primary">Source Files: {formatBytes(dashboard?.storage.sourceFilesBytes ?? 0)}</div>
              <div className="text-chart-2">Total: {formatBytes(dashboard?.storage.totalBytes ?? 0)}</div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
