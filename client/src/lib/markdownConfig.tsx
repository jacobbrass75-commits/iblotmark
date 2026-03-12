import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

export const remarkPlugins = [remarkGfm];

export const markdownComponents: Components = {
  code({ className, children, ...props }) {
    const hasLanguage = /language-(\w+)/.test(className || "");
    const isBlock = hasLanguage || (typeof children === "string" && children.includes("\n"));
    if (isBlock) {
      return (
        <pre className="bg-muted rounded-md p-3 overflow-x-auto text-xs">
          <code className={className} {...props}>
            {children}
          </code>
        </pre>
      );
    }
    return (
      <code className="bg-muted px-1 py-0.5 rounded text-xs" {...props}>
        {children}
      </code>
    );
  },
};
