---
title: "Auto Model Tiers"
description: "Architecture of Kilo Auto — a family of smart model tiers that match users to the right models without requiring AI expertise"
---

# Auto Model Tiers

## Overview

Kilo Auto is a model routing system that automatically selects the optimal AI model based on the user's current mode (Code, Architect, Debug, etc.). It comes in multiple tiers so that every user — regardless of budget, preference, or expertise — gets a "just works" experience without needing to understand the AI model landscape.

Three tiers are user-facing, and one is internal:

| Tier ID              | Audience                       | Pricing |
| -------------------- | ------------------------------ | ------- |
| `kilo-auto/frontier` | Best paid models               | Paid    |
| `kilo-auto/balanced` | Strong performance, lower cost | Paid    |
| `kilo-auto/free`     | Best available free models     | Free    |
| `kilo-auto/small`    | Internal — background tasks    | Varies  |

## Problem

### Users shouldn't need to be AI model experts

The AI model landscape is overwhelming. There are hundreds of models across dozens of providers, with different pricing, capabilities, context windows, and availability. Most developers just want to write code — they don't want to research which model is best for their task, budget, and workflow.

Without Auto Model, three groups are underserved:

1. **Free users** — They see a list of free models that changes on promotional periods and shifting availability. Which one is the best? Which is good for a particular task? They have no way to know without trial and error.

2. **Cost-conscious users** — They want something better than free but cheaper than frontier. Open-weight models are useful and significantly cheaper, but which one? Which version? The answer changes every few weeks.

3. **Background tasks** — Kilo uses small models for things like generating session titles and commit messages. These should be invisible and reliable, not dependent on the user's model selection or credit status.

### Free model churn creates a moving target

Free models on OpenRouter appear and disappear based on promotional periods. A model that works well today may be gone next week. Users who manually selected a free model discover it's unavailable. Auto Model tiers absorb this churn — when the best free model changes, the mapping updates server-side and users keep working.

## Tiers

### Auto: Frontier

**Who it's for**: Users who want the best available models and are willing to pay for them.

**What it does**: Routes between the best paid models based on the task — stronger reasoning models for planning and architecture, faster models for code generation and editing. Optimizes for the best balance of capability, speed, and token efficiency.

**Pricing**: Paid. Uses credits.

