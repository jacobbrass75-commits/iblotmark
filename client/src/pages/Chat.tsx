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
import { useToast } from "@/hooks/use-toast";

export default function Chat() {
  const params = useParams<{ conversationId?: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    params.conversationId || null
  );

  // Sync URL param changes
  useEffect(() => {
    setActiveConversationId(params.conversationId || null);
  }, [params.conversationId]);

  const { data: conversations = [] } = useConversations();
  const { data: conversationData } = useConversation(activeConversationId);
  const createConversation = useCreateConversation();
  const deleteConversation = useDeleteConversation();
  const updateConversation = useUpdateConversation();
  const { send, streamingText, isStreaming } = useSendMessage(activeConversationId);

  const messages = conversationData?.messages || [];

  const handleNewChat = useCallback(async () => {
    try {
      const conv = await createConversation.mutateAsync();
      setLocation(`/chat/${conv.id}`);
    } catch {
      toast({
        title: "Error",
        description: "Failed to create conversation",
        variant: "destructive",
      });
    }
  }, [createConversation, setLocation, toast]);

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
          const conv = await createConversation.mutateAsync();
          setLocation(`/chat/${conv.id}`);
          // Wait a tick for state to update, then send via direct fetch
          // We need to call send on the new conversation
          setTimeout(async () => {
            const response = await fetch(
              `/api/chat/conversations/${conv.id}/messages`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content }),
                credentials: "include",
              }
            );
            // Process the stream manually for this first message
            if (response.ok && response.body) {
              const reader = response.body.getReader();
              const decoder = new TextDecoder();
              while (true) {
                const { done } = await reader.read();
                if (done) break;
              }
            }
            // Refresh data
            const { queryClient } = await import("@/lib/queryClient");
            queryClient.invalidateQueries({
              queryKey: ["/api/chat/conversations", conv.id],
            });
            queryClient.invalidateQueries({
              queryKey: ["/api/chat/conversations"],
            });
          }, 100);
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
    [activeConversationId, send, createConversation, setLocation, toast]
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
      />
      <div className="flex-1 flex flex-col min-w-0">
        <ChatMessages
          messages={messages}
          streamingText={streamingText}
          isStreaming={isStreaming}
          onSuggestedPrompt={handleSend}
        />
        <ChatInput onSend={handleSend} disabled={isStreaming} />
      </div>
    </div>
  );
}
