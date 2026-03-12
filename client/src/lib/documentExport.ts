import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { markdownToDocx } from "./markdownToDocx";

type MdNode = {
  type: string;
  depth?: number;
  value?: string;
  children?: MdNode[];
  ordered?: boolean;
  identifier?: string;
  alt?: string;
};

interface TextStyle {
  bold?: boolean;
  italics?: boolean;
  superscript?: boolean;
}

interface TextSegment {
  text: string;
  style: TextStyle;
}

interface FootnoteContext {
  footnoteIdsByIdentifier: Map<string, number>;
  footnoteOrder: string[];
  footnoteDefinitions: Map<string, MdNode>;
}

function parseMarkdownAst(markdownContent: string): MdNode {
  return unified().use(remarkParse).use(remarkGfm).parse(markdownContent) as unknown as MdNode;
}

export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[>*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function toSafeFilename(value: string): string {
  return (
    value
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "generated-paper"
  );
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function flattenText(node?: MdNode): string {
  if (!node) return "";
  if (node.type === "text" || node.type === "inlineCode") {
    return node.value || "";
  }
  return (node.children || []).map((child) => flattenText(child)).join("");
}

function ensureFootnoteId(context: FootnoteContext, identifier: string): number {
  const key = identifier.toLowerCase();
  const existing = context.footnoteIdsByIdentifier.get(key);
  if (existing) return existing;
  const id = context.footnoteIdsByIdentifier.size + 1;
  context.footnoteIdsByIdentifier.set(key, id);
  context.footnoteOrder.push(key);
  return id;
}

function inlineToSegments(node: MdNode, context: FootnoteContext, style: TextStyle = {}): TextSegment[] {
  switch (node.type) {
    case "text":
    case "inlineCode":
      return [{ text: node.value || "", style }];
    case "strong":
      return (node.children || []).flatMap((child) =>
        inlineToSegments(child, context, { ...style, bold: true })
      );
    case "emphasis":
      return (node.children || []).flatMap((child) =>
        inlineToSegments(child, context, { ...style, italics: true })
      );
    case "delete":
      return (node.children || []).flatMap((child) => inlineToSegments(child, context, style));
    case "footnoteReference": {
      const identifier = node.identifier || "";
      if (!identifier) return [];
      const id = ensureFootnoteId(context, identifier);
      return [{ text: `[${id}]`, style: { ...style, superscript: true } }];
    }
    case "link":
      return (node.children || []).flatMap((child) => inlineToSegments(child, context, style));
    default:
      return (node.children || []).flatMap((child) => inlineToSegments(child, context, style));
  }
}

function tokenizeSegments(segments: TextSegment[]): TextSegment[] {
  const tokens: TextSegment[] = [];
  for (const segment of segments) {
    const parts = segment.text.split(/(\s+)/);
    for (const part of parts) {
      if (!part) continue;
      tokens.push({ text: part, style: segment.style });
    }
  }
  return tokens;
}

function getFontKey(style: TextStyle): "regular" | "bold" | "italic" | "boldItalic" {
  if (style.bold && style.italics) return "boldItalic";
  if (style.bold) return "bold";
  if (style.italics) return "italic";
  return "regular";
}

export async function buildDocxBlob(title: string, markdownContent: string): Promise<Blob> {
  return markdownToDocx(markdownContent, { title });
}

export async function buildPdfBlob(title: string, markdownContent: string): Promise<Blob> {
  const root = parseMarkdownAst(markdownContent);
  const topLevelChildren = root.children || [];

  const footnoteDefinitions = new Map<string, MdNode>();
  const bodyNodes: MdNode[] = [];
  for (const child of topLevelChildren) {
    if (child.type === "footnoteDefinition" && child.identifier) {
      footnoteDefinitions.set(child.identifier.toLowerCase(), child);
    } else {
      bodyNodes.push(child);
    }
  }

  const footnoteContext: FootnoteContext = {
    footnoteIdsByIdentifier: new Map(),
    footnoteOrder: [],
    footnoteDefinitions,
  };

  const pdf = await PDFDocument.create();
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.TimesRoman),
    bold: await pdf.embedFont(StandardFonts.TimesRomanBold),
    italic: await pdf.embedFont(StandardFonts.TimesRomanItalic),
    boldItalic: await pdf.embedFont(StandardFonts.TimesRomanBoldItalic),
  };

  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 72;
  const contentWidth = pageWidth - margin * 2;
  const lineHeight = 24; // 12pt double-spaced

  let page = pdf.addPage([pageWidth, pageHeight]);
  const pages = [page];
  let y = pageHeight - margin;

  const ensureLineSpace = () => {
    if (y <= margin + 28) {
      page = pdf.addPage([pageWidth, pageHeight]);
      pages.push(page);
      y = pageHeight - margin;
    }
  };

  const drawLine = (tokens: TextSegment[], size: number) => {
    ensureLineSpace();
    let x = margin;
    for (const token of tokens) {
      const fontKey = getFontKey(token.style);
      const font = fonts[fontKey];
      const tokenSize = token.style.superscript ? Math.max(8, size - 3) : size;
      const tokenY = token.style.superscript ? y + 4 : y;
      page.drawText(token.text, {
        x,
        y: tokenY,
        size: tokenSize,
        font,
        color: rgb(0.08, 0.08, 0.08),
      });
      x += font.widthOfTextAtSize(token.text, tokenSize);
    }
    y -= lineHeight;
  };

  const wrapAndDrawSegments = (segments: TextSegment[], size: number) => {
    const tokens = tokenizeSegments(segments);
    let current: TextSegment[] = [];
    let currentWidth = 0;

    for (const token of tokens) {
      const font = fonts[getFontKey(token.style)];
      const tokenSize = token.style.superscript ? Math.max(8, size - 3) : size;
      const tokenWidth = font.widthOfTextAtSize(token.text, tokenSize);
      if (current.length > 0 && currentWidth + tokenWidth > contentWidth) {
        drawLine(current, size);
        current = [];
        currentWidth = 0;
      }
      current.push(token);
      currentWidth += tokenWidth;
    }

    if (current.length > 0) {
      drawLine(current, size);
    }
  };

  const renderParagraphNode = (node: MdNode, size: number, prefix?: string) => {
    const segments = (node.children || []).flatMap((child) => inlineToSegments(child, footnoteContext));
    const prefixed = prefix ? [{ text: prefix, style: {} as TextStyle }, ...segments] : segments;
    wrapAndDrawSegments(prefixed, size);
    y -= 6;
  };

  const renderBlock = (node: MdNode, listPrefix?: string) => {
    switch (node.type) {
      case "heading": {
        const size = node.depth === 1 ? 14 : node.depth === 2 ? 13 : 12;
        const headingSegments = (node.children || []).flatMap((child) =>
          inlineToSegments(child, footnoteContext, { bold: true })
        );
        wrapAndDrawSegments(headingSegments, size);
        y -= 8;
        return;
      }
      case "paragraph":
        renderParagraphNode(node, 12, listPrefix);
        return;
      case "blockquote": {
        const text = flattenText(node).trim();
        if (text) {
          renderParagraphNode({ type: "paragraph", children: [{ type: "text", value: text }] }, 12, "> ");
        }
        return;
      }
      case "list": {
        (node.children || []).forEach((item, index) => {
          const prefix = node.ordered ? `${index + 1}. ` : "• ";
          const paragraphChild = (item.children || []).find((child) => child.type === "paragraph");
          if (paragraphChild) {
            renderParagraphNode(paragraphChild, 12, prefix);
          } else {
            const text = flattenText(item);
            renderParagraphNode({ type: "paragraph", children: [{ type: "text", value: text }] }, 12, prefix);
          }
        });
        return;
      }
      case "code": {
        const codeText = node.value || "";
        const codeSegments = [{ text: codeText, style: { italics: true } }];
        wrapAndDrawSegments(codeSegments, 11);
        y -= 6;
        return;
      }
      case "thematicBreak":
        y -= 10;
        return;
      default:
        (node.children || []).forEach((child) => renderBlock(child, listPrefix));
    }
  };

  // Title
  wrapAndDrawSegments([{ text: title, style: { bold: true } }], 15);
  y -= 8;

  for (const node of bodyNodes) {
    renderBlock(node);
  }

  if (footnoteContext.footnoteOrder.length > 0) {
    y -= 10;
    wrapAndDrawSegments([{ text: "Endnotes", style: { bold: true } }], 13);
    y -= 4;

    for (const identifier of footnoteContext.footnoteOrder) {
      const id = footnoteContext.footnoteIdsByIdentifier.get(identifier)!;
      const definition = footnoteContext.footnoteDefinitions.get(identifier);
      const definitionText = definition
        ? (definition.children || []).map((child) => flattenText(child)).join(" ").trim()
        : "";
      const line = definitionText ? `[${id}] ${definitionText}` : `[${id}]`;
      wrapAndDrawSegments([{ text: line, style: {} }], 10);
      y -= 2;
    }
  }

  // Page numbers (bottom-right)
  pages.forEach((p, index) => {
    const label = `${index + 1}`;
    const width = fonts.regular.widthOfTextAtSize(label, 10);
    p.drawText(label, {
      x: pageWidth - margin - width,
      y: 24,
      size: 10,
      font: fonts.regular,
      color: rgb(0.25, 0.25, 0.25),
    });
  });

  return new Blob([await pdf.save()], { type: "application/pdf" });
}

export function getDocTypeLabel(filename: string): string {
  const name = filename.toLowerCase();
  if (name.endsWith(".pdf")) return "PDF";
  if (name.endsWith(".txt")) return "TXT";
  if (/\.(png|jpg|jpeg|webp|gif|bmp|tif|tiff|heic|heif)$/i.test(name)) return "IMAGE";
  return "DOC";
}
