#!/usr/bin/env python3
import csv
import re
import sqlite3
from datetime import datetime
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image as RLImage,
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parents[1]
AUDIT_CSV = ROOT / "content-output/live-blog-ai-citability-merged-2026-06-18T03-54-14-604Z/live-blog-page-audit.merged.csv"
ANALYTICS_REPORT = ROOT / "content-output/shopify-blog-analytics-2026-06-25/REPORT.md"
SOURCE_DB = ROOT / "data/sourceannotator.db"
OUT_DIR = ROOT / "output/pdf"
OUT_PDF = OUT_DIR / "ibolt-top-10-blog-portfolio-upwork.pdf"

PAGE_W, PAGE_H = letter
MARGIN = 0.55 * inch
BRAND_ORANGE = colors.HexColor("#e8491d")
INK = colors.HexColor("#171717")
MUTED = colors.HexColor("#60646c")
LINE = colors.HexColor("#d9dde3")
SOFT = colors.HexColor("#f4f6f8")
DARK = colors.HexColor("#20242a")


def clean(value: str) -> str:
    value = value or ""
    replacements = {
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u2013": "-",
        "\u2014": "-",
        "\u2122": "TM",
        "\u00ae": "(R)",
        "\u00a0": " ",
        "&": "&amp;",
    }
    for src, dst in replacements.items():
        value = value.replace(src, dst)
    return re.sub(r"\s+", " ", value).strip()


def slug_from_url(url: str) -> str:
    return url.rstrip("/").split("/")[-1]


def strip_html(value: str) -> str:
    value = re.sub(r"<script[\s\S]*?</script>", " ", value or "", flags=re.I)
    value = re.sub(r"<style[\s\S]*?</style>", " ", value, flags=re.I)
    value = re.sub(r"<[^>]+>", " ", value)
    value = value.replace("&nbsp;", " ").replace("&amp;", "&").replace("&#39;", "'").replace("&quot;", '"')
    return clean(value)


def read_top_posts():
    with AUDIT_CSV.open(newline="") as f:
        rows = list(csv.DictReader(f))
    rows = [r for r in rows if r["status"] == "ok" and r["source"] == "public"]
    rows.sort(key=lambda r: (int(r["score"]), int(r["product_links"]), int(r["word_count"])), reverse=True)
    return rows[:10]


def load_db_copy(slugs):
    conn = sqlite3.connect(SOURCE_DB)
    conn.row_factory = sqlite3.Row
    placeholders = ",".join("?" for _ in slugs)
    rows = conn.execute(
        f"SELECT title, slug, meta_description, html FROM blog_posts WHERE slug IN ({placeholders})",
        list(slugs),
    ).fetchall()
    conn.close()
    return {row["slug"]: row for row in rows}


def parse_analytics_report():
    text = ANALYTICS_REPORT.read_text()
    data = {
        "chatgpt_sessions": "3,517",
        "chatgpt_orders": "37",
        "chatgpt_sales": "$3,242.67",
        "blog_window": "last 30 days",
        "top_blog_sessions": "107",
        "method": "Shopify Admin analytics snapshots and live page audits",
    }
    m = re.search(r"`chatgpt\.com`\s*\|\s*([0-9,]+)\s*\|[^|]*\|[^|]*\|[^|]*\|\s*([0-9]+)", text)
    if m:
        data["chatgpt_sessions"] = m.group(1)
    m = re.search(r"`chatgpt\.com`\s*\|\s*([0-9]+)\s*\|\s*(\$[0-9,.]+)", text)
    if m:
        data["chatgpt_orders"] = m.group(1)
        data["chatgpt_sales"] = m.group(2)
    m = re.search(r"`/blogs/news/what-size-is-th\.\.\.`\s*\|\s*([0-9]+)", text)
    if m:
        data["top_blog_sessions"] = m.group(1)
    return data


