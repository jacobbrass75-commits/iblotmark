import { useState, useCallback, useRef } from "react";
import { queryClient } from "@/lib/queryClient";

export interface PipelineState {
  isRunning: boolean;
  phase: string;
  message: string;
  plan: any | null;
  sections: Array<{ title: string; content: string }>;
  markdown: string;
  verification: any | null;
  blogPost: any | null;
  error: string | null;
}

const initialState: PipelineState = {
  isRunning: false,
  phase: "",
  message: "",
  plan: null,
  sections: [],
  markdown: "",
  verification: null,
  blogPost: null,
  error: null,
};

export function useBlogPipeline() {
  const [state, setState] = useState<PipelineState>(initialState);
  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback(async (clusterId: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ ...initialState, isRunning: true, message: "Starting..." });

    try {
      const response = await fetch("/api/blog/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clusterId }),
        credentials: "include",
        signal: controller.signal,
      });

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              setState((prev) => {
                const next = { ...prev };
                if (data.phase) next.phase = data.phase;
                if (data.message) next.message = data.message;
                if (data.plan) next.plan = data.plan;
                if (data.sectionContent) {
                  next.sections = [...prev.sections, { title: data.sectionTitle || "", content: data.sectionContent }];
                }
                if (data.markdown) next.markdown = data.markdown;
                if (data.verification) next.verification = data.verification;
                if (data.blogPost) next.blogPost = data.blogPost;
                if (data.error) next.error = data.error;
                if (data.type === "complete") next.isRunning = false;
                if (data.type === "error") {
                  next.isRunning = false;
                  next.error = data.error || "Unknown error";
                }
                return next;
              });
            } catch {}
          }
        }
      }

      setState((prev) => ({ ...prev, isRunning: false }));
      queryClient.invalidateQueries({ queryKey: ["/api/blog/posts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/blog/keywords/clusters"] });
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setState((prev) => ({ ...prev, isRunning: false, error: err.message }));
      }
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState((prev) => ({ ...prev, isRunning: false, message: "Cancelled" }));
  }, []);

  const reset = useCallback(() => {
    setState(initialState);
  }, []);

  return { ...state, generate, cancel, reset };
}
