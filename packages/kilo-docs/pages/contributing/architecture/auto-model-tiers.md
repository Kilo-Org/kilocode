---
title: "Auto Model Tiers"
description: "Extending Kilo Auto to a family of smart model tiers that match users to the right models without requiring AI expertise"
---

# Auto Model Tiers

## Overview

Today, Kilo Auto (`kilo/auto`) solves a real problem: users shouldn't have to know which AI model is best for planning versus coding. It picks the right model for the task automatically.

But it only solves that problem for one audience — users willing to pay for frontier models. Everyone else is left navigating a long, intimidating model list where the "best" free or open-weight option changes monthly. This is a source of friction for new free users and cost-conscious teams.

This spec proposes extending Kilo Auto into a family of tiers so that every user — regardless of budget, preference, or expertise — gets the same "just works" auto experience.

## Problem

### Users shouldn't need to be AI model experts

The AI model landscape is overwhelming. There are hundreds of models across dozens of providers, with different pricing, capabilities, context windows, and availability. Most developers just want to write code — they don't want to research which model is best for their task, budget, and workflow.

Today, Kilo Auto handles this for users with a willingness to pay for frontier models. But we leave three underserved groups to fend for themselves:

1. **Free users** — They see a list of free models that changes on promotional periods and shifting models. Which one is the best? Which is good for a particular task? They have no way to know without trial and error.

2. **Cost-conscious users** — They want something better than free but cheaper than frontier. Open-weight models like Kimi K2.5 and DeepSeek are useful and significantly cheaper, but which one? Which version? The answer changes every few weeks.

3. **Background tasks** — Kilo uses small models for things like generating session titles and commit messages. Today this is hardcoded to a specific model. If a user runs out of credits, these background tasks fall back to the current large model. This can cause Kilo unnecessary costs and slow responsiveness for the user.

### Free model churn creates a moving target

Free models on OpenRouter appear and disappear based on promotional periods. A model that works well today may be gone next week. Users who manually selected a free model discover it's unavailable. Kilo Auto tiers would absorb this churn — when the best free model changes, we update the mapping and users can just keep working.

## Solution

Extend Kilo Auto into four tiers.

### Auto: Frontier

**Who it's for**: Users who want the best available models and are willing to pay for them.

**What problem it solves**: Professional developers and teams don't want to spend time evaluating which paid model is best for which task — and the answer keeps changing as providers release new versions. Frontier eliminates that research burden. Users get the best paid models automatically, matched to their task, without ever having to compare benchmarks or read release notes.

**What it does**: This is what `kilo/auto` is today. It routes between the best paid models based on the task — stronger reasoning models for planning and architecture, faster models for code generation and editing. It optimizes for the best balance of capability, speed, and token efficiency.

**Why it matters**: Frontier models offer the highest code quality, best instruction following, and most reliable tool use. For professional developers and teams where output quality directly impacts productivity, this is the right choice.

**Pricing**: Paid. Uses credits.

**Backward compatibility**: The existing `kilo/auto` model ID becomes an alias for `kilo/auto-frontier`. No behavior change for existing users.

### Auto: Free

**Who it's for**: Users who want to try Kilo without a credit card, students, hobbyists, and anyone exploring AI-assisted coding.

**What problem it solves**: Free users today face a confusing model list where the "best" option is a moving target — models appear and disappear based on promotional periods, quality varies, and there's no guidance on which one to use for which mode. Most users don't have the context to make this choice, and may make a poor choice or feel intimidated. Auto: Free makes this decision for them so the onboarding experience is just "start coding."

**What it does**: Automatically maps to the best available free model(s) for each mode. As free model availability changes due to promotional periods, the mapping updates transparently. Users always get the best free option without having to track which models are currently available.

