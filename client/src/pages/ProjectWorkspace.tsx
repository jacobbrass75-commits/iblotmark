import { useState, useMemo, useRef } from "react";
import { Link, useRoute, useLocation } from "wouter";
import { useProject, useFolders, useProjectDocuments, useCreateFolder, useDeleteFolder, useAddDocumentToProject, useRemoveDocumentFromProject } from "@/hooks/useProjects";
import { useGlobalSearch, useGenerateCitation } from "@/hooks/useProjectSearch";
import { useUploadDocument, useUploadDocumentGroup } from "@/hooks/useDocument";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, FolderPlus, FileText, Search, Plus, ChevronRight, ChevronDown, Folder, Trash2, Copy, BookOpen, ExternalLink, Sparkles, FolderUp, Upload, Quote, PenTool } from "lucide-react";
import { BatchAnalysisModal } from "@/components/BatchAnalysisModal";
import { BatchUploadModal } from "@/components/BatchUploadModal";
import { ThemeToggle } from "@/components/ThemeToggle";
import WritingChat from "@/components/WritingChat";
import { useToast } from "@/hooks/use-toast";
import { copyTextToClipboard } from "@/lib/clipboard";
import type { Folder as FolderType, GlobalSearchResult, Document } from "@shared/schema";

type DocumentLibraryItem = Pick<Document, "id" | "filename" | "uploadDate" | "summary" | "chunkCount" | "status" | "processingError">;