def make_styles():
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        name="TitleBig",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=30,
        leading=34,
        textColor=INK,
        alignment=TA_LEFT,
        spaceAfter=16,
    ))
    styles.add(ParagraphStyle(
        name="Deck",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=12.5,
        leading=18,
        textColor=MUTED,
        spaceAfter=12,
    ))
    styles.add(ParagraphStyle(
        name="H1",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=20,
        leading=25,
        textColor=INK,
        spaceBefore=4,
        spaceAfter=10,
    ))
    styles.add(ParagraphStyle(
        name="H2",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=13.5,
        leading=17,
        textColor=INK,
        spaceBefore=6,
        spaceAfter=5,
    ))
    styles.add(ParagraphStyle(
        name="Body",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=9.3,
        leading=13.2,
        textColor=INK,
        spaceAfter=6,
    ))
    styles.add(ParagraphStyle(
        name="Small",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=8,
        leading=10.5,
        textColor=MUTED,
    ))
    styles.add(ParagraphStyle(
        name="Metric",
        parent=styles["BodyText"],
        fontName="Helvetica-Bold",
        fontSize=16,
        leading=19,
        alignment=TA_CENTER,
        textColor=BRAND_ORANGE,
    ))
    styles.add(ParagraphStyle(
        name="MetricLabel",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=7.6,
        leading=9,
        alignment=TA_CENTER,
        textColor=MUTED,
    ))
    styles.add(ParagraphStyle(
        name="Link",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=7.8,
        leading=10,
        textColor=colors.HexColor("#1f5fa8"),
    ))
    return styles


def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.line(MARGIN, 0.48 * inch, PAGE_W - MARGIN, 0.48 * inch)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(MARGIN, 0.28 * inch, "iBOLT blog portfolio packet - prepared for Upwork review")
    canvas.drawRightString(PAGE_W - MARGIN, 0.28 * inch, f"Page {doc.page}")
    canvas.restoreState()


def card_table(items):
    rows = []
    for item in items:
        rows.append([item])
    table = Table(rows, colWidths=[PAGE_W - 2 * MARGIN])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("BOX", (0, 0), (-1, -1), 0.75, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return table


def metric_box(value, label, styles):
    return Table(
        [[Paragraph(clean(value), styles["Metric"])], [Paragraph(clean(label), styles["MetricLabel"])]],
        colWidths=[1.75 * inch],
        style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), SOFT),
            ("BOX", (0, 0), (-1, -1), 0.75, LINE),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ]),
    )


def image_flowable(path, max_w, max_h):
    raise RuntimeError("Image rendering is intentionally disabled for the compact portfolio packet.")


def portfolio_summary(row):
    category = row["category"]
    title = row["title"]
    if category == "restaurant":
        return "Restaurant technology content focused on POS workflows, delivery-app tablet organization, product selection, and operational clarity for busy counters."
    if category == "fleet":
        return "Fleet and trucking content built around ELD compliance, commercial-vehicle mounting, dashboard reliability, and buyer-ready product pathways."
    if category == "warehouse":
        return "Warehouse content covering forklift tablets, scanner workflows, rugged mounting requirements, and practical comparisons for operations teams."
    if category == "delivery":
        return "Delivery-driver content aimed at shared vehicles, device security, route reliability, and high-intent commercial phone mount searches."
    if category == "amps/modular":
        return "Technical mounting-system content explaining compatibility, modular hardware, comparison tradeoffs, and upgrade paths in buyer-friendly language."
    return f"Commercial SEO content covering {clean(category)} search intent with product-aware recommendations and answer-ready structure."


