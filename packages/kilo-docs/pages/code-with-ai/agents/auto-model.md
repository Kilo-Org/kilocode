---
title: "Auto Model"
description: "Smart model routing that automatically selects the optimal AI model based on your current mode"
---

# Auto Model

Auto Model is a smart model routing system that automatically selects the optimal AI model based on the Kilo Code mode you're using. It comes in multiple tiers so you can balance cost and capability to fit your needs.

| Tier                 | Best For                                          | Pricing |
| -------------------- | ------------------------------------------------- | ------- |
| `kilo-auto/frontier` | Maximum capability with the best available models | Paid    |
| `kilo-auto/balanced` | Strong performance at a lower cost                | Paid    |
| `kilo-auto/free`     | The best free models available                    | Free    |

## How It Works

1. Select an Auto Model tier (e.g. `kilo-auto/frontier`) in the model dropdown
2. Start working in any mode (Code, Architect, Debug, etc.)
3. The system automatically routes your requests to the best model for that task

That's it. No configuration needed.

## Auto Frontier

`kilo-auto/frontier` routes to the latest and most capable paid models available, optimizing for performance, capability, and cost.

### Mode-to-Model Mapping

| Mode           | Model Used        | Best For                     |
| -------------- | ----------------- | ---------------------------- |
| `architect`    | Claude Opus 4.6   | System design, planning      |
| `orchestrator` | Claude Opus 4.6   | Multi-step task coordination |
| `ask`          | Claude Opus 4.6   | Questions, explanations      |
| `plan`         | Claude Opus 4.6   | Planning, reasoning          |
| `general`      | Claude Opus 4.6   | General assistance           |
| `debug`        | Claude Opus 4.6   | Debugging and fixing issues  |
| `code`         | Claude Sonnet 4.6 | Writing and editing code     |
| `build`        | Claude Sonnet 4.6 | Implementation tasks         |
| `explore`      | Claude Sonnet 4.6 | Codebase exploration         |

**Planning and reasoning tasks** use Claude Opus 4.6, which excels at complex reasoning, architectural decisions, and breaking down problems.

**Implementation tasks** use Claude Sonnet 4.6, which is optimized for fast, accurate code generation and editing.

## Auto Balanced

`kilo-auto/balanced` follows the same mode-based routing structure as Frontier but uses more cost-effective models — Kimi K2.5 for reasoning-heavy modes and Minimax M2.7 for implementation modes.

### Mode-to-Model Mapping

| Mode           | Model Used   | Best For                     |
| -------------- | ------------ | ---------------------------- |
| `architect`    | Kimi K2.5    | System design, planning      |
| `orchestrator` | Kimi K2.5    | Multi-step task coordination |
| `ask`          | Kimi K2.5    | Questions, explanations      |
| `plan`         | Kimi K2.5    | Planning, reasoning          |
| `general`      | Kimi K2.5    | General assistance           |
| `debug`        | Kimi K2.5    | Debugging and fixing issues  |
| `code`         | Minimax M2.7 | Writing and editing code     |
| `build`        | Minimax M2.7 | Implementation tasks         |
| `explore`      | Minimax M2.7 | Codebase exploration         |

**Planning and reasoning tasks** use Kimi K2.5, a strong open-weight reasoning model from Moonshot AI.

**Implementation tasks** use Minimax M2.7, which provides fast, capable code generation at a fraction of frontier model costs.

{% callout type="info" title="Image support" %}
Auto Balanced does not support image inputs, since Minimax M2.7 does not have vision capabilities.
{% /callout %}

## Benefits

### Simplified Setup

No need to manually switch models when changing modes. Auto Model handles the routing transparently in the background.

### Cost Optimization

Uses the more economical models for implementation tasks where speed matters, while reserving stronger reasoning models for planning tasks. You get optimal cost-to-capability ratio without thinking about it.

### Best-in-Class Models

Auto Model routes to capable models matched to your task:

- **Auto Frontier** uses the latest and most effective models across all modes
- **Auto Balanced** uses more cost-effective models while still providing strong capabilities
- **Auto Free** uses the best available free models

## Requirements

{% callout type="warning" title="Version Requirements" %}
Auto Model requires **VS Code/JetBrains extension v5.2.3+** or **CLI v1.0.15+** for automatic mode-based switching. On older versions, Auto Model tiers will default to a single model for all requests.
{% /callout %}

## Getting Started

{% callout type="tip" title="Quick Setup" %}
Select an Auto Model tier from the model dropdown in the Kilo Code chat interface. That's all you need to do.
{% /callout %}

1. Open Kilo Code in VS Code or JetBrains
2. Click the model selector dropdown
3. Choose an Auto Model such as `kilo-auto/frontier` or `kilo-auto/balanced`
4. Start chatting - the right model is selected automatically based on your current mode

## When to Use Auto Model

Auto Model is ideal for:

- **Developers who frequently switch between planning and coding** - No need to remember which model works best for each task
- **Teams wanting consistent model selection** - Everyone gets optimal routing without individual configuration
- **Cost-conscious developers** - Automatically balances cost and capability
- **New Kilo Code users** - Great defaults without needing to understand model differences

## When to Use a Specific Model

You may want to select a specific model instead when:

- Cost is not a factor for a particular task
- You need a particular model's unique capabilities (e.g., very long context windows)
- You're working with a specialized provider or local model
- You want full control over model selection

## Feedback

{% callout type="note" title="Help Us Improve" %}
Auto Model is actively being improved. We'd love to hear how it's working for you! Share feedback in our [Discord](https://kilo.ai/discord) or [open an issue on GitHub](https://github.com/Kilo-Org/kilocode/issues).
{% /callout %}

## Related

- [Model Selection Guide](/docs/code-with-ai/agents/model-selection) - General guidance on choosing models
- [Using Agents](/docs/code-with-ai/agents/using-agents) - Learn about different Kilo Code agents
- [Using Kilo for Free](/docs/getting-started/using-kilo-for-free) - Cost-effective alternatives
