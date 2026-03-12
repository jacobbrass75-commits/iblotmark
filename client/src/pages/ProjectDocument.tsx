import { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  useProject,
  useProjectAnnotations,
  useCreateProjectAnnotation,
  useDeleteProjectAnnotation,
  useUpdateProjectDocument,
  useAnalyzeProjectDocument,
  useSearchProjectDocument,
  useAnalyzeMultiPrompt,
  usePromptTemplates,
  useCreatePromptTemplate,
} from "@/hooks/useProjects";
import { useGenerateCitation } from "@/hooks/useProjectSearch";
import { useDocumentSourceMeta } from "@/hooks/useDocument";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { copyTextToClipboard } from "@/lib/clipboard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  BookOpen,
  Copy,
  Plus,
  Trash2,
  Sparkles,
  FileText,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/ThemeToggle";
import { MultiPromptPanel, type Prompt } from "@/components/MultiPromptPanel";
import { SearchPanel } from "@/components/SearchPanel";
import { DocumentViewer } from "@/components/DocumentViewer";
import { AnnotationSidebar } from "@/components/AnnotationSidebar";
import { ManualAnnotationDialog } from "@/components/ManualAnnotationDialog";
import type {
  ProjectDocument,
  Document,
  AnnotationCategory,
  CitationData,
  CitationStyle,
  SearchResult,
  Annotation,
} from "@shared/schema";

const SOURCE_TYPES = [
  "book",
  "journal",
  "website",
  "newspaper",
  "chapter",
  "thesis",
  "other",
] as const;