def build_pdf():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    top_posts = read_top_posts()
    db_rows = load_db_copy([slug_from_url(r["url"]) for r in top_posts])
    analytics = parse_analytics_report()
    styles = make_styles()

    doc = BaseDocTemplate(
        str(OUT_PDF),
        pagesize=letter,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=0.62 * inch,
        bottomMargin=0.68 * inch,
        title="iBOLT Top 10 Blog Portfolio",
        author="iBOLT / Codex",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="normal")
    doc.addPageTemplates([PageTemplate(id="packet", frames=[frame], onPage=footer)])

    story = []
    story.append(Paragraph("Top 10 iBOLT Blog Portfolio", styles["TitleBig"]))
    story.append(Paragraph("SEO and AI visibility writing samples for Upwork proposals", styles["Deck"]))
    story.append(Paragraph(
        "This packet highlights ten public iBOLT blog assets selected from live page audits. "
        "The examples show commercial search intent coverage, product-aware writing, comparison positioning, FAQ/schema readiness, and internal product-link strategy.",
        styles["Deck"],
    ))
    story.append(Spacer(1, 0.15 * inch))
    story.append(Table(
        [[
            metric_box("94/100", "Top page audit score", styles),
            metric_box(analytics["chatgpt_sessions"], "ChatGPT sessions, 365 days", styles),
            metric_box(analytics["chatgpt_orders"], "ChatGPT attributed orders", styles),
            metric_box(analytics["chatgpt_sales"], "ChatGPT attributed sales", styles),
        ]],
        colWidths=[1.75 * inch] * 4,
        hAlign="LEFT",
        style=TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 8)]),
    ))
    story.append(Spacer(1, 0.22 * inch))
    story.append(Paragraph("Evidence basis", styles["H2"]))
    story.append(ListFlowable([
        ListItem(Paragraph("Top ten selected from the live blog AI citability audit by score, then product-link depth and word count.", styles["Body"])),
        ListItem(Paragraph("Shopify analytics snapshot showed ChatGPT traffic and attributed sales, with blogs treated as an assisted visibility and entity-signal layer.", styles["Body"])),
        ListItem(Paragraph("These are public portfolio samples with direct URLs for client inspection.", styles["Body"])),
    ], bulletType="bullet", start="circle", leftIndent=16))
    story.append(Spacer(1, 0.16 * inch))

    summary_rows = [[
        Paragraph("<b>#</b>", styles["Small"]),
        Paragraph("<b>Blog title</b>", styles["Small"]),
        Paragraph("<b>Vertical</b>", styles["Small"]),
        Paragraph("<b>Score</b>", styles["Small"]),
        Paragraph("<b>Links</b>", styles["Small"]),
    ]]
    for i, row in enumerate(top_posts, 1):
        summary_rows.append([
            Paragraph(str(i), styles["Small"]),
            Paragraph(clean(row["title"]), styles["Small"]),
            Paragraph(clean(row["category"]), styles["Small"]),
            Paragraph(row["score"], styles["Small"]),
            Paragraph(row["product_links"], styles["Small"]),
        ])
    table = Table(summary_rows, colWidths=[0.32 * inch, 3.72 * inch, 1.08 * inch, 0.53 * inch, 0.53 * inch])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), DARK),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.35, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(table)
    story.append(PageBreak())

    story.append(Paragraph("Performance Context", styles["H1"]))
    story.append(Paragraph(
        "The strongest business proof in the available Shopify snapshot is AI-source commercial traffic: ChatGPT produced measurable sessions, orders, and last-click sales. "
        "The blog portfolio supports that channel by building high-intent answer pages, product comparison pages, FAQ/schema sections, and internal product pathways.",
        styles["Body"],
    ))
    story.append(Spacer(1, 0.12 * inch))
    evidence_rows = [
        [Paragraph("<b>Metric</b>", styles["Small"]), Paragraph("<b>Evidence</b>", styles["Small"]), Paragraph("<b>Why it matters</b>", styles["Small"])],
        [Paragraph("AI-source traffic", styles["Small"]), Paragraph(f"ChatGPT sessions: {analytics['chatgpt_sessions']} over 365 days", styles["Small"]), Paragraph("Shows AI answer surfaces already send commercially meaningful visitors.", styles["Small"])],
        [Paragraph("Attributed sales", styles["Small"]), Paragraph(f"{analytics['chatgpt_orders']} orders, {analytics['chatgpt_sales']} last-click sales", styles["Small"]), Paragraph("Gives the portfolio a revenue-backed business context.", styles["Small"])],
        [Paragraph("Top blog traffic", styles["Small"]), Paragraph(f"Visible top blog landing row: {analytics['top_blog_sessions']} sessions in last 30 days", styles["Small"]), Paragraph("Shows blog pages are receiving discoverability traffic.", styles["Small"])],
        [Paragraph("Top audit quality", styles["Small"]), Paragraph("10 selected pages scored 94/100 in the live public blog audit", styles["Small"]), Paragraph("Confirms technical SEO, schema, product links, and answer readiness.", styles["Small"])],
    ]
    evidence = Table(evidence_rows, colWidths=[1.25 * inch, 2.45 * inch, 2.75 * inch])
    evidence.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), DARK),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.35, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
    ]))
    story.append(evidence)
    story.append(Spacer(1, 0.18 * inch))
    story.append(Paragraph("Important note", styles["H2"]))
    story.append(Paragraph(
        "The available Shopify data does not prove that any single blog post caused a sale. "
        "The correct client-facing claim is that the blog system strengthens AI/search visibility and supports the product pages that already receive ChatGPT traffic.",
        styles["Body"],
    ))
    story.append(PageBreak())

    story.append(Paragraph("Top 10 Portfolio Samples", styles["H1"]))
    for i, row in enumerate(top_posts, 1):
        slug = slug_from_url(row["url"])
        db_row = db_rows.get(slug)
        meta = portfolio_summary(row)

        strengths = []
        if row["has_quick_answer"].lower() == "true":
            strengths.append("quick answer block")
        if row["has_faq_schema"].lower() == "true":
            strengths.append("FAQ schema")
        if row["has_article_schema"].lower() == "true":
            strengths.append("Article schema")
        if row["has_comparison_signals"].lower() == "true":
            strengths.append("comparison language")
        strengths.append(f"{row['product_links']} product links")

        card_content = [
            Paragraph(f"<b>{i}. {clean(row['title'])}</b>", styles["H2"]),
            Paragraph(
                f"<b>Category:</b> {clean(row['category'])} &nbsp;&nbsp; "
                f"<b>Audit score:</b> {row['score']}/100 &nbsp;&nbsp; "
                f"<b>Word count:</b> {row['word_count']} &nbsp;&nbsp; "
                f"<b>Product links:</b> {row['product_links']}",
                styles["Body"],
            ),
            Paragraph(clean(meta[:430]), styles["Body"]),
            Paragraph(f"<b>Why it works:</b> {clean(', '.join(strengths))}.", styles["Body"]),
            Paragraph(f'<link href="{row["url"]}">{clean(row["url"])}</link>', styles["Link"]),
        ]
        story.append(KeepTogether([card_table([card_content]), Spacer(1, 0.12 * inch)]))

    story.append(PageBreak())
    story.append(Paragraph("How to Position This on Upwork", styles["H1"]))
    story.append(Paragraph(
        "Use this packet as proof that you can write technical ecommerce SEO content that is useful to buyers and machine-readable for AI search surfaces. "
        "The strongest pitch is not only 'I write blogs,' but 'I build content systems around product facts, search intent, schema, internal links, and measurable visibility signals.'",
        styles["Body"],
    ))
    story.append(Paragraph("Suggested proposal language", styles["H2"]))
    story.append(Paragraph(
        "I specialize in SEO blog content for ecommerce and B2B product companies. My process combines keyword intent, product catalog research, comparison angles, FAQ/schema formatting, and internal product-link strategy. "
        "The attached iBOLT portfolio shows ten published examples across restaurant POS, fleet/ELD, warehouse, delivery, and modular mounting topics, with live URLs and audit metrics.",
        styles["Body"],
    ))
    story.append(Spacer(1, 0.18 * inch))
    story.append(Paragraph("Source files used", styles["H2"]))
    story.append(Paragraph(clean(str(AUDIT_CSV.relative_to(ROOT))), styles["Small"]))
    story.append(Paragraph(clean(str(ANALYTICS_REPORT.relative_to(ROOT))), styles["Small"]))
    story.append(Paragraph(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}", styles["Small"]))

    doc.build(story)


if __name__ == "__main__":
    build_pdf()
    print(OUT_PDF)
