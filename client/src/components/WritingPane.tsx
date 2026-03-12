import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useProjects, useProjectDocuments } from "@/hooks/useProjects";
import {
  useWritingPipeline,
  type WritingRequest,
  type SavedPaper,
} from "@/hooks/useWriting";
import {
  buildDocxBlob,
  buildPdfBlob,
  downloadBlob,
  getDocTypeLabel,
  stripMarkdown,
  toSafeFilename,
} from "@/lib/documentExport";
import { markdownComponents, remarkPlugins } from "@/lib/markdownConfig";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  PenTool,
  RotateCcw,
  StopCircle,
} from "lucide-react";

interface WritingPaneProps {
  initialProjectId?: string;
  lockProject?: boolean;
}

interface GeneratedPaper {
  id: string;
  topic: string;
  content: string;
  createdAt: number;
  savedPaper: SavedPaper | null;
}

export default function WritingPane({
  initialProjectId,
  lockProject = false,
}: WritingPaneProps) {
  const { toast } = useToast();
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const lastCompletedTextRef = useRef("");
  const latestPaperIdRef = useRef<string | null>(null);
  const autoSelectedProjectsRef = useRef<Set<string>>(new Set());

  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId || "");
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState<"academic" | "casual" | "ap_style">("academic");
  const [targetLength, setTargetLength] = useState<"short" | "medium" | "long">("medium");
  const [citationStyle, setCitationStyle] = useState<"mla" | "apa" | "chicago">("chicago");
  const [selectedSourceDocumentIds, setSelectedSourceDocumentIds] = useState<string[]>([]);
  const [noEnDashes, setNoEnDashes] = useState(false);
  const [deepWrite, setDeepWrite] = useState(false);
  const [sourcesExpanded, setSourcesExpanded] = useState(true);
  const [generatedPapers, setGeneratedPapers] = useState<GeneratedPaper[]>([]);
  const [selectedPaperId, setSelectedPaperId] = useState("");
  const [currentPrompt, setCurrentPrompt] = useState("");
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [isPreparingPdf, setIsPreparingPdf] = useState(false);
  const [isPreparingDocx, setIsPreparingDocx] = useState(false);

  const {
    generate,
    cancel,
    reset,
    status,
    phase,
    plan,
    sections,
    fullText,
    isGenerating,
    error,
    savedPaper,
  } = useWritingPipeline();

  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const { data: projectSources = [], isLoading: projectSourcesLoading } = useProjectDocuments(
    selectedProjectId || ""
  );

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId),
    [projects, selectedProjectId]
  );

  useEffect(() => {
    if (lockProject && initialProjectId) {
      setSelectedProjectId(initialProjectId);
      return;
    }
    if (initialProjectId && !selectedProjectId) {
      setSelectedProjectId(initialProjectId);
      return;
    }
    if (!selectedProjectId && projects.length > 0) {
      setSelectedProjectId(projects[0].id);
    }
  }, [initialProjectId, lockProject, projects, selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) {
      setSelectedSourceDocumentIds([]);
      return;
    }
    const sourceIds = projectSources.map((source) => source.id);
    if (!autoSelectedProjectsRef.current.has(selectedProjectId) && sourceIds.length > 0) {
      autoSelectedProjectsRef.current.add(selectedProjectId);
      setSelectedSourceDocumentIds(sourceIds);
      return;
    }
    setSelectedSourceDocumentIds((prev) => prev.filter((id) => sourceIds.includes(id)));
  }, [projectSources, selectedProjectId]);

  useEffect(() => {
    if (rightPanelRef.current && (sections.length > 0 || fullText)) {
      rightPanelRef.current.scrollTop = rightPanelRef.current.scrollHeight;
    }
  }, [sections, fullText]);

  useEffect(() => {
    const trimmed = fullText.trim();
    if (!trimmed || trimmed === lastCompletedTextRef.current) return;
    const paperId = `paper-${Date.now()}`;
    latestPaperIdRef.current = paperId;
    lastCompletedTextRef.current = trimmed;
    setGeneratedPapers((prev) => [
      {
        id: paperId,
        topic: currentPrompt || topic.trim() || "Generated Paper",
        content: trimmed,
        createdAt: Date.now(),
        savedPaper: null,
      },
      ...prev,
    ]);
    setSelectedPaperId(paperId);
  }, [currentPrompt, fullText, topic]);

  useEffect(() => {
    if (!savedPaper || !latestPaperIdRef.current) return;
    setGeneratedPapers((prev) =>
      prev.map((paper) =>
        paper.id === latestPaperIdRef.current ? { ...paper, savedPaper } : paper
      )
    );
    if (selectedProjectId) {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", selectedProjectId, "documents"] });
    }
    toast({ title: "Saved to Project", description: savedPaper.filename });
  }, [savedPaper, selectedProjectId, toast]);

  useEffect(() => {
    return () => {
      if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
    };
  }, [pdfPreviewUrl]);

  const streamingContent = fullText || sections.map((section) => section.content).join("\n\n");
  const selectedPaper = useMemo(() => {
    if (!generatedPapers.length) return null;
    if (!selectedPaperId) return generatedPapers[0];
    return generatedPapers.find((paper) => paper.id === selectedPaperId) || generatedPapers[0];
  }, [generatedPapers, selectedPaperId]);
  const orderedPapers = useMemo(
    () => [...generatedPapers].sort((a, b) => a.createdAt - b.createdAt),
    [generatedPapers]
  );

  const activeContent = isGenerating ? streamingContent : selectedPaper?.content || streamingContent;
  const activeTopic = isGenerating ? currentPrompt : selectedPaper?.topic || currentPrompt || "Generated Paper";
  const activeSavedPaper = isGenerating ? null : selectedPaper?.savedPaper || null;
  const plainText = useMemo(() => stripMarkdown(activeContent), [activeContent]);
  const wordCount = useMemo(() => (plainText ? plainText.split(/\s+/).filter(Boolean).length : 0), [plainText]);
  const pageEstimate = useMemo(() => (wordCount > 0 ? Math.max(1, Math.round(wordCount / 500)) : 0), [wordCount]);

  const progressPercent = plan
    ? phase === "complete"
      ? 100
      : phase === "stitching"
        ? 90
        : Math.round((sections.length / Math.max(1, plan.sections.length)) * 80) + 10
    : phase === "planning"
      ? 5
      : 0;

  const clearPdfPreview = () => {
    if (pdfPreviewUrl) {
      URL.revokeObjectURL(pdfPreviewUrl);
      setPdfPreviewUrl(null);
    }
  };

  const handleGenerate = () => {
    if (!selectedProjectId) {
      toast({ title: "Project Required", description: "Select a project first.", variant: "destructive" });
      return;
    }
    if (!topic.trim()) {
      toast({ title: "Topic Required", description: "Enter a topic or prompt.", variant: "destructive" });
      return;
    }
    if (selectedSourceDocumentIds.length === 0) {
      toast({ title: "No Sources Selected", description: "Select at least one source.", variant: "destructive" });
      return;
    }

    clearPdfPreview();
    setShowPdfPreview(false);
    setCurrentPrompt(topic.trim());

    const request: WritingRequest = {
      topic: topic.trim(),
      annotationIds: [],
      sourceDocumentIds: selectedSourceDocumentIds,
      projectId: selectedProjectId,
      citationStyle,
      tone,
      targetLength,
      noEnDashes,
      deepWrite,
    };
    generate(request);
  };

  const handleReset = () => {
    clearPdfPreview();
    setShowPdfPreview(false);
    reset();
    setTopic("");
    setCurrentPrompt("");
  };

  const handleCopy = async () => {
    if (!activeContent) {
      toast({ title: "Nothing to copy", variant: "destructive" });
      return;
    }
    try {
      await navigator.clipboard.writeText(activeContent);
      toast({ title: "Copied to clipboard" });
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

  const handleDownloadDocx = async () => {
    if (!activeContent) return;
    setIsPreparingDocx(true);
    try {
      const blob = await buildDocxBlob(activeTopic, activeContent);
      downloadBlob(blob, `${toSafeFilename(activeTopic)}.docx`);
    } catch (downloadError) {
      toast({
        title: "DOCX Export Failed",
        description: downloadError instanceof Error ? downloadError.message : "Could not export DOCX.",
        variant: "destructive",
      });
    } finally {
      setIsPreparingDocx(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!activeContent) return;
    setIsPreparingPdf(true);
    try {
      const blob = await buildPdfBlob(activeTopic, activeContent);
      downloadBlob(blob, `${toSafeFilename(activeTopic)}.pdf`);
    } catch (downloadError) {
      toast({
        title: "PDF Export Failed",
        description: downloadError instanceof Error ? downloadError.message : "Could not export PDF.",
        variant: "destructive",
      });
    } finally {
      setIsPreparingPdf(false);
    }
  };

  const handleTogglePdfPreview = async () => {
    if (!activeContent) return;
    if (showPdfPreview) {
      setShowPdfPreview(false);
      clearPdfPreview();
      return;
    }
    setIsPreparingPdf(true);
    try {
      const blob = await buildPdfBlob(activeTopic, activeContent);
      clearPdfPreview();
      setPdfPreviewUrl(URL.createObjectURL(blob));
      setShowPdfPreview(true);
    } catch (previewError) {
      toast({
        title: "Preview Failed",
        description: previewError instanceof Error ? previewError.message : "Could not generate preview.",
        variant: "destructive",
      });
    } finally {
      setIsPreparingPdf(false);
    }
  };

  const toggleSource = (projectDocumentId: string) => {
    setSelectedSourceDocumentIds((prev) =>
      prev.includes(projectDocumentId)
        ? prev.filter((id) => id !== projectDocumentId)
        : [...prev, projectDocumentId]
    );
  };

  const toggleAllSources = () => {
    if (selectedSourceDocumentIds.length === projectSources.length) {
      setSelectedSourceDocumentIds([]);
      return;
    }
    setSelectedSourceDocumentIds(projectSources.map((source) => source.id));
  };

  return (
    <div className="h-full min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_380px] border border-border rounded-xl overflow-hidden bg-[#F5F0E8] dark:bg-background">
      <section className="min-h-0 flex flex-col bg-[#FAF7F1] dark:bg-background">
        <div className="border-b border-border px-5 py-3 bg-background/80 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">project</span>
              <span className="font-semibold">{selectedProject?.name || "Select project"}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-[10px] uppercase">{wordCount} words</Badge>
              <Badge variant="outline" className="font-mono text-[10px] uppercase">{pageEstimate} page{pageEstimate === 1 ? "" : "s"}</Badge>
              {activeSavedPaper && <Badge variant="secondary" className="font-mono text-[10px] uppercase">Saved</Badge>}
            </div>
          </div>
        </div>

        <div ref={rightPanelRef} className="flex-1 min-h-0 overflow-auto px-5 py-4 space-y-4">
          {!orderedPapers.length && !currentPrompt && !activeContent && !isGenerating && (
            <div className="h-full min-h-[260px] flex items-center justify-center">
              <div className="text-center space-y-2 max-w-md">
                <PenTool className="h-12 w-12 mx-auto text-primary/60" />
                <p className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
                  Select a project and enter a topic to start writing
                </p>
              </div>
            </div>
          )}

          {orderedPapers.map((paper) => (
            <div key={paper.id} className="space-y-2">
              <div className="ml-auto max-w-[88%] rounded-2xl bg-[#E8D6C2] dark:bg-muted px-4 py-2 text-sm">
                {paper.topic}
              </div>
              <div className="max-w-[92%] rounded-2xl border border-border bg-background px-4 py-3">
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
                    {paper.content}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          ))}

          {currentPrompt && isGenerating && (
            <div className="space-y-2">
              <div className="ml-auto max-w-[88%] rounded-2xl bg-[#E8D6C2] dark:bg-muted px-4 py-2 text-sm">
                {currentPrompt}
              </div>
              <div className="max-w-[92%] rounded-2xl border border-border bg-background px-4 py-3">
                <div className="flex items-center gap-2 text-xs mb-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  <span className="text-muted-foreground">{status || "Generating..."}</span>
                </div>
                {activeContent ? (
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
                      {activeContent}
                    </ReactMarkdown>
                    <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1" />
                  </div>
                ) : (
                  <div className="space-y-2 animate-pulse">
                    <div className="h-4 w-full bg-muted rounded" />
                    <div className="h-4 w-[92%] bg-muted rounded" />
                    <div className="h-4 w-[84%] bg-muted rounded" />
                  </div>
                )}
              </div>
            </div>
          )}

          {!!error && (
            <div className="max-w-[92%] rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <div className="border-t border-border bg-background/95 px-4 py-3 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs uppercase tracking-wider">Project</Label>
              {lockProject ? (
                <div className="rounded-md border px-3 py-2 text-sm">{selectedProject?.name || "Current Project"}</div>
              ) : (
                <Select value={selectedProjectId} onValueChange={setSelectedProjectId} disabled={projectsLoading || isGenerating}>
                  <SelectTrigger data-testid="select-writing-project"><SelectValue placeholder="Select project" /></SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs uppercase tracking-wider">Topic / Prompt</Label>
              <Textarea
                id="writing-topic"
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                placeholder="Enter your writing instruction..."
                className="min-h-[68px] resize-none"
                disabled={isGenerating}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Select value={tone} onValueChange={(v) => setTone(v as typeof tone)} disabled={isGenerating}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="academic">Academic</SelectItem>
                <SelectItem value="casual">Casual</SelectItem>
                <SelectItem value="ap_style">AP Style</SelectItem>
              </SelectContent>
            </Select>
            <Select value={targetLength} onValueChange={(v) => setTargetLength(v as typeof targetLength)} disabled={isGenerating}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="short">Short</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="long">Long</SelectItem>
              </SelectContent>
            </Select>
            <Select value={citationStyle} onValueChange={(v) => setCitationStyle(v as typeof citationStyle)} disabled={isGenerating}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="chicago">Chicago</SelectItem>
                <SelectItem value="mla">MLA</SelectItem>
                <SelectItem value="apa">APA</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-3 px-2">
              <label className="flex items-center gap-2 text-xs">
                <Checkbox checked={noEnDashes} onCheckedChange={(v) => setNoEnDashes(Boolean(v))} disabled={isGenerating} />
                No dashes
              </label>
              <label className="flex items-center gap-2 text-xs">
                <Checkbox checked={deepWrite} onCheckedChange={(v) => setDeepWrite(Boolean(v))} disabled={isGenerating} />
                Deep
              </label>
            </div>
          </div>

          {(isGenerating || phase) && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs">
                {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> : error ? <AlertCircle className="h-3.5 w-3.5 text-destructive" /> : <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />}
                <span className="text-muted-foreground">{status}</span>
              </div>
              {isGenerating && <Progress value={progressPercent} className="h-1.5" />}
            </div>
          )}

          <div className="flex items-center gap-2">
            {!isGenerating ? (
              <Button onClick={handleGenerate} className="flex-1" data-testid="button-generate-paper">
                <FileText className="h-4 w-4 mr-2" />
                Generate Paper
              </Button>
            ) : (
              <Button variant="destructive" onClick={cancel} className="flex-1">
                <StopCircle className="h-4 w-4 mr-2" />
                Stop
              </Button>
            )}
            <Button variant="outline" onClick={handleReset}><RotateCcw className="h-4 w-4 mr-2" />Reset</Button>
          </div>
        </div>
      </section>

      <aside className="min-h-0 border-t lg:border-t-0 lg:border-l border-border bg-[#F1ECE2] dark:bg-muted/10">
        <div className="h-full min-h-0 overflow-auto p-4 space-y-4">
          <Card className="border-border bg-background/80">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Artifacts</CardTitle>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={handleCopy} disabled={!activeContent}><Copy className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="sm" onClick={handleDownloadDocx} disabled={!activeContent || isPreparingDocx}>
                    {isPreparingDocx ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleDownloadPdf} disabled={!activeContent || isPreparingPdf}>
                    {isPreparingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleTogglePdfPreview} disabled={!activeContent || isPreparingPdf}>
                    {showPdfPreview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {generatedPapers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No artifacts yet.</p>
              ) : (
                generatedPapers.map((paper) => (
                  <button
                    key={paper.id}
                    type="button"
                    onClick={() => setSelectedPaperId(paper.id)}
                    className={`w-full text-left rounded-lg border p-3 transition ${selectedPaper?.id === paper.id ? "border-primary bg-primary/10" : "border-border bg-background hover:bg-muted/40"}`}
                  >
                    <div className="text-sm font-medium truncate">{paper.topic}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {paper.savedPaper ? paper.savedPaper.filename : `${new Date(paper.createdAt).toLocaleTimeString()}`}
                    </div>
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          {showPdfPreview && pdfPreviewUrl && (
            <Card className="border-border bg-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">PDF Preview</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[320px] overflow-hidden rounded border">
                  <iframe src={pdfPreviewUrl} title="Generated PDF Preview" className="w-full h-full" />
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="border-border bg-background/80">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Project Content</CardTitle>
                <button type="button" className="text-xs text-muted-foreground" onClick={() => setSourcesExpanded((v) => !v)}>
                  {sourcesExpanded ? "Hide" : "Show"}
                </button>
              </div>
            </CardHeader>
            <CardContent>
              {sourcesExpanded && (
                <>
                  <div className="flex justify-end mb-2">
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={toggleAllSources} disabled={projectSources.length === 0 || isGenerating}>
                      {selectedSourceDocumentIds.length === projectSources.length ? "Deselect all" : "Select all"}
                    </Button>
                  </div>
                  <ScrollArea className="h-64">
                    {projectSourcesLoading ? (
                      <p className="text-xs text-muted-foreground">Loading project sources...</p>
                    ) : projectSources.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No source documents in this project.</p>
                    ) : (
                      <div className="space-y-2">
                        {projectSources.map((source) => (
                          <label key={source.id} className="flex gap-2 rounded-md p-2 hover:bg-muted/40 cursor-pointer">
                            <Checkbox checked={selectedSourceDocumentIds.includes(source.id)} onCheckedChange={() => toggleSource(source.id)} disabled={isGenerating} className="mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium truncate">{source.document.filename}</span>
                                <Badge variant="outline" className="text-[10px]">{getDocTypeLabel(source.document.filename)}</Badge>
                              </div>
                              <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                                {source.document.summary || "No summary available for this source."}
                              </p>
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </aside>
    </div>
  );
}
