import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useProjects, useProjectDocuments } from "@/hooks/useProjects";
import { useWebClips } from "@/hooks/useWebClips";
import { markdownComponents, remarkPlugins } from "@/lib/markdownConfig";
import {
  useProjectConversations,
  useStandaloneConversations,
  useWritingConversation,
  useCreateWritingConversation,
  useDeleteWritingConversation,
  useUpdateWritingConversation,
  useUpdateSources,
  useWritingSendMessage,
  useCompilePaper,
  useVerifyPaper,
} from "@/hooks/useWritingChat";
import { useHumanizeText } from "@/hooks/useHumanizer";
import { useWritingPipeline, type WritingRequest } from "@/hooks/useWriting";
import {
  stripMarkdown,
  buildDocxBlob,
  buildPdfBlob,
  downloadBlob,
  toSafeFilename,
  getDocTypeLabel,
} from "@/lib/documentExport";
import { ChatMessages } from "@/components/chat/ChatMessages";
import { ChatInput } from "@/components/chat/ChatInput";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { DocumentPanel } from "@/components/chat/DocumentPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileText,
  Lightbulb,
  Loader2,
  PenLine,
  PenTool,
  ShieldCheck,
  Sparkles,
  StopCircle,
  Zap,
} from "lucide-react";

interface WritingChatProps {
  initialProjectId?: string;
  lockProject?: boolean;
}

const NO_PROJECT_VALUE = "__no_project__";

const WRITING_PROMPTS = [
  {
    icon: PenLine,
    label: "Write the introduction",
    prompt: "Write an introduction paragraph for my paper. Include a thesis statement based on the sources.",
  },
  {
    icon: BookOpen,
    label: "Draft a thesis statement",
    prompt: "Help me craft a strong thesis statement for my paper based on the available source materials.",
  },
  {
    icon: FileText,
    label: "Write a section",
    prompt: "Write a section analyzing the key arguments from the sources. Include proper citations.",
  },
  {
    icon: Lightbulb,
    label: "Write the conclusion",
    prompt: "Write a conclusion that ties together the main arguments of my paper.",
  },
];