export default function ProjectDocumentPage() {
  const [, params] = useRoute("/projects/:projectId/documents/:docId");
  const [location] = useLocation();
  const projectId = params?.projectId || "";
  const projectDocId = params?.docId || "";
  const { toast } = useToast();

  // State
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [manualDialogOpen, setManualDialogOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<{
    text: string;
    start: number;
    end: number;
  } | null>(null);
  const [isCitationOpen, setIsCitationOpen] = useState(false);
  const [citationStyle, setCitationStyle] = useState<CitationStyle>("chicago");
  const [citationForm, setCitationForm] = useState<CitationData>({
    sourceType: "book",
    authors: [{ firstName: "", lastName: "" }],
    title: "",
  });
  const [citationPreview, setCitationPreview] = useState<{
    footnote: string;
    bibliography: string;
    inlineCitation?: string;
    style?: CitationStyle;
  } | null>(null);
  const [isAutoFilling, setIsAutoFilling] = useState(false);
  const [hasAppliedDeepLink, setHasAppliedDeepLink] = useState(false);

  // Queries
  const { data: project } = useProject(projectId);

  const { data: projectDoc, isLoading: docLoading } = useQuery<ProjectDocument>({
    queryKey: ["/api/project-documents", projectDocId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/project-documents/${projectDocId}`);
      return res.json();
    },
    enabled: !!projectDocId,
  });

  const { data: document, isLoading: documentLoading } = useQuery<Document>({
    queryKey: ["/api/documents", projectDoc?.documentId],
    enabled: !!projectDoc?.documentId,
  });
  const { data: sourceMeta } = useDocumentSourceMeta(projectDoc?.documentId || null);

  const { data: projectAnnotations = [], isLoading: annotationsLoading } =
    useProjectAnnotations(projectDocId);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.debug("[ProjectDocument] Data chain", {
      projectId,
      projectDocId,
      projectDocumentLoaded: !!projectDoc,
      resolvedDocumentId: projectDoc?.documentId ?? null,
      documentLoaded: !!document,
      annotationsCount: projectAnnotations.length,
    });
  }, [
    projectId,
    projectDocId,
    projectDoc?.id,
    projectDoc?.documentId,
    document?.id,
    projectAnnotations.length,
  ]);

  const deepLinkQuery = useMemo(() => {
    const queryFromLocation = location.includes("?") ? location.slice(location.indexOf("?")) : "";
    if (queryFromLocation) return queryFromLocation;
    if (typeof window === "undefined") return "";
    return window.location.search || "";
  }, [location]);

  const { deepLinkAnnotationId, deepLinkStartPosition } = useMemo(() => {
    const params = new URLSearchParams(deepLinkQuery);
    const annotationId = params.get("annotationId");
    const startRaw = params.get("start");
    const parsedStart = startRaw ? Number(startRaw) : null;
    return {
      deepLinkAnnotationId: annotationId,
      deepLinkStartPosition: Number.isFinite(parsedStart) ? parsedStart : null,
    };
  }, [deepLinkQuery]);

  // Mutations
  const createAnnotation = useCreateProjectAnnotation();
  const deleteAnnotation = useDeleteProjectAnnotation();
  const updateProjectDoc = useUpdateProjectDocument();
  const generateCitation = useGenerateCitation();
  const analyzeDocument = useAnalyzeProjectDocument();
  const searchDocument = useSearchProjectDocument();
  const analyzeMultiPrompt = useAnalyzeMultiPrompt();
  const createPromptTemplate = useCreatePromptTemplate();

  // Queries for templates
  const { data: promptTemplates = [] } = usePromptTemplates(projectId);

  // Extended annotation type with prompt fields
  interface AnnotationWithPrompt extends Omit<Annotation, 'promptText' | 'promptIndex' | 'promptColor'> {
    promptText?: string | null;
    promptIndex?: number | null;
    promptColor?: string | null;
  }

  // Convert project annotations to regular Annotation format for AnnotationSidebar
  const annotations: AnnotationWithPrompt[] = projectAnnotations.map((pa) => ({
    id: pa.id,
    documentId: projectDoc?.documentId || "",
    startPosition: pa.startPosition,
    endPosition: pa.endPosition,
    highlightedText: pa.highlightedText,
    category: pa.category as AnnotationCategory,
    note: pa.note || "",
    isAiGenerated: pa.isAiGenerated ?? false,
    confidenceScore: pa.confidenceScore,
    createdAt: pa.createdAt,
    chunkId: null,
    analysisRunId: pa.analysisRunId,
    promptText: pa.promptText,
    promptIndex: pa.promptIndex,
    promptColor: pa.promptColor,
  }));

  // Calculate prompt stats for MultiPromptPanel
  const promptStats = useMemo(() => {
    const stats = new Map<number, number>();
    for (const ann of projectAnnotations) {
      if (ann.promptIndex != null) {
        stats.set(ann.promptIndex, (stats.get(ann.promptIndex) || 0) + 1);
      }
    }
    return stats;
  }, [projectAnnotations]);

  // Initialize citation form from project doc
  useEffect(() => {
    if (projectDoc?.citationData) {
      setCitationForm(projectDoc.citationData);
    }
  }, [projectDoc?.citationData]);

  // Clear citation preview when style changes so user re-generates
  useEffect(() => {
    setCitationPreview(null);
  }, [citationStyle]);

  // Mark as analyzed if there are annotations
  useEffect(() => {
    if (projectAnnotations.length > 0) {
      setHasAnalyzed(true);
    }
  }, [projectAnnotations.length]);

  // If we arrive from global search with an annotation target, select it once data is loaded.
  useEffect(() => {
    if (hasAppliedDeepLink) return;

    if (!deepLinkAnnotationId && deepLinkStartPosition === null) {
      setHasAppliedDeepLink(true);
      return;
    }

    if (annotations.length === 0) {
      if (!annotationsLoading) {
        setHasAppliedDeepLink(true);
      }
      return;
    }

    const targetById = deepLinkAnnotationId
      ? annotations.find((a) => a.id === deepLinkAnnotationId)
      : undefined;
    const targetByStart =
      deepLinkStartPosition !== null
        ? annotations.find((a) => a.startPosition === deepLinkStartPosition)
        : undefined;
    const target = targetById || targetByStart;

    if (target) {
      setSelectedAnnotationId(target.id);
    }
    setHasAppliedDeepLink(true);
  }, [
    hasAppliedDeepLink,
    deepLinkAnnotationId,
    deepLinkStartPosition,
    annotations,
    annotationsLoading,
  ]);

  // Handlers
  const handleAnalyze = useCallback(
    async (
      research: string,
      goals: string,
      thoroughness: "quick" | "standard" | "thorough" | "exhaustive" = "standard"
    ) => {
      if (!projectDocId) return;

      const intent = `Research topic: ${research}\n\nGoals: ${goals}`;

      try {
        await analyzeDocument.mutateAsync({
          projectDocumentId: projectDocId,
          intent,
          thoroughness,
        });
        setHasAnalyzed(true);

        toast({
          title: "Analysis complete",
          description: "AI has highlighted relevant passages in your document.",
        });
      } catch (error) {
        toast({
          title: "Analysis failed",
          description:
            error instanceof Error ? error.message : "Could not analyze the document.",
          variant: "destructive",
        });
      }
    },
    [projectDocId, analyzeDocument, toast]
  );

  const handleMultiPromptAnalyze = useCallback(
    async (
      prompts: Prompt[],
      thoroughness: "quick" | "standard" | "thorough" | "exhaustive" = "standard"
    ) => {
      if (!projectDocId) return;

      try {
        await analyzeMultiPrompt.mutateAsync({
          projectDocumentId: projectDocId,
          prompts: prompts.map((p) => ({ text: p.text, color: p.color })),
          thoroughness,
        });
        setHasAnalyzed(true);

        toast({
          title: "Analysis complete",
          description: `${prompts.length} prompt(s) analyzed. AI has highlighted relevant passages.`,
        });
      } catch (error) {
        toast({
          title: "Analysis failed",
          description:
            error instanceof Error ? error.message : "Could not analyze the document.",
          variant: "destructive",
        });
      }
    },
    [projectDocId, analyzeMultiPrompt, toast]
  );

  const handleSaveTemplate = useCallback(
    async (name: string, prompts: Prompt[]) => {
      if (!projectId) return;

      try {
        await createPromptTemplate.mutateAsync({
          projectId,
          name,
          prompts: prompts.map((p) => ({ text: p.text, color: p.color })),
        });

        toast({
          title: "Template saved",
          description: `"${name}" saved for reuse in this project.`,
        });
      } catch (error) {
        toast({
          title: "Failed to save template",
          description:
            error instanceof Error ? error.message : "Could not save the template.",
          variant: "destructive",
        });
      }
    },
    [projectId, createPromptTemplate, toast]
  );

  const handleAnnotationClick = useCallback((annotation: AnnotationWithPrompt) => {
    setSelectedAnnotationId(annotation.id);
  }, []);

  const handleTextSelect = useCallback(
    (selection: { text: string; start: number; end: number }) => {
      setPendingSelection(selection);
      setManualDialogOpen(true);
    },
    []
  );

  const handleAddManualAnnotation = useCallback(() => {
    setPendingSelection(null);
    setManualDialogOpen(true);
  }, []);

  const handleSaveManualAnnotation = useCallback(
    async (note: string, category: AnnotationCategory) => {
      if (!projectDocId || !pendingSelection) return;

      try {
        await createAnnotation.mutateAsync({
          projectDocumentId: projectDocId,
          data: {
            startPosition: pendingSelection.start,
            endPosition: pendingSelection.end,
            highlightedText: pendingSelection.text,
            category,
            note,
            isAiGenerated: false,
          },
        });

        toast({
          title: "Annotation added",
          description: "Your note has been saved.",
        });

        setPendingSelection(null);
      } catch (error) {
        toast({
          title: "Failed to add annotation",
          description:
            error instanceof Error ? error.message : "Could not save the annotation.",
          variant: "destructive",
        });
      }
    },
    [projectDocId, pendingSelection, createAnnotation, toast]
  );

  const handleUpdateAnnotation = useCallback(
    async (annotationId: string, note: string, category: AnnotationCategory) => {
      try {
        await apiRequest("PUT", `/api/project-annotations/${annotationId}`, { note, category });

        queryClient.invalidateQueries({
          queryKey: ["/api/project-documents", projectDocId, "annotations"],
        });

        toast({
          title: "Annotation updated",
          description: "Your changes have been saved.",
        });
      } catch (error) {
        toast({
          title: "Update failed",
          description:
            error instanceof Error ? error.message : "Could not update the annotation.",
          variant: "destructive",
        });
      }
    },
    [projectDocId, toast]
  );

  const handleDeleteAnnotation = useCallback(
    async (annotationId: string) => {
      try {
        await deleteAnnotation.mutateAsync({
          id: annotationId,
          projectDocumentId: projectDocId,
        });

        if (selectedAnnotationId === annotationId) {
          setSelectedAnnotationId(null);
        }

        toast({
          title: "Annotation deleted",
          description: "The annotation has been removed.",
        });
      } catch (error) {
        toast({
          title: "Delete failed",
          description:
            error instanceof Error ? error.message : "Could not delete the annotation.",
          variant: "destructive",
        });
      }
    },
    [projectDocId, selectedAnnotationId, deleteAnnotation, toast]
  );

  const handleSearch = useCallback(
    async (query: string): Promise<SearchResult[]> => {
      if (!projectDocId) return [];

      try {
        const results = await searchDocument.mutateAsync({
          projectDocumentId: projectDocId,
          query,
        });
        return results;
      } catch (error) {
        toast({
          title: "Search failed",
          description:
            error instanceof Error ? error.message : "Could not search the document.",
          variant: "destructive",
        });
        return [];
      }
    },
    [projectDocId, searchDocument, toast]
  );

  const handleJumpToPosition = useCallback(
    (start: number, end: number) => {
      const matchingAnnotation = annotations.find(
        (a) => a.startPosition === start && a.endPosition === end
      );
      if (matchingAnnotation) {
        setSelectedAnnotationId(matchingAnnotation.id);
      }
    },
    [annotations]
  );

  const handleCopyFootnote = useCallback(
    async (annotationId: string) => {
      try {
        const res = await apiRequest("POST", `/api/project-annotations/${annotationId}/footnote`, {
          style: citationStyle,
        });
        const data = await res.json();
        const styleLabel = citationStyle === "mla" ? "MLA" : citationStyle === "apa" ? "APA" : "Chicago";
        // For MLA/APA copy in-text citation; for Chicago copy footnoteWithQuote
        const textToCopy = citationStyle === "chicago" ? data.footnoteWithQuote : data.inlineCitation;
        await copyTextToClipboard(textToCopy);
        toast({
          title: "Citation Copied",
          description: `${styleLabel}-style citation copied to clipboard`,
        });
      } catch (error) {
        toast({
          title: "Error",
          description: "Failed to generate citation",
          variant: "destructive",
        });
      }
    },
    [toast, citationStyle]
  );

  const handleCopyQuote = useCallback(
    async (quote: string) => {
      try {
        await copyTextToClipboard(quote);
        toast({
          title: "Copied",
          description: "Quote copied to clipboard",
        });
      } catch (error) {
        toast({
          title: "Copy failed",
          description: "Clipboard access is unavailable. Try selecting the quote text manually.",
          variant: "destructive",
        });
      }
    },
    [toast]
  );

  // Citation handlers
  const handleSaveCitation = async () => {
    try {
      await updateProjectDoc.mutateAsync({
        id: projectDocId,
        projectId,
        data: { citationData: citationForm },
      });

      const preview = await generateCitation.mutateAsync({
        citationData: citationForm,
        style: citationStyle,
      });
      setCitationPreview(preview);
      toast({ title: "Success", description: "Citation saved" });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save citation",
        variant: "destructive",
      });
    }
  };

  const addAuthor = () => {
    setCitationForm({
      ...citationForm,
      authors: [...citationForm.authors, { firstName: "", lastName: "" }],
    });
  };

  const removeAuthor = (index: number) => {
    setCitationForm({
      ...citationForm,
      authors: citationForm.authors.filter((_, i) => i !== index),
    });
  };

  const updateAuthor = (
    index: number,
    field: "firstName" | "lastName",
    value: string
  ) => {
    const newAuthors = [...citationForm.authors];
    newAuthors[index] = { ...newAuthors[index], [field]: value };
    setCitationForm({ ...citationForm, authors: newAuthors });
  };

  const handleAutoFill = async () => {
    if (!projectDoc?.documentId) {
      toast({
        title: "Error",
        description: "No document available",
        variant: "destructive",
      });
      return;
    }

    setIsAutoFilling(true);
    try {
      const res = await apiRequest("POST", "/api/citations/ai", {
        documentId: projectDoc.documentId,
      });
      const data = await res.json();

      if (data.citationData) {
        const cd = data.citationData;
        setCitationForm((prev) => {
          const hasEmptyAuthor =
            prev.authors.length === 1 &&
            !prev.authors[0].firstName &&
            !prev.authors[0].lastName;

          let mergedAuthors: { firstName: string; lastName: string }[];
          if (hasEmptyAuthor && cd.authors?.length > 0) {
            mergedAuthors = cd.authors;
          } else {
            mergedAuthors = prev.authors.map((author, idx) => {
              const aiAuthor = cd.authors?.[idx];
              if (!aiAuthor) return author;
              return {
                firstName: author.firstName || aiAuthor.firstName || "",
                lastName: author.lastName || aiAuthor.lastName || "",
              };
            });
            if (cd.authors && cd.authors.length > prev.authors.length) {
              mergedAuthors = [
                ...mergedAuthors,
                ...cd.authors.slice(prev.authors.length),
              ];
            }
          }

          return {
            ...prev,
            sourceType:
              prev.sourceType === "book" && cd.sourceType
                ? cd.sourceType
                : prev.sourceType,
            authors: mergedAuthors,
            title: prev.title || cd.title || "",
            publisher: prev.publisher || cd.publisher,
            publicationDate: prev.publicationDate || cd.publicationDate,
            publicationPlace: prev.publicationPlace || cd.publicationPlace,
            url: prev.url || cd.url,
            containerTitle: prev.containerTitle || cd.containerTitle,
            volume: prev.volume || cd.volume,
            issue: prev.issue || cd.issue,
            pageStart: prev.pageStart || cd.pageStart,
            pageEnd: prev.pageEnd || cd.pageEnd,
          };
        });
        toast({
          title: "Success",
          description: "Citation metadata extracted from document",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to extract citation metadata",
        variant: "destructive",
      });
    } finally {
      setIsAutoFilling(false);
    }
  };

  if (docLoading || documentLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">
          Loading document...
        </div>
      </div>
    );
  }

  if (!projectDoc || !document) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <h2 className="text-xl font-semibold">Document Not Found</h2>
          <Link href={`/projects/${projectId}`}>
            <Button>Back to Project</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-background/95 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link href={`/projects/${projectId}`}>
              <Button variant="ghost" size="icon" data-testid="button-back">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="font-semibold font-mono text-sm">{document.filename}</h1>
              {project && (
                <p className="text-xs text-muted-foreground">{project.name}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button className="uppercase tracking-wider text-xs" onClick={() => setIsCitationOpen(true)} data-testid="button-edit-citation">
              <BookOpen className="h-4 w-4 mr-2" />
              Citation
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main Content - 4 Column Grid */}
      <main className="flex-1 container mx-auto px-4 py-6 pb-8 eva-grid-bg">
        <div className="grid lg:grid-cols-4 gap-6 h-[calc(100vh-8rem)]">
          {/* Left Sidebar: Multi-Prompt Panel + Citation Info */}
          <div className="lg:col-span-1 flex flex-col gap-4 overflow-hidden">
            <div className="flex-1 min-h-0">
              <MultiPromptPanel
                documentId={projectDocId}
                projectId={projectId}
                onAnalyze={handleMultiPromptAnalyze}
                isAnalyzing={analyzeMultiPrompt.isPending}
                hasAnalyzed={hasAnalyzed}
                annotationCount={annotations.length}
                promptStats={promptStats}
                templates={promptTemplates}
                onSaveTemplate={handleSaveTemplate}
                isSavingTemplate={createPromptTemplate.isPending}
              />
            </div>

            {/* Citation Summary Card */}
            {projectDoc.citationData && (
              <Card className="shrink-0">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Citation
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  <p className="line-clamp-2">
                    {projectDoc.citationData.authors?.[0]?.lastName || "Unknown"},{" "}
                    <em>{projectDoc.citationData.title || "Untitled"}</em>
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="px-0 h-auto mt-1 text-primary hover:underline"
                    onClick={() => setIsCitationOpen(true)}
                  >
                    Edit citation
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Center: Document Viewer + Search */}
          <div className="lg:col-span-2 flex flex-col gap-4 overflow-hidden">
            <div className="flex-1 min-h-0">
              <DocumentViewer
                document={document}
                annotations={annotations}
                isLoading={docLoading}
                sourceMeta={sourceMeta}
                selectedAnnotationId={selectedAnnotationId}
                onAnnotationClick={handleAnnotationClick}
                onTextSelect={handleTextSelect}
              />
            </div>
            <SearchPanel
              documentId={projectDocId}
              onSearch={handleSearch}
              onJumpToPosition={handleJumpToPosition}
            />
          </div>

          {/* Right Sidebar: Annotations */}
          <div className="lg:col-span-1 overflow-hidden">
            <AnnotationSidebar
              annotations={annotations}
              isLoading={annotationsLoading}
              selectedAnnotationId={selectedAnnotationId}
              onSelect={handleAnnotationClick}
              onDelete={handleDeleteAnnotation}
              onUpdate={handleUpdateAnnotation}
              onAddManual={handleAddManualAnnotation}
              canAddManual={!!projectDocId}
              onCopyQuote={handleCopyQuote}
              showFootnoteButton={true}
              onCopyFootnote={handleCopyFootnote}
            />
          </div>
        </div>
      </main>

      {/* Manual Annotation Dialog */}
      <ManualAnnotationDialog
        open={manualDialogOpen}
        onOpenChange={setManualDialogOpen}
        selectedText={pendingSelection}
        onSave={handleSaveManualAnnotation}
      />

      {/* Citation Dialog */}
      <Dialog open={isCitationOpen} onOpenChange={setIsCitationOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto eva-grid-bg">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2">
              <span>Citation Metadata</span>
              <Button
                variant="outline"
                size="sm"
                className="text-chart-3 uppercase tracking-wider text-xs"
                onClick={handleAutoFill}
                disabled={isAutoFilling}
                data-testid="button-autofill-citation"
              >
                {isAutoFilling ? (
                  <div className="eva-hex-spinner mr-1.5" style={{ width: "0.75rem", height: "0.75rem" }} />
                ) : (
                  <Sparkles className="h-3 w-3 mr-1.5" />
                )}
                {isAutoFilling ? "Extracting..." : "Auto-fill with AI"}
              </Button>
            </DialogTitle>
            <DialogDescription>
              Enter bibliographic information for citations
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 py-2">
            <Label className="text-sm whitespace-nowrap">Citation Style</Label>
            <Select value={citationStyle} onValueChange={(v) => setCitationStyle(v as CitationStyle)}>
              <SelectTrigger className="w-[200px]" data-testid="select-citation-style">
                <SelectValue placeholder="Citation Style" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="chicago">Chicago</SelectItem>
                <SelectItem value="mla">MLA (9th Ed.)</SelectItem>
                <SelectItem value="apa">APA (7th Ed.)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Tabs defaultValue="metadata">
            <TabsList className="w-full">
              <TabsTrigger value="metadata" className="flex-1">
                Metadata
              </TabsTrigger>
              <TabsTrigger value="preview" className="flex-1">
                Preview
              </TabsTrigger>
            </TabsList>
            <TabsContent value="metadata" className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Source Type</Label>
                <Select
                  value={citationForm.sourceType}
                  onValueChange={(v) =>
                    setCitationForm({
                      ...citationForm,
                      sourceType: v as (typeof SOURCE_TYPES)[number],
                    })
                  }
                >
                  <SelectTrigger data-testid="select-source-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SOURCE_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type.charAt(0).toUpperCase() + type.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Authors</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={addAuthor}
                    data-testid="button-add-author"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add
                  </Button>
                </div>
                {citationForm.authors.map((author, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <Input
                      placeholder="First name"
                      value={author.firstName}
                      onChange={(e) =>
                        updateAuthor(idx, "firstName", e.target.value)
                      }
                      className="flex-1 font-mono"
                      data-testid={`input-author-first-${idx}`}
                    />
                    <Input
                      placeholder="Last name"
                      value={author.lastName}
                      onChange={(e) =>
                        updateAuthor(idx, "lastName", e.target.value)
                      }
                      className="flex-1 font-mono"
                      data-testid={`input-author-last-${idx}`}
                    />
                    {citationForm.authors.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => removeAuthor(idx)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <Label>Title</Label>
                <Input
                  value={citationForm.title}
                  onChange={(e) =>
                    setCitationForm({ ...citationForm, title: e.target.value })
                  }
                  placeholder="Title of the work"
                  className="font-mono"
                  data-testid="input-title"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Publisher</Label>
                  <Input
                    value={citationForm.publisher || ""}
                    onChange={(e) =>
                      setCitationForm({
                        ...citationForm,
                        publisher: e.target.value,
                      })
                    }
                    placeholder="Publisher name"
                    className="font-mono"
                    data-testid="input-publisher"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Publication Date</Label>
                  <Input
                    value={citationForm.publicationDate || ""}
                    onChange={(e) =>
                      setCitationForm({
                        ...citationForm,
                        publicationDate: e.target.value,
                      })
                    }
                    placeholder="YYYY or YYYY-MM-DD"
                    className="font-mono"
                    data-testid="input-pub-date"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Place</Label>
                  <Input
                    value={citationForm.publicationPlace || ""}
                    onChange={(e) =>
                      setCitationForm({
                        ...citationForm,
                        publicationPlace: e.target.value,
                      })
                    }
                    placeholder="City of publication"
                    className="font-mono"
                    data-testid="input-pub-place"
                  />
                </div>
                <div className="space-y-2">
                  <Label>URL (if any)</Label>
                  <Input
                    value={citationForm.url || ""}
                    onChange={(e) =>
                      setCitationForm({ ...citationForm, url: e.target.value })
                    }
                    placeholder="https://..."
                    className="font-mono"
                    data-testid="input-url"
                  />
                </div>
              </div>

              {(citationForm.sourceType === "journal" ||
                citationForm.sourceType === "chapter") && (
                <>
                  <div className="space-y-2">
                    <Label>
                      {citationForm.sourceType === "journal"
                        ? "Journal Name"
                        : "Book Title"}
                    </Label>
                    <Input
                      value={citationForm.containerTitle || ""}
                      onChange={(e) =>
                        setCitationForm({
                          ...citationForm,
                          containerTitle: e.target.value,
                        })
                      }
                      placeholder={
                        citationForm.sourceType === "journal"
                          ? "Journal name"
                          : "Book containing this chapter"
                      }
                      className="font-mono"
                      data-testid="input-container"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Volume</Label>
                      <Input
                        value={citationForm.volume || ""}
                        onChange={(e) =>
                          setCitationForm({
                            ...citationForm,
                            volume: e.target.value,
                          })
                        }
                        className="font-mono"
                        data-testid="input-volume"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Issue</Label>
                      <Input
                        value={citationForm.issue || ""}
                        onChange={(e) =>
                          setCitationForm({
                            ...citationForm,
                            issue: e.target.value,
                          })
                        }
                        className="font-mono"
                        data-testid="input-issue"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Pages</Label>
                      <Input
                        value={citationForm.pageStart || ""}
                        onChange={(e) =>
                          setCitationForm({
                            ...citationForm,
                            pageStart: e.target.value,
                          })
                        }
                        placeholder="1-20"
                        className="font-mono"
                        data-testid="input-pages"
                      />
                    </div>
                  </div>
                </>
              )}
            </TabsContent>
            <TabsContent value="preview" className="space-y-4 py-4">
              {citationPreview ? (
                <>
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      {citationStyle === "chicago" ? "Footnote" : "In-Text Citation"}
                    </Label>
                    <div className="p-3 bg-muted rounded-md text-sm font-mono">
                      {citationPreview.inlineCitation || citationPreview.footnote}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={async () => {
                        try {
                          await copyTextToClipboard(citationPreview.inlineCitation || citationPreview.footnote);
                          toast({ title: "Copied" });
                        } catch {
                          toast({
                            title: "Copy failed",
                            description: "Clipboard access is unavailable in this browser context",
                            variant: "destructive",
                          });
                        }
                      }}
                    >
                      <Copy className="h-3 w-3 mr-2" />
                      Copy
                    </Button>
                  </div>
                  <Separator />
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      {citationStyle === "mla" ? "Works Cited" : citationStyle === "apa" ? "Reference" : "Bibliography"}
                    </Label>
                    <div className="p-3 bg-muted rounded-md text-sm font-mono">
                      {citationPreview.bibliography}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={async () => {
                        try {
                          await copyTextToClipboard(citationPreview.bibliography);
                          toast({ title: "Copied" });
                        } catch {
                          toast({
                            title: "Copy failed",
                            description: "Clipboard access is unavailable in this browser context",
                            variant: "destructive",
                          });
                        }
                      }}
                    >
                      <Copy className="h-3 w-3 mr-2" />
                      Copy
                    </Button>
                  </div>
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  Save citation metadata to see preview
                </div>
              )}
            </TabsContent>
          </Tabs>
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" onClick={() => setIsCitationOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  const citation = await generateCitation.mutateAsync({
                    citationData: citationForm,
                    style: citationStyle,
                  });
                  const textToCopy = citation.inlineCitation || citation.footnote;
                  await copyTextToClipboard(textToCopy);
                  toast({
                    title: "Copied",
                    description: `${citationStyle === "chicago" ? "Footnote" : "In-text citation"} copied to clipboard`,
                  });
                } catch {
                  toast({
                    title: "Error",
                    description: "Failed to generate citation",
                    variant: "destructive",
                  });
                }
              }}
              disabled={generateCitation.isPending}
              data-testid="button-copy-citation"
            >
              <Copy className="h-3 w-3 mr-2" />
              {citationStyle === "chicago" ? "Copy Footnote" : "Copy In-Text"}
            </Button>
            <Button
              onClick={handleSaveCitation}
              disabled={updateProjectDoc.isPending}
              data-testid="button-save-citation"
            >
              Save Citation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
