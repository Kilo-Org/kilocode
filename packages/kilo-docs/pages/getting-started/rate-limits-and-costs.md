---
title: "Cost Efficiency & Model Selection"
description: "How to choose the right Auto Model tier and reduce token spend in Kilo Code"
---

# Cost Efficiency & Model Selection

Kilo routes your requests through its gateway, and your costs primarily depend on the model you use. The single most effective way to control spend is to pick the right Auto Model tier for each job — and to keep your context lean.

## Understanding Auto Models

Auto Model is Kilo's smart routing system. Instead of selecting a specific provider model yourself, you choose a tier that matches your performance and budget needs. Each tier uses its own routing strategy under the hood.

| Tier | Name | Best For | Cost |
|---|---|---|---|
| `kilo-auto/frontier` | Auto Frontier | Maximum capability — routes to top-tier models for planning/architect/debug and high-quality models for coding | Paid (highest) |
| `kilo-auto/balanced` | Auto Balanced | Strong performance at a predictably lower cost — routes every request to one fixed high-quality model | Paid |
| `kilo-auto/efficient` | Auto Efficient | Lowest cost per task — classifies each request by difficulty and routes to the cheapest benchmark-proven model for that task | Paid (lowest) |
| `kilo-auto/free` | Auto Free | No credits required — rotates through available free models | Free |

{% callout type="info" title="Live model assignments" %}
The underlying models behind each tier are updated server-side as better options become available or as providers change pricing. See [kilo.ai/models](https://kilo.ai/models) for current model assignments and live pricing.
{% /callout %}

## Balanced vs Efficient — What's the Difference?

Both tiers are paid, but they optimize for different things.

**Auto Balanced** routes every request to a single, fixed high-quality model. You get consistent, strong results with predictable cost — a reliable default for most developers.

**Auto Efficient** goes further. It observes your coding session in context, classifies the difficulty of each request in real time, and routes it to the *cheapest model proven accurate enough* for that specific task, based on Kilo's continuously running benchmarks. Routine tasks (small edits, lookups, quick explanations) are handled by leaner models; harder tasks (architecture, debugging, complex refactors) automatically get a more capable model.

Efficient is also session-aware: it stays with a model across related turns and only switches when a cheaper option is clearly worth it. If it cannot make a routing decision with confidence, it falls back to Balanced — so quality never drops below Balanced.

Think of Efficient as Balanced with an intelligent cost optimizer layered on top.

{% callout type="tip" %}
For everyday coding tasks, start with **Auto Efficient** or **Auto Balanced**. Switch to **Auto Frontier** for complex architecture sessions or deep debugging where maximum capability matters.
{% /callout %}

## How to Switch Auto Models

Open the model selector dropdown in the Kilo Code chat interface and choose the tier you want. No other configuration is needed; routing happens automatically from that point forward.

## Tips for Optimizing Token Usage

### Choose the right context

- **Be concise.** Clear, focused prompts cost fewer tokens than lengthy ones.
- **Provide only relevant context.** Use `@file` and `@folder` mentions selectively — include only what is directly relevant to the current task.
- **Break down large tasks.** Smaller, focused sub-tasks are cheaper per-turn and easier for the model to answer precisely.
- **Use custom instructions.** Encode recurring guidance in your custom instructions once, instead of repeating it in every prompt.

### Use modes appropriately

- **Architect mode** cannot modify code, making it a safe and cost-effective choice for analysing a codebase without risking unintended changes.
- **Debug mode** is optimized for diagnosis — use it when tracking down a specific problem rather than for general exploration.

### Context condensing

When a conversation grows long, use `/compact` (also searchable as `smol` or `condense`) to summarize the history and free up context space. You can also enable **auto-compaction** in **Settings → Context** so Kilo compacts automatically when approaching the context limit, without any manual intervention.

### Max tokens for thinking models

Every token you allocate to model output reduces how much conversation history can remain in the window. Consider keeping Code mode at 16k max output tokens or below, and raising the limit only in Architect or Debug modes where extended reasoning is genuinely useful.

### Disable unused MCP servers

If you are not using MCP (Model Context Protocol) features, consider [disabling MCP Servers in Settings → Agent Behaviour](/docs/automate/mcp/overview). This significantly reduces the size of the system prompt sent with every request.

### Prompt caching

Kilo automatically applies prompt caching on supported providers. Repeated context, such as your system prompt and stable file contents, is reused from cache at a discounted rate. No action is required to benefit from this.

## Rate Limits

- **Free models** (`kilo-auto/free`): 200 requests per hour per IP.
- **Paid models**: Kilo does not impose gateway-level rate limits on paid traffic. However, [org-level per-user daily spending limits](/docs/gateway/usage-and-billing) and upstream provider rate limits can still apply.


## How Costs Are Calculated

- Costs are a pass-through of provider pricing with no general markup.
- Kilo calculates an estimated cost for each request based on configured pricing. This estimate is shown per-request in the chat history.
- Cache hits are billed at a discounted rate compared to regular input tokens.
- Requests using **Auto Free** models are billed at $0 on Kilo's side.
- **BYOK (Bring Your Own Key)** requests are billed at $0 on Kilo's side — you pay the provider directly.

For current pricing, visit [kilo.ai/models](https://kilo.ai/models).

## Related

- [Auto Model](/docs/code-with-ai/agents/auto-model) — Full details on each Auto Model tier
- [Context Condensing](/docs/customize/context/context-condensing) — How compaction works and how to configure it
- [Using Kilo for Free](/docs/getting-started/using-kilo-for-free) — Getting started without spending credits
- [Bring Your Own Key (BYOK)](/docs/getting-started/byok) — Use your own provider API keys