export default function WritingChat({ initialProjectId, lockProject }: WritingChatProps) {
  const { toast } = useToast();

  // Project selection
  const { data: projects = [] } = useProjects();
  const [selectedProjectId, setSelectedProjectId] = useState(
    initialProjectId || (lockProject ? "" : NO_PROJECT_VALUE)
  );
  const hasSelectedProject = Boolean(selectedProjectId && selectedProjectId !== NO_PROJECT_VALUE);

  // If project is locked and no initial project is available yet, select the first loaded project.
  useEffect(() => {
    if (lockProject && !selectedProjectId && projects.length > 0) {
      setSelectedProjectId(initialProjectId || projects[0].id);
    }
  }, [initialProjectId, lockProject, projects, selectedProjectId]);

  const selectedProject = useMemo(
    () => (hasSelectedProject ? projects.find((p) => p.id === selectedProjectId) : undefined),
    [hasSelectedProject, projects, selectedProjectId]
  );

  // Conversation management
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const { data: projectConversations = [] } = useProjectConversations(
    hasSelectedProject ? selectedProjectId : undefined
  );
  const { data: standaloneConversations = [] } = useStandaloneConversations(!hasSelectedProject);
  const conversations = hasSelectedProject ? projectConversations : standaloneConversations;
  const { data: conversationData } = useWritingConversation(activeConversationId);
  const createConversation = useCreateWritingConversation();
  const deleteConversation = useDeleteWritingConversation();
  const updateConversation = useUpdateWritingConversation();
  const updateSources = useUpdateSources();

  const messages = conversationData?.messages || [];
  const {
    send,
    streamingText,
    streamingChatText,
    documentTitle,
    streamingDocumentText,
    isDocumentStreaming,
    isStreaming,
    contextLoading,
    contextWarning,
  } = useWritingSendMessage(activeConversationId);

  // Source management
  const { data: projectSources = [], isLoading: projectSourcesLoading } = useProjectDocuments(
    hasSelectedProject ? selectedProjectId : ""
  );
  const { data: standaloneWebClips = [], isLoading: webClipsLoading } = useWebClips({}, !hasSelectedProject);
  const sourcesLoading = hasSelectedProject ? projectSourcesLoading : webClipsLoading;
  const sourceIds = hasSelectedProject
    ? projectSources.map((source) => source.id)
    : standaloneWebClips.map((clip) => clip.id);
  const [localSelectedSourceIds, setLocalSelectedSourceIds] = useState<string[]>([]);
  const [sourcesExpanded, setSourcesExpanded] = useState(true);
  const autoSelectedRef = useRef<Set<string>>(new Set());

  // Sync source selection from conversation
  useEffect(() => {
    if (conversationData?.selectedSourceIds) {
      setLocalSelectedSourceIds(conversationData.selectedSourceIds);
    } else if (
      hasSelectedProject &&
      projectSources.length > 0 &&
      !autoSelectedRef.current.has(selectedProjectId)
    ) {
      autoSelectedRef.current.add(selectedProjectId);
      const allIds = projectSources.map((s) => s.id);
      setLocalSelectedSourceIds(allIds);
    } else if (!hasSelectedProject) {
      setLocalSelectedSourceIds([]);
    }
  }, [conversationData, hasSelectedProject, projectSources, selectedProjectId]);

  // Writing settings
  const [citationStyle, setCitationStyle] = useState(conversationData?.citationStyle || "chicago");
  const [tone, setTone] = useState(conversationData?.tone || "academic");
  const [writingModel, setWritingModel] = useState<"precision" | "extended">(
    conversationData?.writingModel === "extended" ? "extended" : "precision"
  );
  const [humanize, setHumanize] = useState(conversationData?.humanize ?? true);
  const [noEnDashes, setNoEnDashes] = useState(conversationData?.noEnDashes || false);

  // Document history / panel
  const [documents, setDocuments] = useState<Array<{ title: string; content: string }>>([]);
  const [selectedDocIndex, setSelectedDocIndex] = useState<number | null>(null);
  const lastCompletedDocumentKeyRef = useRef("");

  // Sync settings from conversation
  useEffect(() => {
    if (conversationData) {
      if (conversationData.citationStyle) setCitationStyle(conversationData.citationStyle);
      if (conversationData.tone) setTone(conversationData.tone);
      setWritingModel(conversationData.writingModel === "extended" ? "extended" : "precision");
      if (conversationData.humanize !== undefined && conversationData.humanize !== null) {
        setHumanize(conversationData.humanize);
      }
      if (conversationData.noEnDashes !== undefined && conversationData.noEnDashes !== null) {
        setNoEnDashes(conversationData.noEnDashes);
      }
    }
  }, [conversationData]);

  useEffect(() => {
    if (!contextWarning) return;
    toast({
      title: "Context Warning",
      description: contextWarning.message,
      variant: "destructive",
    });
  }, [contextWarning, toast]);

  useEffect(() => {
    // Reset document panel state when switching conversations.
    setDocuments([]);
    setSelectedDocIndex(null);
    lastCompletedDocumentKeyRef.current = "";
  }, [activeConversationId]);

  useEffect(() => {
    if (isDocumentStreaming || !streamingDocumentText.trim()) {
      return;
    }

    const key = `${documentTitle}\n${streamingDocumentText}`;
    if (key === lastCompletedDocumentKeyRef.current) {
      return;
    }

    lastCompletedDocumentKeyRef.current = key;
    setDocuments((prev) => {
      const next = [...prev, { title: documentTitle || "Draft", content: streamingDocumentText }];
      setSelectedDocIndex(next.length - 1);
      return next;
    });
  }, [documentTitle, isDocumentStreaming, streamingDocumentText]);

  // Compile & Verify
  const { compile, cancelCompile, clearCompiled, compiledContent, isCompiling } = useCompilePaper(activeConversationId);
  const { verify, verifyReport, isVerifying } = useVerifyPaper(activeConversationId);
  const humanizeText = useHumanizeText();
  const [humanizedCompiledContent, setHumanizedCompiledContent] = useState<string | null>(null);

  // PDF preview
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [isPreparingPdf, setIsPreparingPdf] = useState(false);
  const [isPreparingDocx, setIsPreparingDocx] = useState(false);
  const [showControlsWhenDocument, setShowControlsWhenDocument] = useState(true);

  // Quick Generate dialog
  const [quickGenerateOpen, setQuickGenerateOpen] = useState(false);
  const [quickTopic, setQuickTopic] = useState("");
  const [quickTargetLength, setQuickTargetLength] = useState<"short" | "medium" | "long">("medium");
  const [quickDeepWrite, setQuickDeepWrite] = useState(false);
  const quickGenerate = useWritingPipeline();

  // Computed
  const effectiveCompiledContent = humanizedCompiledContent ?? compiledContent;
  const plainText = useMemo(
    () => (effectiveCompiledContent ? stripMarkdown(effectiveCompiledContent) : ""),
    [effectiveCompiledContent]
  );
  const wordCount = useMemo(() => (plainText ? plainText.split(/\s+/).filter(Boolean).length : 0), [plainText]);
  const pageEstimate = useMemo(() => (wordCount > 0 ? Math.max(1, Math.round(wordCount / 500)) : 0), [wordCount]);
  const conversationProjectId = hasSelectedProject ? selectedProjectId : null;

  useEffect(() => {
    setHumanizedCompiledContent(null);
  }, [compiledContent]);

  useEffect(() => {
    return () => {
      if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
    };
  }, [pdfPreviewUrl]);

  // --- Handlers ---

  const handleNewChat = useCallback(async () => {
    try {
      const conv = await createConversation.mutateAsync({
        projectId: conversationProjectId,
        selectedSourceIds: localSelectedSourceIds,
        writingModel,
        citationStyle,
        tone,
        humanize,
        noEnDashes,
      });
      await updateConversation.mutateAsync({
        id: conv.id,
        data: { citationStyle, tone, writingModel, humanize, noEnDashes },
      });
      setActiveConversationId(conv.id);
      clearCompiled();
    } catch {
      toast({ title: "Error", description: "Failed to create conversation", variant: "destructive" });
    }
  }, [conversationProjectId, localSelectedSourceIds, citationStyle, tone, writingModel, humanize, noEnDashes, createConversation, updateConversation, clearCompiled, toast]);

  const handleSelectConversation = useCallback((id: string) => {
    setActiveConversationId(id);
    clearCompiled();
  }, [clearCompiled]);

  const handleDeleteConversation = useCallback(async (id: string) => {
    try {
      await deleteConversation.mutateAsync(id);
      if (activeConversationId === id) {
        setActiveConversationId(null);
        clearCompiled();
      }
    } catch {
      toast({ title: "Error", description: "Failed to delete conversation", variant: "destructive" });
    }
  }, [deleteConversation, activeConversationId, clearCompiled, toast]);

  const handleRenameConversation = useCallback(async (id: string, newTitle: string) => {
    try {
      await updateConversation.mutateAsync({ id, data: { title: newTitle } });
    } catch {
      toast({ title: "Error", description: "Failed to rename", variant: "destructive" });
    }
  }, [updateConversation, toast]);

  const handleSend = useCallback(async (content: string) => {
    if (!activeConversationId) {
      // Create a new conversation first
      try {
        const conv = await createConversation.mutateAsync({
          projectId: conversationProjectId,
          selectedSourceIds: localSelectedSourceIds,
          writingModel,
          citationStyle,
          tone,
          humanize,
          noEnDashes,
        });
        setActiveConversationId(conv.id);

        // Save settings
        await updateConversation.mutateAsync({
          id: conv.id,
          data: { citationStyle, tone, writingModel, humanize, noEnDashes },
        });

        // Send first message directly
        setTimeout(async () => {
          const response = await apiRequest("POST", `/api/chat/conversations/${conv.id}/messages`, { content });
          if (response.body) {
            const reader = response.body.getReader();
            while (true) {
              const { done } = await reader.read();
              if (done) break;
            }
          }
          queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations", conv.id] });
          queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
        }, 100);
      } catch {
        toast({ title: "Error", description: "Failed to start conversation", variant: "destructive" });
      }
      return;
    }

    await send(content);
  }, [activeConversationId, conversationProjectId, localSelectedSourceIds, citationStyle, tone, writingModel, humanize, noEnDashes, send, createConversation, updateConversation, toast]);

  const toggleSource = useCallback((id: string) => {
    setLocalSelectedSourceIds((prev) => {
      const next = prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id];
      // Persist to server
      if (activeConversationId) {
        updateSources.mutate({ conversationId: activeConversationId, selectedSourceIds: next });
      }
      return next;
    });
  }, [activeConversationId, updateSources]);

  const toggleAllSources = useCallback(() => {
    const allIds = sourceIds;
    const next = localSelectedSourceIds.length === allIds.length ? [] : allIds;
    setLocalSelectedSourceIds(next);
    if (activeConversationId) {
      updateSources.mutate({ conversationId: activeConversationId, selectedSourceIds: next });
    }
  }, [sourceIds, localSelectedSourceIds, activeConversationId, updateSources]);

  const handleSettingChange = useCallback((key: string, value: any) => {
    if (key === "citationStyle") setCitationStyle(value);
    if (key === "tone") setTone(value);
    if (key === "writingModel") setWritingModel(value);
    if (key === "humanize") setHumanize(value);
    if (key === "noEnDashes") setNoEnDashes(value);

    if (activeConversationId) {
      updateConversation.mutate({ id: activeConversationId, data: { [key]: value } });
    }
  }, [activeConversationId, updateConversation]);

  const handleCompile = useCallback(() => {
    compile({ citationStyle, tone, noEnDashes });
  }, [compile, citationStyle, tone, noEnDashes]);

  const handleVerify = useCallback(() => {
    if (effectiveCompiledContent) verify(effectiveCompiledContent);
  }, [verify, effectiveCompiledContent]);

  const handleCopy = useCallback(async () => {
    if (!effectiveCompiledContent) return;
    try {
      await navigator.clipboard.writeText(effectiveCompiledContent);
      toast({ title: "Copied to clipboard" });
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  }, [effectiveCompiledContent, toast]);

  const handleDownloadDocx = useCallback(async () => {
    if (!effectiveCompiledContent) return;
    setIsPreparingDocx(true);
    try {
      const blob = await buildDocxBlob(conversationData?.title || "Paper", effectiveCompiledContent);
      downloadBlob(blob, `${toSafeFilename(conversationData?.title || "Paper")}.docx`);
    } catch (e) {
      toast({ title: "Export failed", description: e instanceof Error ? e.message : "DOCX export failed", variant: "destructive" });
    } finally {
      setIsPreparingDocx(false);
    }
  }, [effectiveCompiledContent, conversationData, toast]);

  const handleDownloadPdf = useCallback(async () => {
    if (!effectiveCompiledContent) return;
    setIsPreparingPdf(true);
    try {
      const blob = await buildPdfBlob(conversationData?.title || "Paper", effectiveCompiledContent);
      downloadBlob(blob, `${toSafeFilename(conversationData?.title || "Paper")}.pdf`);
    } catch (e) {
      toast({ title: "Export failed", description: e instanceof Error ? e.message : "PDF export failed", variant: "destructive" });
    } finally {
      setIsPreparingPdf(false);
    }
  }, [effectiveCompiledContent, conversationData, toast]);

  const handleTogglePdfPreview = useCallback(async () => {
    if (!effectiveCompiledContent) return;
    if (showPdfPreview) {
      setShowPdfPreview(false);
      if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
      setPdfPreviewUrl(null);
      return;
    }
    setIsPreparingPdf(true);
    try {
      const blob = await buildPdfBlob(conversationData?.title || "Paper", effectiveCompiledContent);
      if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
      setPdfPreviewUrl(URL.createObjectURL(blob));
      setShowPdfPreview(true);
    } catch (e) {
      toast({ title: "Preview failed", variant: "destructive" });
    } finally {
      setIsPreparingPdf(false);
    }
  }, [effectiveCompiledContent, showPdfPreview, pdfPreviewUrl, conversationData, toast]);

  const handleHumanize = useCallback(async () => {
    if (!effectiveCompiledContent) return;
    try {
      const result = await humanizeText.mutateAsync({ text: effectiveCompiledContent });
      setHumanizedCompiledContent(result.humanizedText);
      toast({
        title: "Humanized",
        description: `Rewritten with ${result.provider} (${result.model})`,
      });
    } catch (error) {
      toast({
        title: "Humanize failed",
        description: error instanceof Error ? error.message : "Failed to humanize text",
        variant: "destructive",
      });
    }
  }, [effectiveCompiledContent, humanizeText, toast]);

  const handleRevertHumanized = useCallback(() => {
    setHumanizedCompiledContent(null);
    toast({ title: "Reverted", description: "Showing original compiled paper" });
  }, [toast]);

  const handleQuickGenerate = useCallback(() => {
    if (!hasSelectedProject || !quickTopic.trim() || localSelectedSourceIds.length === 0) {
      toast({ title: "Fill in all fields", variant: "destructive" });
      return;
    }
    const request: WritingRequest = {
      topic: quickTopic.trim(),
      annotationIds: [],
      sourceDocumentIds: localSelectedSourceIds,
      projectId: selectedProjectId,
      citationStyle: citationStyle as "mla" | "apa" | "chicago",
      tone: tone as "academic" | "casual" | "ap_style",
      targetLength: quickTargetLength,
      noEnDashes,
      deepWrite: quickDeepWrite,
    };
    quickGenerate.generate(request);
    setQuickGenerateOpen(false);
  }, [hasSelectedProject, selectedProjectId, quickTopic, localSelectedSourceIds, citationStyle, tone, quickTargetLength, noEnDashes, quickDeepWrite, quickGenerate, toast]);

  // Custom suggested prompts for writing context
  const handleSuggestedPrompt = useCallback((prompt: string) => {
    handleSend(prompt);
  }, [handleSend]);

  const handleSelectDocument = useCallback((document: { title: string; content: string }) => {
    setDocuments((prev) => {
      const existingIndex = prev.findIndex(
        (item) => item.title === document.title && item.content === document.content
      );
      if (existingIndex >= 0) {
        setSelectedDocIndex(existingIndex);
        return prev;
      }

      const next = [...prev, document];
      setSelectedDocIndex(next.length - 1);
      return next;
    });
  }, []);

  const activeDocument = useMemo(() => {
    if (isDocumentStreaming) {
      return {
        title: documentTitle || "Draft",
        content: streamingDocumentText || "",
        isStreaming: true,
      };
    }

    if (selectedDocIndex === null || !documents[selectedDocIndex]) {
      return null;
    }

    return {
      title: documents[selectedDocIndex].title,
      content: documents[selectedDocIndex].content,
      isStreaming: false,
    };
  }, [documentTitle, documents, isDocumentStreaming, selectedDocIndex, streamingDocumentText]);

  const handleCopyActiveDocument = useCallback(async () => {
    if (!activeDocument?.content) return;
    try {
      await navigator.clipboard.writeText(activeDocument.content);
      toast({ title: "Copied to clipboard" });
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  }, [activeDocument, toast]);

  const handleDownloadActiveDocumentDocx = useCallback(async () => {
    if (!activeDocument?.content) return;
    setIsPreparingDocx(true);
    try {
      const blob = await buildDocxBlob(activeDocument.title || "Document", activeDocument.content);
      downloadBlob(blob, `${toSafeFilename(activeDocument.title || "Document")}.docx`);
    } catch (e) {
      toast({
        title: "Export failed",
        description: e instanceof Error ? e.message : "DOCX export failed",
        variant: "destructive",
      });
    } finally {
      setIsPreparingDocx(false);
    }
  }, [activeDocument, toast]);

  const handleDownloadActiveDocumentPdf = useCallback(async () => {
    if (!activeDocument?.content) return;
    setIsPreparingPdf(true);
    try {
      const blob = await buildPdfBlob(activeDocument.title || "Document", activeDocument.content);
      downloadBlob(blob, `${toSafeFilename(activeDocument.title || "Document")}.pdf`);
    } catch (e) {
      toast({
        title: "Export failed",
        description: e instanceof Error ? e.message : "PDF export failed",
        variant: "destructive",
      });
    } finally {
      setIsPreparingPdf(false);
    }
  }, [activeDocument, toast]);

  return (
    <div className="h-full min-h-0 grid grid-cols-1 lg:grid-cols-[250px_1fr_380px] border border-border rounded-xl overflow-hidden bg-[#F5F0E8] dark:bg-background">
      {/* Left Sidebar - Conversations */}
      <ChatSidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelect={handleSelectConversation}
        onNew={handleNewChat}
        onDelete={handleDeleteConversation}
        onRename={handleRenameConversation}
      />

      {/* Center - Chat */}
      <section className="min-h-0 flex flex-col bg-[#FAF7F1] dark:bg-background border-l border-r border-border">
        {/* Project header */}
        <div className="border-b border-border px-5 py-3 bg-background/80 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <PenTool className="h-4 w-4 text-primary" />
              {lockProject ? (
                <span className="font-semibold">
                  {hasSelectedProject ? selectedProject?.name || "Project" : "General Writing"}
                </span>
              ) : (
                <Select
                  value={selectedProjectId}
                  onValueChange={(v) => {
                    setSelectedProjectId(v);
                    setActiveConversationId(null);
                    setLocalSelectedSourceIds([]);
                    clearCompiled();
                  }}
                >
                  <SelectTrigger className="w-auto border-0 shadow-none p-0 h-auto font-semibold">
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PROJECT_VALUE}>No Project (General Writing)</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {effectiveCompiledContent && (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono text-[10px] uppercase">{wordCount} words</Badge>
                <Badge variant="outline" className="font-mono text-[10px] uppercase">{pageEstimate} pg</Badge>
                {humanizedCompiledContent && (
                  <Badge variant="secondary" className="font-mono text-[10px] uppercase">Humanized</Badge>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Messages */}
        <ChatMessages
          messages={messages}
          streamingText={streamingText}
          streamingChatText={streamingChatText}
          streamingDocumentTitle={documentTitle}
          streamingDocumentText={streamingDocumentText}
          isDocumentStreaming={isDocumentStreaming}
          isStreaming={isStreaming}
          onDocumentSelect={handleSelectDocument}
          onSuggestedPrompt={handleSuggestedPrompt}
        />

        {/* Input */}
        {contextLoading && (
          <div className="border-t border-border px-5 py-2 text-xs text-muted-foreground bg-background/60">
            Loading source context (Level {contextLoading.level})...
          </div>
        )}
        <ChatInput onSend={handleSend} disabled={isStreaming} />
      </section>

      {/* Right Panel */}
      <aside className="min-h-0 bg-[#F1ECE2] dark:bg-muted/10">
        <div className="h-full min-h-0 flex flex-col p-4 gap-4">
          {activeDocument && (
            <div className="min-h-0 flex-[1_1_55%]">
              <DocumentPanel
                title={activeDocument.title}
                content={activeDocument.content}
                isStreaming={activeDocument.isStreaming}
                isPreparingDocx={isPreparingDocx}
                isPreparingPdf={isPreparingPdf}
                onCopy={handleCopyActiveDocument}
                onDownloadDocx={handleDownloadActiveDocumentDocx}
                onDownloadPdf={handleDownloadActiveDocumentPdf}
                onClose={() => setSelectedDocIndex(null)}
              />
            </div>
          )}

          {activeDocument && (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={() => setShowControlsWhenDocument((v) => !v)}
            >
              {showControlsWhenDocument ? "Hide Controls" : "Show Controls"}
            </Button>
          )}

          {(!activeDocument || showControlsWhenDocument) && (
            <div className={`${activeDocument ? "min-h-0 flex-[1_1_45%]" : "h-full"} overflow-auto space-y-4`}>
          {/* Settings Card */}
          <Card className="border-border bg-background/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Select value={writingModel} onValueChange={(v) => handleSettingChange("writingModel", v)}>
                <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="precision">Precision (Opus)</SelectItem>
                  <SelectItem value="extended">Extended (Sonnet)</SelectItem>
                </SelectContent>
              </Select>
              <div className="grid grid-cols-2 gap-2">
                <Select value={tone} onValueChange={(v) => handleSettingChange("tone", v)}>
                  <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="academic">Academic</SelectItem>
                    <SelectItem value="casual">Casual</SelectItem>
                    <SelectItem value="ap_style">AP Style</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={citationStyle} onValueChange={(v) => handleSettingChange("citationStyle", v)}>
                  <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="chicago">Chicago</SelectItem>
                    <SelectItem value="mla">MLA</SelectItem>
                    <SelectItem value="apa">APA</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <Checkbox checked={humanize} onCheckedChange={(v) => handleSettingChange("humanize", Boolean(v))} />
                Humanize prose
              </label>
              <label className="flex items-center gap-2 text-xs">
                <Checkbox checked={noEnDashes} onCheckedChange={(v) => handleSettingChange("noEnDashes", Boolean(v))} />
                No en-dashes
              </label>
            </CardContent>
          </Card>

          {/* Sources Card */}
          <Card className="border-border bg-background/80">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  {hasSelectedProject ? "Project Sources" : "Web Clips"}
                </CardTitle>
                <button type="button" className="text-xs text-muted-foreground" onClick={() => setSourcesExpanded((v) => !v)}>
                  {sourcesExpanded ? "Hide" : "Show"}
                </button>
              </div>
            </CardHeader>
            <CardContent>
              {sourcesExpanded && (
                <>
                  <div className="flex justify-end mb-2">
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={toggleAllSources} disabled={sourceIds.length === 0}>
                      {localSelectedSourceIds.length === sourceIds.length ? "Deselect all" : "Select all"}
                    </Button>
                  </div>
                  <ScrollArea className="h-48">
                    {sourcesLoading ? (
                      <p className="text-xs text-muted-foreground">Loading...</p>
                    ) : hasSelectedProject && projectSources.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No source documents in this project.</p>
                    ) : !hasSelectedProject && standaloneWebClips.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No web clips yet. You can still write in standalone mode without sources.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {hasSelectedProject
                          ? projectSources.map((source) => (
                            <label key={source.id} className="flex gap-2 rounded-md p-2 hover:bg-muted/40 cursor-pointer">
                              <Checkbox checked={localSelectedSourceIds.includes(source.id)} onCheckedChange={() => toggleSource(source.id)} className="mt-0.5" />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-medium truncate">{source.document.filename}</span>
                                  <Badge variant="outline" className="text-[10px]">{getDocTypeLabel(source.document.filename)}</Badge>
                                </div>
                                <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                                  {source.document.summary || "No summary available."}
                                </p>
                              </div>
                            </label>
                          ))
                          : standaloneWebClips.map((clip) => (
                            <label key={clip.id} className="flex gap-2 rounded-md p-2 hover:bg-muted/40 cursor-pointer">
                              <Checkbox checked={localSelectedSourceIds.includes(clip.id)} onCheckedChange={() => toggleSource(clip.id)} className="mt-0.5" />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-medium truncate">{clip.pageTitle}</span>
                                  <Badge variant="outline" className="text-[10px]">WEB</Badge>
                                </div>
                                <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                                  {clip.note || clip.highlightedText || clip.sourceUrl}
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

          {/* Actions Card */}
          <Card className="border-border bg-background/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {/* Compile */}
              {!isCompiling ? (
                <Button onClick={handleCompile} className="w-full" disabled={messages.length === 0}>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Compile Paper
                </Button>
              ) : (
                <Button variant="destructive" onClick={cancelCompile} className="w-full">
                  <StopCircle className="h-4 w-4 mr-2" />
                  Stop Compiling
                </Button>
              )}

              {/* Verify */}
              <Button variant="outline" onClick={handleVerify} className="w-full" disabled={!effectiveCompiledContent || isVerifying}>
                {isVerifying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
                {isVerifying ? "Verifying..." : "Verify Paper"}
              </Button>

              <Button
                variant="outline"
                onClick={handleHumanize}
                className="w-full"
                disabled={!effectiveCompiledContent || humanizeText.isPending}
              >
                {humanizeText.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                {humanizedCompiledContent ? "Re-humanize Paper" : "Humanize Compiled Paper"}
              </Button>

              {humanizedCompiledContent && (
                <Button variant="ghost" onClick={handleRevertHumanized} className="w-full">
                  Revert to Original
                </Button>
              )}

              {/* Quick Generate */}
              <Dialog open={quickGenerateOpen} onOpenChange={setQuickGenerateOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full text-xs"
                    disabled={!hasSelectedProject}
                    title={!hasSelectedProject ? "Select a project to use Quick Generate" : undefined}
                  >
                    <Zap className="h-4 w-4 mr-2" />
                    Quick Generate (Full Paper)
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Quick Generate Paper</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Topic / Prompt</Label>
                      <Textarea
                        value={quickTopic}
                        onChange={(e) => setQuickTopic(e.target.value)}
                        placeholder="Enter your topic..."
                        className="min-h-[80px]"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Select value={quickTargetLength} onValueChange={(v) => setQuickTargetLength(v as any)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="short">Short (~1500w)</SelectItem>
                          <SelectItem value="medium">Medium (~2500w)</SelectItem>
                          <SelectItem value="long">Long (~4000w)</SelectItem>
                        </SelectContent>
                      </Select>
                      <label className="flex items-center gap-2 text-xs px-2">
                        <Checkbox checked={quickDeepWrite} onCheckedChange={(v) => setQuickDeepWrite(Boolean(v))} />
                        Deep Write
                      </label>
                    </div>
                    <Button onClick={handleQuickGenerate} className="w-full" disabled={quickGenerate.isGenerating}>
                      {quickGenerate.isGenerating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
                      Generate
                    </Button>
                    {quickGenerate.isGenerating && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">{quickGenerate.status}</p>
                        <Progress value={quickGenerate.plan ? Math.round((quickGenerate.sections.length / Math.max(1, quickGenerate.plan.sections.length)) * 80) + 10 : 5} className="h-1.5" />
                      </div>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>

          {/* Compiled Paper Card */}
          {(effectiveCompiledContent || isCompiling) && (
            <Card className="border-border bg-background/80">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    {isCompiling ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4 text-green-600" />}
                    Compiled Paper
                  </CardTitle>
                  {effectiveCompiledContent && (
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={handleCopy}><Copy className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="sm" onClick={handleDownloadDocx} disabled={isPreparingDocx}>
                        {isPreparingDocx ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={handleDownloadPdf} disabled={isPreparingPdf}>
                        {isPreparingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={handleTogglePdfPreview} disabled={isPreparingPdf}>
                        {showPdfPreview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-64">
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
                      {effectiveCompiledContent}
                    </ReactMarkdown>
                    {isCompiling && <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1" />}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {/* PDF Preview */}
          {showPdfPreview && pdfPreviewUrl && (
            <Card className="border-border bg-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">PDF Preview</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[320px] overflow-hidden rounded border">
                  <iframe src={pdfPreviewUrl} title="PDF Preview" className="w-full h-full" />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Verify Report */}
          {(verifyReport || isVerifying) && (
            <Card className="border-border bg-background/80">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  {isVerifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4 text-blue-600" />}
                  Verification Report
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-48">
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
                      {verifyReport}
                    </ReactMarkdown>
                    {isVerifying && <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1" />}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {/* Quick Generate Result (shown in right panel too) */}
          {quickGenerate.fullText && (
            <Card className="border-border bg-background/80">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Quick Generate Result</CardTitle>
                  <Button variant="ghost" size="sm" onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(quickGenerate.fullText);
                      toast({ title: "Copied" });
                    } catch { /* ignore */ }
                  }}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-48">
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
                      {quickGenerate.fullText}
                    </ReactMarkdown>
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
