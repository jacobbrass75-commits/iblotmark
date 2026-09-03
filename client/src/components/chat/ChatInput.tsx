import { useState, useRef, useEffect, useCallback } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
}

const MAX_CHARS = 10000;
const MAX_ROWS = 6;

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const lineHeight = 24; // approx line height in px
    const maxHeight = lineHeight * MAX_ROWS;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    // Reset height after send
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t bg-background/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-md sm:p-4">
      <div className="max-w-3xl mx-auto">
        <div className="relative flex items-end gap-2 rounded-[26px] border bg-muted/50 p-1.5 pl-3 shadow-sm sm:rounded-xl sm:p-2">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              if (e.target.value.length <= MAX_CHARS) {
                setValue(e.target.value);
              }
            }}
            onKeyDown={handleKeyDown}
            placeholder="Message ScholarMark"
            disabled={disabled}
            rows={1}
            aria-label="Message ScholarMark"
            className="min-h-10 flex-1 resize-none bg-transparent px-1 py-2 text-base leading-6 focus:outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:px-2 sm:py-1.5 sm:text-sm"
            style={{ maxHeight: `${24 * MAX_ROWS}px` }}
          />
          <div className="flex items-center gap-2 shrink-0">
            {value.length > MAX_CHARS * 0.8 && (
              <span className="text-xs text-muted-foreground">
                {value.length}/{MAX_CHARS}
              </span>
            )}
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!value.trim() || disabled}
              aria-label="Send message"
              className="h-10 w-10 rounded-full sm:h-8 sm:w-8 sm:rounded-lg"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="mt-1.5 hidden text-center text-xs text-muted-foreground sm:block">
          Press Enter to send, Shift+Enter for a new line
        </p>
      </div>
    </div>
  );
}
