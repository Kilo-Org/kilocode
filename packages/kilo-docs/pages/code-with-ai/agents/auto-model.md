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

You can see which underlying models are used, as well as the cost, in the expanded model picker. Model mapping information is also available on the [Gateway Model page](/docs/gateway/models-and-providers#kilo-autofrontier).

## Tiers

- **Frontier** — Routes to the latest and most capable paid models. Uses different models for reasoning-heavy tasks (planning, architecture, debugging) versus implementation tasks (coding, building, exploring), pairing the right capability to each type of work.
- **Balanced** — Follows the same mode-based routing structure as Frontier but uses a more cost-effective model across all modes. A good default for most developers who want strong AI assistance without paying frontier prices.
- **Free** — Routes to the best available free model on OpenRouter. Because free model availability shifts over time as providers change promotional periods, the mapping is updated server-side — you always get the best free option without having to track what's currently available. Quality will be lower than paid tiers, and the model may change over time.

## Benefits

### Cost Optimization

Automatically uses the best model for a given task, selecting the best balance of cost and capability for a given task. Uses the more economical models for more straight forward tasks, while reserving stronger reasoning models for planning tasks. You get optimal cost-to-capability ratio without thinking about it.

### No Configuration Required

No need to manually switch models when changing modes. Auto Model handles routing transparently in the background.

### Flexible Cost Control

Pick the tier that fits your budget. Frontier gives you the best models for demanding work; Balanced offers capable models at a fraction of the cost; Free costs nothing.

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