function FolderTree({ 
  folders, 
  selectedFolderId, 
  onSelectFolder, 
  onDeleteFolder,
  level = 0 
}: { 
  folders: FolderType[];
  selectedFolderId: string | null;
  onSelectFolder: (id: string | null) => void;
  onDeleteFolder: (id: string) => void;
  level?: number;
}) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const rootFolders = folders.filter(f => !f.parentFolderId);
  
  const getChildFolders = (parentId: string) => folders.filter(f => f.parentFolderId === parentId);
  
  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedFolders(newExpanded);
  };

  const renderFolder = (folder: FolderType, depth: number) => {
    const children = getChildFolders(folder.id);
    const hasChildren = children.length > 0;
    const isExpanded = expandedFolders.has(folder.id);
    const isSelected = selectedFolderId === folder.id;

    return (
      <div key={folder.id}>
        <div
          className={`flex items-center gap-1 px-2 py-1.5 rounded-md cursor-pointer group ${
            isSelected ? "text-primary bg-primary/10 border-l-2 border-primary" : "hover-elevate"
          }`}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          onClick={() => onSelectFolder(folder.id)}
          data-testid={`folder-${folder.id}`}
        >
          {hasChildren ? (
            <button onClick={(e) => toggleExpand(folder.id, e)} className="p-0.5">
              {isExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </button>
          ) : (
            <span className="w-4" />
          )}
          <Folder className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono text-xs uppercase tracking-wider flex-1 truncate">{folder.name}</span>
          <button
            className="opacity-0 group-hover:opacity-100 p-1 hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteFolder(folder.id);
            }}
            data-testid={`button-delete-folder-${folder.id}`}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
        {isExpanded && hasChildren && (
          <div>
            {children.map(child => renderFolder(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-0.5">
      <div
        className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer ${
          selectedFolderId === null ? "text-primary bg-primary/10 border-l-2 border-primary" : "hover-elevate"
        }`}
        onClick={() => onSelectFolder(null)}
        data-testid="folder-root"
      >
        <Folder className="h-4 w-4 text-muted-foreground" />
        <span className="font-mono text-xs uppercase tracking-wider">All Documents</span>
      </div>
      {rootFolders.map(folder => renderFolder(folder, 0))}
    </div>
  );
}

function SearchResultCard({
  result,
  onGenerateCitation,
  onCopyQuote,
  onCopyFootnote,
  onNavigateToDocument,
  isGeneratingCitation,
  isGeneratingFootnote,
}: {
  result: GlobalSearchResult;
  onGenerateCitation: () => void;
  onCopyQuote: () => void;
  onCopyFootnote: () => void;
  onNavigateToDocument: () => void;
  isGeneratingCitation?: boolean;
  isGeneratingFootnote?: boolean;
}) {
  const categoryColors: Record<string, string> = {
    key_quote: "bg-[#FF6A00]/20 text-[#FF6A00] border border-[#FF6A00]/30",
    evidence: "bg-[#00FF41]/15 text-[#00FF41] border border-[#00FF41]/30",
    argument: "bg-[#00D4FF]/15 text-[#00D4FF] border border-[#00D4FF]/30",
    methodology: "bg-[#8B5CF6]/20 text-[#8B5CF6] border border-[#8B5CF6]/30",
    user_added: "bg-[#CC0000]/15 text-[#CC0000] border border-[#CC0000]/30",
    document_context: "bg-gray-500/20 text-gray-700 dark:text-gray-300",
  };
  const relevanceClasses: Record<string, string> = {
    high: "bg-chart-2/15 text-chart-2 border border-chart-2/30",
    medium: "bg-primary/15 text-primary border border-primary/30",
    low: "bg-muted text-muted-foreground border border-muted",
  };

  return (
    <Card 
      className="hover-elevate cursor-pointer eva-clip-sm" 
      data-testid={`search-result-${result.annotationId || result.documentId}`}
      onClick={onNavigateToDocument}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={categoryColors[result.category || result.type] || ""}>
              {result.category?.replace("_", " ") || result.type.replace("_", " ")}
            </Badge>
            <Badge variant="outline" className={relevanceClasses[result.relevanceLevel] || relevanceClasses.low}>
              {Math.round(result.similarityScore * 100)}% match
            </Badge>
          </div>
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" onClick={onCopyQuote} data-testid="button-copy-quote" title="Copy quote">
              <Copy className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onCopyFootnote}
              disabled={isGeneratingFootnote}
              data-testid="button-copy-footnote"
              title="Copy footnote with quote"
            >
              {isGeneratingFootnote ? (
                <div className="eva-hex-spinner" style={{ width: "1rem", height: "1rem" }} />
              ) : (
                <Quote className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onGenerateCitation}
              disabled={isGeneratingCitation}
              data-testid="button-generate-citation"
              title="Generate full citation"
            >
              {isGeneratingCitation ? (
                <div className="eva-hex-spinner" style={{ width: "1rem", height: "1rem" }} />
              ) : (
                <BookOpen className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
        
        {result.highlightedText && (
          <blockquote className="border-l-4 border-primary/50 pl-3 italic text-sm font-mono">
            "{result.highlightedText}"
          </blockquote>
        )}
        
        {result.note && (
          <p className="text-sm text-muted-foreground">{result.note}</p>
        )}
        
        {result.documentFilename && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileText className="h-3 w-3" />
            <span>{result.documentFilename}</span>
            {result.folderName && (
              <>
                <span>/</span>
                <Folder className="h-3 w-3" />
                <span>{result.folderName}</span>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function getFileExtension(filename: string): string {
  const extStart = filename.lastIndexOf(".");
  if (extStart < 0) return "";
  return filename.slice(extStart).toLowerCase();
}

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
  ".heic",
  ".heif",
]);

const COMBINABLE_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".heic", ".heif"]);
const MAX_COMBINED_UPLOAD_FILES_PER_DOC = 20;

function isPdfFile(file: File | null): boolean {
  if (!file) return false;
  return file.type === "application/pdf" || getFileExtension(file.name) === ".pdf";
}

function isImageFile(file: File | null): boolean {
  if (!file) return false;
  const extension = getFileExtension(file.name);
  return file.type.startsWith("image/") || IMAGE_EXTENSIONS.has(extension);
}

function isSupportedUploadFile(file: File): boolean {
  const extension = getFileExtension(file.name);
  const isPdf = isPdfFile(file);
  const isTxt = file.type === "text/plain" || extension === ".txt";
  const isImage = isImageFile(file);
  return isPdf || isTxt || isImage;
}

function isCombinableImageFile(file: File): boolean {
  const extension = getFileExtension(file.name);
  return isImageFile(file) && COMBINABLE_IMAGE_EXTENSIONS.has(extension);
}

function chunkFiles<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) return [items];
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

export default function ProjectWorkspace() {
  const [, params] = useRoute("/projects/:id");
  const [, setLocation] = useLocation();
  const projectId = params?.id || "";
  const { toast } = useToast();
  
  const { data: project, isLoading: projectLoading } = useProject(projectId);
  const { data: folders = [] } = useFolders(projectId);
  const { data: projectDocuments = [] } = useProjectDocuments(projectId);
  const { data: allDocuments = [] } = useQuery<DocumentLibraryItem[]>({
    queryKey: ["/api/documents/meta"],
  });
  
  const createFolder = useCreateFolder();
  const deleteFolder = useDeleteFolder();
  const addDocument = useAddDocumentToProject();
  const removeDocument = useRemoveDocumentFromProject();
  const globalSearch = useGlobalSearch();
  const generateCitation = useGenerateCitation();
  
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState<"documents" | "write">("documents");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GlobalSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isAddFolderOpen, setIsAddFolderOpen] = useState(false);
  const [isAddDocOpen, setIsAddDocOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [selectedDocId, setSelectedDocId] = useState("");
  const [citationModal, setCitationModal] = useState<{ footnote: string; bibliography: string } | null>(null);
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [isBatchUploadOpen, setIsBatchUploadOpen] = useState(false);
  const [generatingCitationFor, setGeneratingCitationFor] = useState<string | null>(null);
  const [generatingFootnoteFor, setGeneratingFootnoteFor] = useState<string | null>(null);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadOcrMode, setUploadOcrMode] = useState<string>("standard");
  const [uploadOcrModel, setUploadOcrModel] = useState<string>("gpt-4o");
  const [isUploadingAndAdding, setIsUploadingAndAdding] = useState(false);
  const [combineImageUploads, setCombineImageUploads] = useState(true);
  const [addDocTab, setAddDocTab] = useState<"library" | "upload">("library");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadDocument = useUploadDocument();
  const uploadDocumentGroup = useUploadDocumentGroup();
  
  const filteredDocuments = useMemo(() => {
    if (selectedFolderId === null) return projectDocuments;
    return projectDocuments.filter(pd => pd.folderId === selectedFolderId);
  }, [projectDocuments, selectedFolderId]);

  const availableDocuments = useMemo(() => {
    const addedDocIds = new Set(projectDocuments.map(pd => pd.documentId));
    return allDocuments.filter(doc => !addedDocIds.has(doc.id));
  }, [allDocuments, projectDocuments]);

  const hasPdfUploadFiles = uploadFiles.some((file) => isPdfFile(file));
  const hasImageUploadFiles = uploadFiles.some((file) => isImageFile(file));
  const shouldShowVisionModelSelector =
    hasImageUploadFiles || (hasPdfUploadFiles && (uploadOcrMode === "vision" || uploadOcrMode === "vision_batch"));
  const canCombineSelectedImages =
    uploadFiles.length > 1 && uploadFiles.every((file) => isCombinableImageFile(file));
  const combinedUploadChunks = canCombineSelectedImages
    ? chunkFiles(uploadFiles, MAX_COMBINED_UPLOAD_FILES_PER_DOC)
    : [];
  const exceedsSafeCombinedThreshold =
    canCombineSelectedImages && uploadFiles.length > MAX_COMBINED_UPLOAD_FILES_PER_DOC;

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    
    setIsSearching(true);
    try {
      const response = await globalSearch.mutateAsync({
        projectId,
        query: searchQuery,
        limit: 20,
      });
      setSearchResults(response.results);
      toast({
        title: "Search Complete",
        description: `Found ${response.totalResults} results in ${response.searchTime}ms`,
      });
    } catch (error) {
      toast({ title: "Error", description: "Search failed", variant: "destructive" });
    } finally {
      setIsSearching(false);
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    
    try {
      await createFolder.mutateAsync({
        projectId,
        data: {
          name: newFolderName,
          parentFolderId: selectedFolderId,
        },
      });
      setIsAddFolderOpen(false);
      setNewFolderName("");
      toast({ title: "Success", description: "Folder created" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to create folder", variant: "destructive" });
    }
  };

  const handleDeleteFolder = async (id: string) => {
    if (!confirm("Delete this folder? Documents inside will be moved to root.")) return;
    
    try {
      await deleteFolder.mutateAsync({ id, projectId });
      if (selectedFolderId === id) setSelectedFolderId(null);
      toast({ title: "Success", description: "Folder deleted" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete folder", variant: "destructive" });
    }
  };

  const handleAddDocument = async () => {
    if (!selectedDocId) return;
    
    try {
      await addDocument.mutateAsync({
        projectId,
        data: {
          documentId: selectedDocId,
          folderId: selectedFolderId,
        },
      });
      setIsAddDocOpen(false);
      setSelectedDocId("");
      toast({ title: "Success", description: "Document added to project" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to add document", variant: "destructive" });
    }
  };

  const handleRemoveDocument = async (id: string) => {
    if (!confirm("Remove this document from the project?")) return;
    
    try {
      await removeDocument.mutateAsync({ id, projectId });
      toast({ title: "Success", description: "Document removed" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to remove document", variant: "destructive" });
    }
  };

  const handleUploadFileSelect = (files: FileList | null) => {
    if (!files) return;
    const selectedFiles = Array.from(files).filter((file) => isSupportedUploadFile(file));
    if (selectedFiles.length === 0) return;

    setUploadFiles((prev) => {
      const existingKeys = new Set(prev.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      const newFiles = selectedFiles.filter(
        (file) => !existingKeys.has(`${file.name}:${file.size}:${file.lastModified}`)
      );
      return [...prev, ...newFiles];
    });
  };

  const removeUploadFile = (index: number) => {
    setUploadFiles((prev) => prev.filter((_, fileIndex) => fileIndex !== index));
  };

  const handleUploadAndAddDocuments = async () => {
    if (uploadFiles.length === 0) return;
    setIsUploadingAndAdding(true);

    let addedCount = 0;
    let failedCount = 0;
    let firstErrorMessage = "";

    try {
      if (canCombineSelectedImages && combineImageUploads) {
        let docsCreated = 0;
        let chunkFailures = 0;

        for (const chunk of combinedUploadChunks) {
          try {
            const doc = await uploadDocumentGroup.mutateAsync({
              files: chunk,
              // Combined image documents always use Vision OCR; batch mode is recommended for speed.
              ocrMode: "vision_batch",
              ocrModel: uploadOcrModel,
            });

            await addDocument.mutateAsync({
              projectId,
              data: {
                documentId: doc.id,
                folderId: selectedFolderId || undefined,
              },
            });
            docsCreated += 1;
          } catch (error) {
            chunkFailures += 1;
            if (!firstErrorMessage) {
              firstErrorMessage = error instanceof Error ? error.message : "Upload failed";
            }
          }
        }

        if (docsCreated > 0 && chunkFailures === 0) {
          toast({
            title: "Documents added",
            description: `Uploaded ${uploadFiles.length} images as ${docsCreated} document${docsCreated === 1 ? "" : "s"} (chunked for reliability).`,
          });
          setIsAddDocOpen(false);
          setUploadFiles([]);
          return;
        }

        if (docsCreated > 0 && chunkFailures > 0) {
          toast({
            title: "Partial success",
            description: `Created ${docsCreated} combined document${docsCreated === 1 ? "" : "s"}, ${chunkFailures} chunk${chunkFailures === 1 ? "" : "s"} failed.`,
            variant: "destructive",
          });
          return;
        }

        toast({
          title: "Upload failed",
          description: firstErrorMessage || "Could not upload the selected files.",
          variant: "destructive",
        });
        return;
      }

      for (const file of uploadFiles) {
        try {
          const doc = await uploadDocument.mutateAsync({
            file,
            ocrMode: uploadOcrMode,
            ocrModel: uploadOcrModel,
          });

          await addDocument.mutateAsync({
            projectId,
            data: {
              documentId: doc.id,
              folderId: selectedFolderId || undefined,
            },
          });

          addedCount += 1;
        } catch (error) {
          failedCount += 1;
          if (!firstErrorMessage) {
            firstErrorMessage = error instanceof Error ? error.message : "Upload failed";
          }
        }
      }

      if (addedCount > 0 && failedCount === 0) {
        toast({
          title: "Documents added",
          description: `Uploaded and added ${addedCount} document${addedCount === 1 ? "" : "s"} to the project.`,
        });
        setIsAddDocOpen(false);
        setUploadFiles([]);
      } else if (addedCount > 0 && failedCount > 0) {
        toast({
          title: "Partial success",
          description: `Added ${addedCount} document${addedCount === 1 ? "" : "s"}, ${failedCount} failed.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Upload failed",
          description: firstErrorMessage || "Could not upload the selected files.",
          variant: "destructive",
        });
      }
    } finally {
      setIsUploadingAndAdding(false);
    }
  };

  const handleGenerateCitation = async (result: GlobalSearchResult) => {
    const resultKey = result.annotationId || result.documentId || "";
    setGeneratingCitationFor(resultKey);
    
    try {
      if (result.citationData) {
        const citation = await generateCitation.mutateAsync({
          citationData: result.citationData,
        });
        setCitationModal(citation);
      } else if (result.documentId) {
        const res = await fetch("/api/citations/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            documentId: result.documentId,
            highlightedText: result.highlightedText || result.matchedText,
          }),
        });
        const citation = await res.json();
        if (citation.footnote && citation.bibliography) {
          setCitationModal({ footnote: citation.footnote, bibliography: citation.bibliography });
          if (!res.ok) {
            toast({ 
              title: "Partial Citation", 
              description: "Some metadata could not be extracted. Citation may be incomplete.",
            });
          }
        } else {
          throw new Error(citation.error || "Citation generation failed");
        }
      } else {
        toast({ title: "Error", description: "Cannot generate citation without document", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to generate citation", variant: "destructive" });
    } finally {
      setGeneratingCitationFor(null);
    }
  };

  const handleNavigateToDocument = (result: GlobalSearchResult) => {
    if (!result.documentId) {
      toast({ title: "Error", description: "Document not found", variant: "destructive" });
      return;
    }
    const projectDoc = projectDocuments.find(pd => pd.documentId === result.documentId);
    if (projectDoc) {
      const params = new URLSearchParams();
      if (result.annotationId) {
        params.set("annotationId", result.annotationId);
      }
      if (typeof result.startPosition === "number") {
        params.set("start", String(result.startPosition));
      }
      const query = params.toString();
      setLocation(`/projects/${projectId}/documents/${projectDoc.id}${query ? `?${query}` : ""}`);
    } else {
      toast({ title: "Document Not Found", description: "The document may have been removed from this project", variant: "destructive" });
    }
  };

  const handleCopyQuote = async (text: string) => {
    try {
      await copyTextToClipboard(text);
      toast({ title: "Copied", description: "Quote copied to clipboard" });
    } catch (error) {
      toast({
        title: "Copy failed",
        description: "Clipboard access is unavailable. Try selecting the quote text manually.",
        variant: "destructive",
      });
    }
  };

  const handleCopyFootnote = async (result: GlobalSearchResult) => {
    const resultKey = result.annotationId || result.documentId || "";
    setGeneratingFootnoteFor(resultKey);

    try {
      const quoteText = result.highlightedText || result.matchedText || "";
      if (!quoteText) {
        toast({ title: "Error", description: "No quote text available", variant: "destructive" });
        return;
      }

      if (result.citationData) {
        // Use the new footnote-with-quote endpoint
        const res = await fetch("/api/citations/footnote-with-quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            citationData: result.citationData,
            quote: quoteText,
          }),
        });

        if (!res.ok) throw new Error("Failed to generate footnote");

        const data = await res.json();
        await copyTextToClipboard(data.footnoteWithQuote);
        toast({
          title: "Footnote Copied",
          description: "Chicago-style footnote with quote copied to clipboard",
        });
      } else {
        // Fallback: just copy the quote with document name
        const docName = result.documentFilename || "Unknown document";
        const footnote = `${docName}: "${quoteText}"`;
        await copyTextToClipboard(footnote);
        toast({
          title: "Quote Copied",
          description: "Quote with document name copied (no citation data available)",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to generate or copy footnote",
        variant: "destructive",
      });
    } finally {
      setGeneratingFootnoteFor(null);
    }
  };

  if (projectLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading project...</div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <h2 className="text-xl font-semibold">Project Not Found</h2>
          <Link href="/projects">
            <Button>Back to Projects</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex">
      <aside className="w-64 border-r bg-muted/30 eva-grid-bg flex flex-col">
        <div className="p-4 border-b">
          <Link href="/projects">
            <Button variant="ghost" size="sm" className="mb-2" data-testid="button-back-projects">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <h2 className="font-semibold text-lg truncate font-mono uppercase tracking-wider">{project.name}</h2>
          {project.thesis && (
            <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{project.thesis}</p>
          )}
        </div>
        
        <div className="p-2 border-b">
          <Button 
            variant="outline" 
            size="sm" 
            className="w-full justify-start"
            onClick={() => setIsAddFolderOpen(true)}
            data-testid="button-add-folder"
          >
            <FolderPlus className="h-4 w-4 mr-2" />
            New Folder
          </Button>
        </div>
        
        <ScrollArea className="flex-1 p-2">
          <FolderTree
            folders={folders}
            selectedFolderId={selectedFolderId}
            onSelectFolder={setSelectedFolderId}
            onDeleteFolder={handleDeleteFolder}
          />
        </ScrollArea>
      </aside>

      <main className="flex-1 flex flex-col eva-grid-bg">
        <header className="border-b border-border bg-background/95 backdrop-blur-md p-4">
          <div className="flex items-center justify-between gap-4">
            <Tabs value={workspaceTab} onValueChange={(v) => setWorkspaceTab(v as "documents" | "write")}>
              <TabsList>
                <TabsTrigger value="documents" data-testid="tab-workspace-documents">
                  <FileText className="h-4 w-4 mr-2" />
                  Documents
                </TabsTrigger>
                <TabsTrigger value="write" data-testid="tab-workspace-write">
                  <PenTool className="h-4 w-4 mr-2" />
                  Write
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {workspaceTab === "documents" ? (
              <div className="flex-1 flex justify-end gap-2">
                <Input
                  placeholder="Search across all documents in this project..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="max-w-xl"
                  data-testid="input-global-search"
                />
                <Button onClick={handleSearch} disabled={isSearching} data-testid="button-search">
                  <Search className="h-4 w-4 mr-2" />
                  {isSearching ? "Searching..." : "Search"}
                </Button>
                <Button 
                  variant="outline" 
                  className="uppercase tracking-wider text-xs"
                  onClick={() => setIsBatchModalOpen(true)} 
                  disabled={projectDocuments.length === 0}
                  data-testid="button-batch-analyze"
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  Batch Analyze
                </Button>
                <Button 
                  variant="outline"
                  className="uppercase tracking-wider text-xs"
                  onClick={() => setIsBatchUploadOpen(true)} 
                  disabled={availableDocuments.length === 0}
                  data-testid="button-batch-upload"
                >
                  <FolderUp className="h-4 w-4 mr-2" />
                  Batch Add
                </Button>
                <Button className="uppercase tracking-wider text-xs" onClick={() => setIsAddDocOpen(true)} data-testid="button-add-document">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Document
                </Button>
                <ThemeToggle />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  className="uppercase tracking-wider text-xs"
                  onClick={() => setIsAddDocOpen(true)}
                  data-testid="button-add-document-write-tab"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Source
                </Button>
                <Link href={`/write?projectId=${projectId}`}>
                  <Button variant="outline" className="uppercase tracking-wider text-xs" data-testid="button-open-full-write">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Open Full Page
                  </Button>
                </Link>
                <ThemeToggle />
              </div>
            )}
          </div>
        </header>

        {workspaceTab === "write" ? (
          <div className="flex-1 min-h-0 eva-grid-bg">
            <WritingChat initialProjectId={projectId} lockProject />
          </div>
        ) : (
          <div className="flex-1 overflow-auto p-6 pb-8 eva-grid-bg">
            {searchResults.length > 0 ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="eva-section-title text-sm">SEARCH RESULTS ({searchResults.length})</h3>
                  <Button variant="ghost" size="sm" onClick={() => setSearchResults([])}>
                    Clear Results
                  </Button>
                </div>
                <div className="space-y-3">
                  {searchResults.map((result, idx) => (
                    <SearchResultCard
                      key={`${result.annotationId || result.documentId}-${idx}`}
                      result={result}
                      onGenerateCitation={() => handleGenerateCitation(result)}
                      onCopyQuote={() => handleCopyQuote(result.highlightedText || result.matchedText)}
                      onCopyFootnote={() => handleCopyFootnote(result)}
                      onNavigateToDocument={() => handleNavigateToDocument(result)}
                      isGeneratingCitation={generatingCitationFor === (result.annotationId || result.documentId)}
                      isGeneratingFootnote={generatingFootnoteFor === (result.annotationId || result.documentId)}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold font-mono text-sm uppercase tracking-wider">
                    {selectedFolderId ? folders.find(f => f.id === selectedFolderId)?.name : "All Documents"}
                    <span className="text-muted-foreground font-normal ml-2">({filteredDocuments.length})</span>
                  </h3>
                </div>
                
                {filteredDocuments.length === 0 ? (
                  <div className="text-center py-16 space-y-4">
                    <FileText className="h-12 w-12 mx-auto text-muted-foreground" />
                    <p className="text-muted-foreground">No documents in this {selectedFolderId ? "folder" : "project"} yet.</p>
                    <Button onClick={() => setIsAddDocOpen(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Document
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredDocuments.map((pd) => (
                      <Card key={pd.id} className="group hover-elevate" data-testid={`doc-card-${pd.id}`}>
                        <CardHeader className="pb-2">
                          <div className="flex items-start justify-between gap-2">
                            <CardTitle className="text-base line-clamp-1 font-mono text-sm">{pd.document.filename}</CardTitle>
                            <div className="flex gap-1">
                              <Link href={`/projects/${projectId}/documents/${pd.id}`}>
                                <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`button-view-doc-${pd.id}`}>
                                  <ExternalLink className="h-3 w-3" />
                                </Button>
                              </Link>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-7 w-7 opacity-0 group-hover:opacity-100"
                                onClick={() => handleRemoveDocument(pd.id)}
                                data-testid={`button-remove-doc-${pd.id}`}
                              >
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          {pd.document.summary ? (
                            <p className="line-clamp-3">{pd.document.summary}</p>
                          ) : (
                            <p className="italic">No summary available</p>
                          )}
                          {pd.roleInProject && (
                            <div className="mt-2 pt-2 border-t">
                              <span className="text-xs">Role: {pd.roleInProject}</span>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      <Dialog open={isAddFolderOpen} onOpenChange={setIsAddFolderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Folder</DialogTitle>
            <DialogDescription>
              {selectedFolderId 
                ? `Creating subfolder in "${folders.find(f => f.id === selectedFolderId)?.name}"`
                : "Creating folder at root level"}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="folder-name">Folder Name</Label>
            <Input
              id="folder-name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="e.g., Primary Sources"
              data-testid="input-folder-name"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddFolderOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateFolder} disabled={createFolder.isPending} data-testid="button-confirm-folder">
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isAddDocOpen} onOpenChange={(open) => {
        setIsAddDocOpen(open);
        if (!open) {
          setUploadFiles([]);
          setUploadOcrMode("standard");
          setUploadOcrModel("gpt-4o");
          setIsUploadingAndAdding(false);
          setCombineImageUploads(true);
          setSelectedDocId("");
          setAddDocTab("library");
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Document to Project</DialogTitle>
            <DialogDescription>
              Add a document from your library or upload a new file.
            </DialogDescription>
          </DialogHeader>
          <Tabs value={addDocTab} onValueChange={(v) => setAddDocTab(v as "library" | "upload")} className="py-2">
            <TabsList className="w-full">
              <TabsTrigger value="library" className="flex-1" data-testid="tab-library">
                <BookOpen className="h-4 w-4 mr-2" />
                From Library
              </TabsTrigger>
              <TabsTrigger value="upload" className="flex-1" data-testid="tab-upload">
                <Upload className="h-4 w-4 mr-2" />
                Upload New
              </TabsTrigger>
            </TabsList>
            <TabsContent value="library" className="mt-4 space-y-2">
              <Label>Select Document</Label>
              <Select value={selectedDocId} onValueChange={setSelectedDocId}>
                <SelectTrigger data-testid="select-document">
                  <SelectValue placeholder="Choose a document" />
                </SelectTrigger>
                <SelectContent>
                  {availableDocuments.length === 0 ? (
                    <div className="p-4 text-center text-muted-foreground">
                      No documents available. Upload documents first.
                    </div>
                  ) : (
                    availableDocuments.map((doc) => (
                      <SelectItem key={doc.id} value={doc.id}>
                        {doc.filename}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </TabsContent>
            <TabsContent value="upload" className="mt-4 space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff,.heic,.heif,application/pdf,text/plain,image/*"
                className="hidden"
                multiple
                onChange={(e) => {
                  handleUploadFileSelect(e.target.files);
                  e.target.value = "";
                }}
                data-testid="input-file-upload"
              />
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed rounded-md p-6 text-center cursor-pointer hover-elevate transition-colors"
                data-testid="dropzone-upload"
              >
                <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                {uploadFiles.length > 0 ? (
                  <p className="text-sm font-medium">
                    {uploadFiles.length} file{uploadFiles.length === 1 ? "" : "s"} selected
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">Click to select one or more PDF, TXT, or image files</p>
                    <p className="text-xs text-muted-foreground mt-1">Max 50MB</p>
                  </>
                )}
              </div>
              {uploadFiles.length > 0 && (
                <ScrollArea className="h-28 border rounded-md p-2">
                  <div className="space-y-2">
                    {uploadFiles.map((file, index) => (
                      <div
                        key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                        className="flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5"
                        data-testid={`selected-upload-file-${index}`}
                      >
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm flex-1 truncate">{file.name}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => removeUploadFile(index)}
                          data-testid={`button-remove-upload-file-${index}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
              {canCombineSelectedImages && (
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={combineImageUploads}
                    onCheckedChange={(checked) => setCombineImageUploads(Boolean(checked))}
                    data-testid="checkbox-combine-image-uploads"
                  />
                  <span className="leading-5">
                    Combine selected images into document batches (keeps upload order, max {MAX_COMBINED_UPLOAD_FILES_PER_DOC} images per document)
                  </span>
                </label>
              )}
              {exceedsSafeCombinedThreshold && combineImageUploads && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Large image sets are automatically split into {combinedUploadChunks.length} documents to prevent OCR failures and restarts.
                </p>
              )}
              {hasPdfUploadFiles && (
                <div className="space-y-1.5">
                  <Label>Text Extraction Mode</Label>
                  <Select value={uploadOcrMode} onValueChange={setUploadOcrMode}>
                    <SelectTrigger data-testid="select-ocr-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">Standard (digital PDFs, fast)</SelectItem>
                      <SelectItem value="advanced">Advanced OCR (scanned PDFs, PaddleOCR)</SelectItem>
                      <SelectItem value="vision">Vision OCR (scanned PDFs, GPT-4o)</SelectItem>
                      <SelectItem value="vision_batch">Vision OCR Batch (long scanned PDFs, faster)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {uploadOcrMode === "standard" && "Best for PDFs with selectable text. Fastest option."}
                    {uploadOcrMode === "advanced" && "Uses PaddleOCR at 200 DPI. Good for scanned documents."}
                    {uploadOcrMode === "vision" && "Uses GPT-4o Vision per page. Best quality for complex layouts."}
                    {uploadOcrMode === "vision_batch" && "Processes multiple pages per AI request. Recommended for long scanned PDFs."}
                  </p>
                </div>
              )}
              {shouldShowVisionModelSelector && (
                <div className="space-y-1.5">
                  <Label>AI OCR Model</Label>
                  <Select value={uploadOcrModel} onValueChange={setUploadOcrModel}>
                    <SelectTrigger data-testid="select-ocr-model">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gpt-4o">GPT-4o (best OCR quality)</SelectItem>
                      <SelectItem value="gpt-4o-mini">GPT-4o mini (faster, lower cost)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Used for HEIC/image transcription and Vision OCR PDF modes.
                  </p>
                </div>
              )}
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDocOpen(false)}>Cancel</Button>
            {addDocTab === "library" ? (
              <Button 
                onClick={handleAddDocument} 
                disabled={!selectedDocId || addDocument.isPending} 
                data-testid="button-confirm-add-doc"
              >
                {addDocument.isPending && <div className="eva-hex-spinner mr-2" style={{ width: "1rem", height: "1rem" }} />}
                Add
              </Button>
            ) : (
              <Button 
                onClick={handleUploadAndAddDocuments}
                disabled={uploadFiles.length === 0 || isUploadingAndAdding}
                data-testid="button-upload-add"
              >
                {isUploadingAndAdding && <div className="eva-hex-spinner mr-2" style={{ width: "1rem", height: "1rem" }} />}
                {canCombineSelectedImages && combineImageUploads
                  ? `Upload & Add ${combinedUploadChunks.length} Document${combinedUploadChunks.length === 1 ? "" : "s"}`
                  : `Upload & Add ${uploadFiles.length > 0 ? uploadFiles.length : ""} ${
                      uploadFiles.length === 1 ? "File" : "Files"
                    }`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!citationModal} onOpenChange={() => setCitationModal(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Chicago Citation</DialogTitle>
            <DialogDescription>
              Generated citation in Chicago Notes-Bibliography style
            </DialogDescription>
          </DialogHeader>
          {citationModal && (
            <div className="space-y-4 py-4">
              <div>
                <Label className="text-xs text-muted-foreground">Footnote</Label>
                <div className="p-3 bg-muted rounded-md text-sm font-mono">
                  {citationModal.footnote}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={async () => {
                    try {
                      await copyTextToClipboard(citationModal.footnote);
                      toast({ title: "Copied", description: "Footnote copied to clipboard" });
                    } catch {
                      toast({
                        title: "Copy failed",
                        description: "Clipboard access is unavailable in this browser context",
                        variant: "destructive",
                      });
                    }
                  }}
                  data-testid="button-copy-footnote"
                >
                  <Copy className="h-3 w-3 mr-2" />
                  Copy Footnote
                </Button>
              </div>
              <Separator />
              <div>
                <Label className="text-xs text-muted-foreground">Bibliography Entry</Label>
                <div className="p-3 bg-muted rounded-md text-sm font-mono">
                  {citationModal.bibliography}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={async () => {
                    try {
                      await copyTextToClipboard(citationModal.bibliography);
                      toast({ title: "Copied", description: "Bibliography copied to clipboard" });
                    } catch {
                      toast({
                        title: "Copy failed",
                        description: "Clipboard access is unavailable in this browser context",
                        variant: "destructive",
                      });
                    }
                  }}
                  data-testid="button-copy-bibliography"
                >
                  <Copy className="h-3 w-3 mr-2" />
                  Copy Bibliography
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setCitationModal(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BatchAnalysisModal
        open={isBatchModalOpen}
        onOpenChange={setIsBatchModalOpen}
        projectId={projectId}
        documents={projectDocuments}
        projectThesis={project?.thesis}
      />

      <BatchUploadModal
        open={isBatchUploadOpen}
        onOpenChange={setIsBatchUploadOpen}
        projectId={projectId}
        availableDocuments={availableDocuments}
        folders={folders}
        currentFolderId={selectedFolderId}
      />
    </div>
  );
}