**Why it matters**: This removes a potentially intimidating choice for free users, and sets them up for a good experience. "Auto: Free" is selected by default (or it's selected for them by default when unauthenticated) and they start coding immediately. When a free model promotion ends, they don't get a prompt to pick a new model — the routing silently falls back to the next best option.

**Pricing**: Free. No credits required.

**Constraints**: Free models may not provide sufficient breadth to justify different models based on modes. In that case, a single model may be used for all modes. Quality will be lower than Frontier or Open tiers — this is a tradeoff users accept by choosing free.

### Auto: Open

**Who it's for**: Cost-conscious developers who want better results than free models, users who prefer open-source/open-weight models for philosophical or compliance reasons, and teams that want model transparency.

**What problem it solves**: The open-weight model landscape moves faster than any other segment — new releases from DeepSeek, Minimax, Moonshot AI, Z.AI, Qwen, and others land every few weeks, leapfrogging each other on benchmarks and real-world coding tasks. Users who want to use open-weight models face frequent research overhead and real-world time to stay on the best one. Auto: Open solves this for them, always routing to the current best open-weight option so they get the cost and transparency benefits without the cognitive burden.

**What it does**: Routes to the best open-weight models (DeepSeek, Moonshot, Minimax etc.) for each task type. May use a blend of paid and free models depending on what's available and the current state of the art. Like Frontier, it can switch models based on task type when the available models have sufficient difference in capabilities and cost.

**Why it matters**: Open-weight models have gotten remarkably capable and are significantly cheaper than frontier closed models. Auto: Open absorbs model churn and always routes to the current best option. It also appeals to users and organizations that value model transparency and auditability.

**Pricing**: Generally cheaper than Frontier. May use a mix of paid and free models depending on availability.

### Auto: Small (internal)

**Who it's for**: Not user-facing. Used internally by Kilo clients for lightweight background tasks.

**What problem it solves**: Kilo uses small models behind the scenes for tasks like generating session titles, commit messages, and conversation summaries. Today, the small model is configurable by the end user but defaults to a paid frontier model. If a free user doesn't have access to that model, the task falls back to the user's main (large) model — wasting credits and adding latency for a task that should be instant and cheap. Auto: Small makes background tasks reliably work for all users regardless of their payment status.

**What it does**: Automatically selects the right small model for lightweight tasks. When credits are available, it uses a fast paid small model (Haiku, GPT Nano, etc.). When no credits are available, it falls back to a capable free small model. Since we can use a free model for this, we can support it for all users and providers.

**Model options for Auto: Small**:

| Model | Cost | Capability | Notes |
| ----- | ---- | ---------- | ----- |
| gpt-oss-20b | ~50% cheaper than GPT-5 Nano | Lower — suitable for simple background tasks like titles and summaries | Open-weight, cost-optimized option for high-volume lightweight tasks |
| GPT-5 Nano | Higher than gpt-oss-20b | Higher — better instruction following and output quality | Preferred when credits are available and task quality matters |

Auto: Small should prefer **gpt-oss-20b** when minimizing cost (e.g., free users, high-volume background tasks) and **GPT-5 Nano** when credits are available and higher output quality is desired.

**Why it matters**: Users never think about background tasks, and they shouldn't have to. Auto: Small ensures these tasks always work, always feel fast, and never waste credits on an expensive model when a cheap one will do.

## User experience

### Model picker

The three user-facing tiers appear in the model selector:

| Display Name   | Description shown to user                            |
| -------------- | ---------------------------------------------------- |
| Auto: Frontier | Best paid models, automatically matched to your task |
| Auto: Free     | Best free models, no credits required                |
| Auto: Open     | Open-weight models, strong capability at lower cost  |

Auto: Small does not appear in the model picker. It is selected automatically for background tasks.

### Defaults

- **Authenticated users** (have credits): Default to Auto: Frontier
- **Unauthenticated users** (no credits): Default to Auto: Free

This means a brand-new user who hasn't signed in gets a working experience immediately — no model selection required.

### What users see

The UI shows the tier name (e.g., "Auto: Frontier"), not the underlying model. Users don't need to know or care that their planning request went to Opus and their coding request went to Sonnet. The abstraction is the product.

## Requirements

- `kilo/auto` remains as a backward-compatible alias for `kilo/auto-frontier`
- Unauthenticated users default to `kilo/auto-free` with no configuration required
- Free tier must handle model availability changes gracefully — fallback to next-best free model, never surface a "model unavailable" error if any free model exists
- Open tier must use open-weight models as the primary routing targets
- Auto: Small must detect credit availability and select paid or free small models accordingly
- All tiers use mode-based routing where the underlying models support it
- When a tier routes to different model families across turns in a conversation, thinking/reasoning blocks from the previous model must be stripped to prevent compatibility errors

### Non-requirements

- Per-agent tier overrides (e.g., Frontier for code, Free for explore) — future work
- Showing the resolved underlying model name in the UI — future work
- User-configurable tier preferences — future work
- Custom user-defined tiers — out of scope

## Risks

| Risk                                                     | User impact                                                | Mitigation                                                                                                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Free model disappears mid-session                        | User's next message fails                                  | Fallback chain: primary → secondary → tertiary free model. Graceful error only if all options exhausted.                                           |
| Model quality variance across free/open tiers            | Inconsistent experience compared to Frontier               | Set clear expectations in UI ("Free" and "Open" imply tradeoffs). Curate model lists, don't just pick the cheapest.                                |
| Cross-family model switching breaks conversation context | Thinking blocks from Model A are incompatible with Model B | Strip thinking blocks when the underlying model family changes between turns. Frontier stays within one family so this only affects Free and Open. |
| Users don't understand the tier differences              | Wrong tier selected, poor experience                       | Clear descriptions in the model picker. Good defaults (Frontier for paid, Free for unpaid) so most users never need to actively choose.            |

## Data and compliance

- **Frontier**: Same compliance posture as today. Uses Anthropic models with no training on user data.
- **Free and Open**: The underlying models may have different data handling policies depending on the provider. This must be documented per-tier so enterprise users can make informed choices.
- **Small**: Same concern as Free/Open — the model selected depends on credit status, which may route to providers with different policies.

## Success criteria

- New unauthenticated users can start coding without selecting a model (Free tier auto-selected)
- Free model churn is invisible to users — no "model unavailable" errors when alternatives exist
- Conversion from Free to Frontier increases as users experience the product and want better quality
- Background tasks (titles, summaries) never fail due to model availability regardless of credit status

## Features for the future

- **Resolved model transparency**: Show the actual model being used on hover/click for users who want to know
- **Per-agent tier overrides**: Let users pick Frontier for their code agent but Free for explore
- **Auto model changelog**: A status page or in-product notification when tier mappings change
- **Tier analytics**: Dashboard showing which models each tier resolves to, latency, error rates, quality metrics
- **Enterprise open-weight preference**: Organizations that require open-weight models for auditability could enforce the Open tier across their team
