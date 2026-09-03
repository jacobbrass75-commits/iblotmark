import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BookOpen, Lightbulb, FileText, PenLine } from "lucide-react";
import { markdownComponents, remarkPlugins } from "@/lib/markdownConfig";
import { DocumentStatusCard } from "@/components/chat/DocumentStatusCard";
import type { Message } from "@shared/schema";

interface ChatMessagesProps {
  messages: Message[];
  streamingText: string;
  isStreaming: boolean;
  streamingChatText?: string;
  streamingDocumentTitle?: string;
  streamingDocumentText?: string;
  isDocumentStreaming?: boolean;
  onDocumentSelect?: (document: { title: string; content: string }) => void;
  onSuggestedPrompt?: (prompt: string) => void;
}

type ParsedSegment =
  | { type: "chat"; content: string }
  | { type: "document"; title: string; content: string };

const SUGGESTED_PROMPTS = [
  {
    icon: BookOpen,
    label: "Help me understand a concept",
    prompt: "Can you explain the concept of peer review in academic publishing?",
  },
  {
    icon: PenLine,
    label: "Improve my writing",
    prompt: "Can you help me improve the clarity and flow of my thesis introduction?",
  },
  {
    icon: FileText,
    label: "Format a citation",
    prompt: "How do I cite a journal article in Chicago style?",
  },
  {
    icon: Lightbulb,
    label: "Research methodology",
    prompt: "What are the differences between qualitative and quantitative research methods?",
  },
];

function parseMessageContent(content: string): ParsedSegment[] {
  const regex = /<document\s+title="([^"]*)">([\s\S]*?)<\/document>/gi;
  const segments: ParsedSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const chatChunk = content.slice(lastIndex, match.index);
    if (chatChunk.trim().length > 0) {
      segments.push({ type: "chat", content: chatChunk.trim() });
    }

    segments.push({
      type: "document",
      title: (match[1] || "Draft").trim() || "Draft",
      content: (match[2] || "").trim(),
    });

    lastIndex = regex.lastIndex;
  }

  const remainder = content.slice(lastIndex);
  if (remainder.trim().length > 0) {
    segments.push({ type: "chat", content: remainder.trim() });
  }

  return segments;
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="mb-5 flex justify-end">
      <div className="max-w-[88%] rounded-3xl bg-primary px-4 py-2.5 text-primary-foreground sm:max-w-[80%]">
        <p className="whitespace-pre-wrap text-[15px] leading-6">{content}</p>
      </div>
    </div>
  );
}

function AssistantMarkdownBubble({ content, isStreaming = false }: { content: string; isStreaming?: boolean }) {
  return (
    <div className="mb-6 flex justify-start">
      <div className="w-full max-w-full px-1 sm:max-w-[85%] sm:rounded-2xl sm:border sm:bg-card sm:px-4 sm:py-3 sm:shadow-sm">
        <div className="prose prose-sm max-w-none text-[15px] leading-7 dark:prose-invert [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
          <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
            {content}
          </ReactMarkdown>
          {isStreaming && <span className="inline-block w-2 h-4 bg-foreground/60 animate-pulse ml-0.5 align-text-bottom" />}
        </div>
      </div>
    </div>
  );
}

function AssistantMessage({
  message,
  onDocumentSelect,
}: {
  message: Message;
  onDocumentSelect?: (document: { title: string; content: string }) => void;
}) {
  const segments = parseMessageContent(message.content);
  if (segments.length === 0) {
    return <AssistantMarkdownBubble content={message.content} />;
  }

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.type === "chat") {
          return <AssistantMarkdownBubble key={`${message.id}-chat-${index}`} content={segment.content} />;
        }

        return (
          <div key={`${message.id}-doc-${index}`} className="flex justify-start mb-4">
            <div className="max-w-[80%] w-full">
              <DocumentStatusCard
                title={segment.title}
                content={segment.content}
                onView={
                  onDocumentSelect
                    ? () => onDocumentSelect({ title: segment.title, content: segment.content })
                    : undefined
                }
              />
            </div>
          </div>
        );
      })}
    </>
  );
}

export function ChatMessages({
  messages,
  streamingText,
  isStreaming,
  streamingChatText,
  streamingDocumentTitle,
  streamingDocumentText,
  isDocumentStreaming = false,
  onDocumentSelect,
  onSuggestedPrompt,
}: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeStreamingChat = streamingChatText ?? streamingText;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeStreamingChat, streamingDocumentText, isDocumentStreaming]);

  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-5 py-8">
        <div className="max-w-md space-y-6 text-center">
          <div>
            <h2 className="text-2xl font-semibold mb-2">ScholarMark AI</h2>
            <p className="text-muted-foreground">
              Your academic writing assistant. Ask me about research, writing, citations, or anything related to academic work.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2 min-[430px]:grid-cols-2 sm:gap-3">
            {SUGGESTED_PROMPTS.map((item) => (
              <button
                key={item.label}
                onClick={() => onSuggestedPrompt?.(item.prompt)}
                className="flex min-h-12 items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-accent min-[430px]:flex-col min-[430px]:items-start"
              >
                <item.icon className="h-4 w-4 text-primary" />
                <span className="text-sm">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="mx-auto max-w-3xl px-4 py-5 sm:p-6">
        {messages.map((msg) =>
          msg.role === "user" ? (
            <UserBubble key={msg.id} content={msg.content} />
          ) : (
            <AssistantMessage key={msg.id} message={msg} onDocumentSelect={onDocumentSelect} />
          )
        )}

        {isStreaming && activeStreamingChat && (
          <AssistantMarkdownBubble content={activeStreamingChat} isStreaming />
        )}

        {isDocumentStreaming && (
          <div className="flex justify-start mb-4">
            <div className="max-w-[80%] w-full">
              <DocumentStatusCard
                title={streamingDocumentTitle || "Draft"}
                content={streamingDocumentText || ""}
                isStreaming
                onView={
                  onDocumentSelect && streamingDocumentText
                    ? () =>
                        onDocumentSelect({
                          title: streamingDocumentTitle || "Draft",
                          content: streamingDocumentText,
                        })
                    : undefined
                }
              />
            </div>
          </div>
        )}

        {isStreaming && !activeStreamingChat && !isDocumentStreaming && (
          <div className="flex justify-start mb-4">
            <div className="max-w-[80%] rounded-2xl px-4 py-3 bg-card border shadow-sm">
              <div className="flex gap-1.5">
                <span className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
