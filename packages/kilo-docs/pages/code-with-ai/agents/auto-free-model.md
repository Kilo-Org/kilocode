---
title: "Auto: Free Model"
description: Automatic routing to the best free model, no account required
---

# Auto: Free Model

Auto: Free (`kilo/auto-free`) is a virtual model that automatically routes your requests to the best available free model. No credits, no credit card, no sign-in needed.

It's the default model for unauthenticated users, so if you're just trying Kilo Code out you're already using it.

---

## Who it's for

Auto: Free is a good fit if you are:

- **Trying Kilo Code for the first time** and don't want to set up billing yet
- **A student or hobbyist** who wants capable AI assistance without ongoing costs
- **Exploring what's possible** before committing to a paid plan

{% callout type="info" %}
Authenticated users with credits default to **Auto: Frontier** (`kilo/auto`) instead. You can still switch back to Auto: Free manually at any time.
{% /callout %}

---

## Current free model pool

The exact model you get is determined server-side. The pool currently includes:

| Model ID                              | Name                           |
| ------------------------------------- | ------------------------------ |
| `minimax/minimax-m2.1:free`           | MiniMax M2.1                   |
| `giga-potato`                         | Giga Potato                    |
| `corethink:free`                      | CoreThink                      |
| `arcee-ai/trinity-large-preview:free` | Arcee AI Trinity Large Preview |

Free model availability changes over time as provider promotions start and end. When the best option changes, routing updates transparently — you don't need to do anything.

{% callout type="note" %}
If a model in the pool becomes unavailable, routing silently falls back to the next-best free model. You'll only see an error if every free option is exhausted at the same time, which is rare.
{% /callout %}

---

## Select it in the model picker

If you're signed in and want to switch to Auto: Free:

1. Open Kilo Code in VS Code or JetBrains
2. Click the model selector dropdown
3. Search for or select **Auto: Free**

That's it — no other configuration needed.

---

## Comparison with Auto: Frontier

Auto: Frontier (`kilo/auto`) routes to paid Claude models and switches between them based on your current mode:

| Feature          | Auto: Free                           | Auto: Frontier                      |
| ---------------- | ------------------------------------ | ----------------------------------- |
| Cost             | Free                                 | Credits required                    |
| Default for      | Unauthenticated users                | Authenticated users with credits    |
| Model pool       | Best available free model            | Claude Opus 4.6 / Claude Sonnet 4.5 |
| Per-mode routing | May use a single model for all modes | Different models per mode           |

Auto: Frontier uses different models for planning vs. implementation modes. Auto: Free may use a single model across all modes, since the free pool may not include enough model variety to justify splitting.

---

## Data handling

{% callout type="warning" title="Different data policies" %}
Free tier models may have different data handling and privacy policies than frontier models. Auto: Frontier routes through Anthropic, which does not train on user data. The policies for free models vary by provider — check the terms for the specific model being used if this matters for your work.
{% /callout %}

---

## Related

- [Auto Model](/docs/code-with-ai/agents/auto-model) — Auto: Frontier and how per-mode routing works
- [Free & Budget Models](/docs/code-with-ai/agents/free-and-budget-models) — Other ways to use Kilo Code at low or no cost
