# Caracal Solutions AI Visibility Service Ops

## Positioning

Caracal Solutions sells a managed AI visibility service, not a software subscription.

Core promise:

> We find where a business is missing, misrepresented, or outranked in ChatGPT,
> Gemini, Claude, and Google AI-style answers, then ship the content and site fixes
> that make the business easier to understand, trust, cite, and recommend.

## Best First Offers

### Free Snapshot

- 5 prompts for one city/niche.
- Screenshots or saved response snippets.
- Competitor mentions.
- 3 fixable gaps.
- CTA: 15-minute walkthrough.

### Paid Diagnostic

- Price: $497, credited to first month.
- 25-40 prompts across ChatGPT, Claude, Gemini, and Gemini + Google Search.
- Competitor share of answer.
- Citation/source gap list.
- Site, FAQ, review, schema, and content recommendations.
- 30-day fix roadmap.

### Monthly Service

- Foundation: $1,000/month.
- Growth: $1,500/month.
- Category Leader: $2,000/month.
- Minimum term: 90 days.

## Monthly Deliverables

- Prompt benchmark rerun.
- Competitor visibility summary.
- Blog posts or buying guides.
- FAQ blocks.
- Service page or product/collection copy edits.
- Internal link recommendations.
- Schema-ready content blocks.
- Review request and review response prompts.
- Google Business Profile recommendations.
- Monthly proof report with before/after deltas.

For Shopify clients, add:

- Product-aware buying guides.
- Collection intro rewrites.
- Product FAQ blocks.
- Product and collection internal links.
- Shopify-ready HTML export or publish queue.

## Required Infrastructure

### Identity

- Primary domain inbox: `yakub@caracalsolutions.com` or `hello@caracalsolutions.com`.
- Sales inbox or alias: `growth@caracalsolutions.com`.
- Optional sending subdomain: `mail.caracalsolutions.com`.
- SPF, DKIM, and DMARC configured before cold outbound.
- Branded Calendly or booking link.
- Stripe payment links or invoices.
- Simple MSA/SOW template.

### Data And Ops

- Lead tracker: app Service Ops page first, CRM later if needed.
- Report storage: generated app report, PDF export later.
- Delivery tracker: audit gaps, approved fixes, shipped fixes, retest state.
- Client asset folder: website access, GBP notes, brand notes, competitors.

### Provider Keys

Do not paste keys into chat. Store in `.env`.

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY` or `GOOGLE_AI_API_KEY`
- `OPENROUTER_API_KEY` optional fallback.
- Shopify OAuth/admin credentials when publishing is enabled.

## Sales Flow

1. Build local business lead list by niche and city.
2. Run a free AI visibility snapshot.
3. Send a short note with one concrete gap.
4. Offer screenshots, not a deck.
5. Walk through the gap live.
6. Sell a paid diagnostic or 90-day service.
7. Ship fixes within the first week.
8. Rerun prompts monthly and report movement.

## Cold Email Template

Subject: ChatGPT skipped {Business}

Hi {Name},

I ran a quick AI visibility check for {category} businesses in {city}.

When I asked ChatGPT/Gemini/Claude "{prompt}", {competitor} showed up more
clearly than {Business}.

I found 3 fixable gaps:

1. {gap}
2. {gap}
3. {gap}

Want me to send the screenshots?

## Fulfillment Checklist

- Confirm city, services, target customers, and competitors.
- Generate prompt pack.
- Run baseline benchmark.
- Identify prompt losses, citation gaps, source weaknesses, and missing page types.
- Create fix plan.
- Draft content, FAQs, and page edits.
- Get approval.
- Publish or hand off.
- Rerun selected prompts.
- Send monthly report.

## Risk Rules

- Do not guarantee placement in AI answers.
- Track percent recommended and citation quality, not fake "rankings."
- For medical, legal, finance, or regulated claims, require client approval.
- Keep opt-out handling for outbound.
- Use accurate sender identity and non-deceptive subject lines.
