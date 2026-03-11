import { useState, useEffect, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { ChatMessages } from "@/components/chat/ChatMessages";
import { ChatInput } from "@/components/chat/ChatInput";
import {
  useConversations,
  useConversation,
  useCreateConversation,
  useDeleteConversation,
  useUpdateConversation,
  useSendMessage,
} from "@/hooks/useChat";
import { useProjects } from "@/hooks/useProjects";
import { useToast } from "@/hooks/use-toast";

export default function Chat() {
  const params = useParams<{ conversationId?: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    params.conversationId || null
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // Sync URL param changes
  useEffect(() => {
    setActiveConversationId(params.conversationId || null);
  }, [params.conversationId]);

  const { data: conversations = [] } = useConversations();
  const { data: projects = [] } = useProjects();
  const { data: conversationData } = useConversation(activeConversationId);
  const createConversation = useCreateConversation();
  const deleteConversation = useDeleteConversation();
  const updateConversation = useUpdateConversation();
  const { send, streamingText, isStreaming } = useSendMessage(activeConversationId);

  const messages = conversationData?.messages || [];

  const handleNewChat = useCallback(async () => {
    try {
      const conv = await createConversation.mutateAsync(
        selectedProjectId ? { projectId: selectedProjectId } : undefined
      );
      setLocation(`/chat/${conv.id}`);
    } catch {
      toast({
        title: "Error",
        description: "Failed to create conversation",
        variant: "destructive",
      });
    }
  }, [createConversation, selectedProjectId, setLocation, toast]);

  const handleSelect = useCallback(
    (id: string) => {
      setLocation(`/chat/${id}`);
    },
    [setLocation]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteConversation.mutateAsync(id);
        if (activeConversationId === id) {
          setLocation("/chat");
        }
      } catch {
        toast({
          title: "Error",
          description: "Failed to delete conversation",
          variant: "destructive",
        });
      }
    },
    [deleteConversation, activeConversationId, setLocation, toast]
  );

  const handleRename = useCallback(
    async (id: string, newTitle: string) => {
      try {
        await updateConversation.mutateAsync({ id, data: { title: newTitle } });
      } catch {
        toast({
          title: "Error",
          description: "Failed to rename conversation",
          variant: "destructive",
        });
      }
    },
    [updateConversation, toast]
  );

  const handleSend = useCallback(
    async (content: string) => {
      // If no active conversation, create one first
      if (!activeConversationId) {
        try {
          const conv = await createConversation.mutateAsync(
            selectedProjectId ? { projectId: selectedProjectId } : undefined
          );
          setLocation(`/chat/${conv.id}`);
          await send(content, conv.id);
        } catch {
          toast({
            title: "Error",
            description: "Failed to create conversation",
            variant: "destructive",
          });
        }
        return;
      }

      await send(content);
    },
    [activeConversationId, send, createConversation, selectedProjectId, setLocation, toast]
  );

  return (
    <div className="flex h-screen overflow-hidden">
      <ChatSidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelect={handleSelect}
        onNew={handleNewChat}
        onDelete={handleDelete}
        onRename={handleRename}
        projects={projects}
        selectedProjectId={selectedProjectId}
        onProjectChange={setSelectedProjectId}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <ChatMessages
          messages={messages}
          streamingText={streamingText}
          isStreaming={isStreaming}
          onSuggestedPrompt={handleSend}
        conversation={conversationData || null}
        projects={projects}
        />
        <ChatInput onSend={handleSend} disabled={isStreaming} />
      </div>
    </div>
  );
}
