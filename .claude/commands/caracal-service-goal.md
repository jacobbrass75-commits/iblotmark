---
# prettier-ignore
description: "Drive Caracal Solutions toward the AI visibility managed-service goal with self-verification, implementation, and evidence-backed next actions"
argument-hint: '[specific objective, client niche, or "full audit"]'
version: 1.0.0
---

# /caracal-service-goal - AI Visibility Service Goal Runner

<mission>
Advance Caracal Solutions toward a sellable managed AI visibility service.

The business sells implementation, not software: find where local or Shopify businesses
are missing, misrepresented, uncited, or outranked in AI answers; generate the audit,
prompt pack, outbound angle, fix plan, blogs, FAQs, page edits, Shopify-ready content,
and proof report needed to win and retain service clients.
</mission>

<user-context>
$ARGUMENTS
</user-context>

<north-star>
Make the system more capable of landing and fulfilling $1K-$2K+/month managed AI
visibility clients under Caracal Solutions.
</north-star>

<critical-assets>
- Service ops workspace: `/blog/service-ops`
- AI visibility benchmark workspace: `/blog/benchmark`
- Blog/content generation: `/blog/generate`, `/blog/posts`
- Shopify/catalog workflows: `/blog/products`, `/blog/catalog`, Shopify publish routes
- Service ops API: `/api/blog/service-ops`
- Benchmark API: `/api/blog/benchmark`
- Service ops doc: `docs/CARACAL_AI_VISIBILITY_SERVICE_OPS.md`
- MCP stdio server: `mcp-server/ibolt-stdio.mjs`
</critical-assets>

<required-operating-loop>
1. Restate the concrete goal for this run in one sentence.
2. Inspect current repo/app state relevant to that goal.
3. Check whether `OPENROUTER_API_KEY` is present without printing the secret.
4. Verify the app can support the goal with real commands.
5. Identify the highest-leverage missing piece.
6. Implement the missing piece if it is feasible in this run.
7. Re-run focused verification after implementation.
8. Report evidence, remaining gaps, and the next action that moves revenue closer.
</required-operating-loop>

<verification-gates>
Run the relevant subset of these checks before claiming progress:

```bash
npm run check
node --check mcp-server/ibolt-stdio.mjs
curl -sS -H 'x-company-id: ibolt-default-company' http://127.0.0.1:5001/api/blog/service-ops
curl -sS -H 'x-company-id: ibolt-default-company' http://127.0.0.1:5001/api/blog/service-ops/packages
curl -sS -H 'x-company-id: ibolt-default-company' http://127.0.0.1:5001/api/blog/benchmark/providers
```

For UI changes, use Playwright against:

```text
http://127.0.0.1:5001/blog/service-ops
http://127.0.0.1:5001/blog/benchmark
```

For benchmark/provider work, verify provider config status first and avoid printing API
keys. If `OPENROUTER_API_KEY` is missing, state that clearly and continue with non-key
work that still advances the service.
</verification-gates>

<openrouter-policy>
OpenRouter is the preferred fallback for live AI visibility provider runs when direct
OpenAI, Anthropic, or Gemini keys are unavailable.

Required environment entries:

```text
OPENROUTER_API_KEY=...
AI_BENCHMARK_FORCE_OPENROUTER=true
AI_BENCHMARK_OPENROUTER_CHATGPT_MODEL=openai/gpt-4o
AI_BENCHMARK_OPENROUTER_CLAUDE_MODEL=anthropic/claude-sonnet-4
AI_BENCHMARK_OPENROUTER_GEMINI_MODEL=google/gemini-2.5-flash
```

Never print secrets. Report only whether a key is present, missing, or malformed.
</openrouter-policy>

<revenue-readiness-checklist>
Evaluate the system against these business capabilities:

- Can we create a prospect record or intake artifact?
- Can we generate a local/city/niche prompt pack?
- Can we run or prepare an AI visibility benchmark?
- Can we show competitor and citation gaps?
- Can we generate outbound copy from those gaps?
- Can we turn gaps into a fix plan?
- Can we generate blogs, FAQs, page edits, or Shopify-ready HTML?
- Can we retest and produce a monthly proof report?
- Can an operator use the UI without reading code?
- Can the MCP surface run the same service workflow?
</revenue-readiness-checklist>

<implementation-priorities>
Prefer improvements in this order:

1. Anything that makes the free snapshot faster to produce.
2. Anything that converts benchmark gaps into sellable proof.
3. Anything that turns proof into blogs, FAQs, Shopify content, or page edits.
4. Anything that improves monthly reporting and retention.
5. Anything that reduces manual operator steps.
6. Website/branding work only when explicitly requested.
</implementation-priorities>

<quality-bar>
Progress means observed capability, not intention.

Acceptable evidence includes:
- passing typecheck or syntax check
- successful API response with expected fields
- browser-rendered UI with no page errors
- generated prompt pack, outbound snapshot, or fix plan
- benchmark provider status showing configured keys
- created draft content or Shopify-ready export

If verification is blocked, explain the blocker and perform the next useful check that
does not require that blocker.
</quality-bar>

<final-response-format>
Return:

1. **Goal** - the concrete objective pursued.
2. **Shipped** - files or system capabilities changed.
3. **Verified** - commands run and specific results.
4. **OpenRouter** - present/missing status only, no secret.
5. **Next Revenue Move** - one specific next action.
</final-response-format>