For the current mode-to-model mappings, see the [Auto Model user docs](/docs/code-with-ai/agents/auto-model#tiers).

### Auto: Balanced

**Who it's for**: Cost-conscious developers who want better results than free models at a fraction of frontier cost.

**What it does**: Uses GPT 5.3 Codex — a cost-effective model with strong reasoning and coding capabilities — for every mode. Unlike Frontier, Balanced does not vary its underlying model by mode.

**Pricing**: Paid, but significantly cheaper than Frontier.

For the current mode-to-model mappings, see the [Auto Model user docs](/docs/code-with-ai/agents/auto-model#tiers).

### Auto: Free

**Who it's for**: Users who want to try Kilo without a credit card, students, hobbyists, and anyone exploring AI-assisted coding.

**What it does**: Splits requests across the best available free models, weighted by a deterministic per-session hash so a given session sticks with one model. As free model availability changes due to promotional periods, the split and the underlying models are updated transparently server-side. Users always get the best free option without having to track which models are currently available.

**Pricing**: Free. No credits required.

**Constraints**: Free models do not vary by mode — the same model is used for every mode within a session. Quality will be lower than Frontier or Balanced tiers — this is a tradeoff users accept by choosing free.

### Auto: Small (internal)

**Who it's for**: Not user-facing. Used internally by Kilo for lightweight background tasks (session titles, commit messages, conversation summaries).

**What it does**: Automatically selects the right small model for lightweight tasks. When the account has a positive balance, it uses a fast paid small model; otherwise it falls back to a free small model.

**Why it matters**: Users never think about background tasks, and they shouldn't have to. Auto: Small ensures these tasks always work, always feel fast, and never waste credits on an expensive model when a cheap one will do.

**Implementation**: The `getSmallModel()` function in `packages/opencode/src/provider/provider.ts` prioritizes `kilo-auto/small` when the Kilo provider is active. If the user's provider doesn't have a dedicated small model, it falls back globally to `kilo-auto/small` when available.

## User experience

### Model picker

The three user-facing tiers appear in the model selector:

| Display Name   | Description shown to user                            |
| -------------- | ---------------------------------------------------- |
| Auto: Frontier | Best paid models, automatically matched to your task |
| Auto: Balanced | Strong performance at lower cost                     |
| Auto: Free     | Best free models, no credits required                |

Auto: Small does not appear in the model picker. It is filtered out by the UI (see `KILO_AUTO_SMALL_IDS` in the VS Code extension).

### Defaults

- **Authenticated users**: Default to `kilo-auto/balanced` (defined in `packages/kilo-gateway/src/api/constants.ts`)
- **Unauthenticated users**: Default to `kilo-auto/free`

This means a brand-new user who hasn't signed in gets a working experience immediately — no model selection required.

### What users see

The UI shows the tier name (e.g., "Auto: Frontier"), not the underlying model. Users don't need to know or care that their planning request went to Opus and their coding request went to Sonnet. The abstraction is the product.

## Implementation architecture

Auto Model uses a split client/server architecture. The actual model-to-mode mappings are not hardcoded in the client — they're served dynamically from the Kilo API, making it possible to update routing without client releases.

### Server side (Kilo API)

The Kilo API at `api.kilo.ai` defines which underlying models each `kilo-auto/*` tier routes to per mode. Each auto model is returned with an `opencode.variants` field — a map of mode-specific provider options:

```json
{
  "opencode": {
    "variants": {
      "architect": { "model": "anthropic/claude-opus-4.7", ... },
      "code": { "model": "anthropic/claude-sonnet-4.6", ... }
    }
  }
}
```

This is fetched via `packages/kilo-gateway/src/api/models.ts` which parses the `opencode.variants` field from the API response.

### Client side

The client-side chain works as follows:

1. **Model fetching**: `packages/opencode/src/provider/model-cache.ts` caches Kilo Gateway models with a 5-minute TTL, fetching from the Kilo API.

2. **Variant passthrough**: `packages/opencode/src/provider/transform.ts` — the `variants()` function passes through server-defined variants for Kilo Gateway models directly, rather than computing them locally.

3. **Variant storage**: `packages/opencode/src/provider/provider.ts` stores `variants` on the model object when the provider is `kilo`.

4. **Agent variant resolution**: Each agent (mode) specifies a `variant` in its config (`packages/opencode/src/config/config.ts`). At prompt time, `packages/opencode/src/session/prompt.ts` resolves the variant from the agent config and attaches it to the user message.

5. **LLM call merging**: At call time, `packages/opencode/src/session/llm.ts` merges the variant's options (including the actual underlying model ID) into the provider options sent to OpenRouter.

### Key files

| File                                            | Role                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| `packages/kilo-gateway/src/api/constants.ts`    | Default model constants (`DEFAULT_MODEL`, `DEFAULT_FREE_MODEL`)                       |
| `packages/kilo-gateway/src/api/models.ts`       | Fetches models from Kilo API, parses `opencode.variants`                              |
| `packages/opencode/src/provider/model-cache.ts` | Caches Kilo Gateway models with 5-min TTL                                             |
| `packages/opencode/src/provider/provider.ts`    | Preserves variants for kilo provider; `getSmallModel()` prioritizes `kilo-auto/small` |
| `packages/opencode/src/provider/transform.ts`   | Passes through server-defined variants for Kilo Gateway models                        |
| `packages/opencode/src/session/prompt.ts`       | Resolves variant from agent config, attaches to user messages                         |
| `packages/opencode/src/session/llm.ts`          | Merges variant options into LLM call parameters                                       |
| `packages/opencode/src/config/config.ts`        | Agent config schema includes `variant` field                                          |

## Requirements

- Unauthenticated users default to `kilo-auto/free` with no configuration required
- All tiers use mode-based routing where the underlying models support it
- When a tier routes to different model families across turns in a conversation, thinking/reasoning blocks from the previous model are stripped to prevent compatibility errors
- Auto Model requires **VS Code/JetBrains extension v5.2.3+** or **CLI v1.0.15+** for mode-based switching. Older versions fall back to a single model for all requests.

## Risks

| Risk                                              | User impact                                            | Mitigation                                                                                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Free model disappears mid-session                 | User's next message fails                              | Fallback chain: primary → secondary → tertiary free model. Graceful error only if all options exhausted.                                                                      |
| Model quality variance across free/balanced tiers | Inconsistent experience compared to Frontier           | Set clear expectations in UI. Curate model lists, don't just pick the cheapest.                                                                                               |
| Cross-family model switching breaks context       | Thinking blocks from Model A incompatible with Model B | Strip thinking blocks when the underlying model family changes between turns. Frontier stays within one family so this primarily affects Free tier (which may switch models). |
| Users don't understand the tier differences       | Wrong tier selected, poor experience                   | Clear descriptions in the model picker. Good defaults (Balanced for paid, Free for unpaid) so most users never need to actively choose.                                       |

## Data and compliance

- **Frontier**: Uses Anthropic models with no training on user data.
- **Balanced and Free**: The underlying models may have different data handling policies depending on the provider. This should be documented per-tier so enterprise users can make informed choices.
- **Small**: Same concern as Balanced/Free — the model selected depends on credit status, which may route to providers with different policies.

## Features for the future

- **Resolved model transparency**: Show the actual model being used on hover/click for users who want to know
- **Per-agent tier overrides**: Let users pick Frontier for their code agent but Free for explore
- **Auto model changelog**: A status page or in-product notification when tier mappings change
- **Tier analytics**: Dashboard showing which models each tier resolves to, latency, error rates, quality metrics
- **Enterprise open-weight preference**: Organizations that require open-weight models for auditability could enforce the Balanced tier across their team
