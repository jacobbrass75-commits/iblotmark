import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

export const remarkPlugins = [remarkGfm];

function isProjectDocumentJumpLink(href?: string): boolean {
  return typeof href === "string" && /^\/projects\/[^/]+\/documents\/[^/?#]+/.test(href);
}

function isInPageAnchorLink(href?: string): boolean {
  return typeof href === "string" && href.startsWith("#");
}

export const markdownComponents: Components = {
  a({ href, children, ...props }) {
    if (isInPageAnchorLink(href)) {
      return (
        <a
          {...props}
          href={href}
          className="underline decoration-dotted underline-offset-4"
        >
          {children}
        </a>
      );
    }

    if (isProjectDocumentJumpLink(href)) {
      return (
        <a
          {...props}
          href={href}
          className="font-medium underline decoration-dotted underline-offset-4"
          onClick={(event) => {
            event.preventDefault();
            window.open(href, "_blank", "noopener,noreferrer");
          }}
        >
          {children}
        </a>
      );
    }

    return (
      <a
        {...props}
        href={href}
        target="_blank"
        rel="noreferrer"
        className="underline decoration-dotted underline-offset-4"
      >
        {children}
      </a>
    );
  },
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
