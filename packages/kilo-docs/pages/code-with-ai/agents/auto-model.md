---
title: "Auto Model"
description: "Smart model routing that selects an AI model for each Auto Model tier"
---

# Auto Model

Auto Model is a smart routing system that selects an underlying model for each request. Each tier uses its own routing strategy so you can balance cost and capability to fit your needs.

| Tier | Best For | Pricing |
|---|---|---|
| `kilo-auto/efficient` | Lowest cost per task, with capability matched to difficulty | Paid |
| `kilo-auto/frontier` | Maximum capability with the best available models | Paid |
| `kilo-auto/balanced` | Strong performance at a lower cost | Paid |
| `kilo-auto/free` | The best free models available | Free |

## How It Works

1. Select an Auto Model tier (e.g. `kilo-auto/frontier`) in the model dropdown
2. Start working in any mode (Code, Architect, Debug, etc.)
3. The system automatically selects the model for your chosen tier

That's it. No configuration needed.

You can see which underlying models are used, as well as the cost, in the expanded model picker. Model mapping information is also available on the [Gateway Model page](/docs/gateway/models-and-providers#kilo-autofrontier).

{% callout type="info" title="Models can change" %}
The underlying models behind each Auto Model tier are updated server-side as better options become available or as providers change pricing and availability. The tier you select stays the same; the model it routes to may change over time.
{% /callout %}

## Auto Efficient

Session-aware routing that classifies the difficulty of each request in real time and routes it to the cheapest model proven accurate enough for that task, based on Kilo's continuously-run benchmarks. Routine work stays lean while harder tasks get a more capable model. Because it watches your session in context, it keeps using a model across related turns and only switches when a cheaper option is clearly worth it. If a routing decision can't be made, it falls back to the Balanced tier, so quality never drops below Balanced.

#### How Auto Efficient routing works

1. Kilo observes your coding session in context
2. It classifies each task by complexity
3. It routes to the benchmark-proven best model for that task automatically

You get lean costs on routine work and stronger models when the work demands it — with no manual switching.

#### Further Configuration

You can configure how Auto Efficient ranks models, prioritizing either best accuracy per dollar or best accuracy. For individuals, this is configured in the [Kilo Dashboard](https://app.kilo.ai). For Enterprise customers, this is configured in the **Model Access** tab of the dashboard.

{% image src="/docs/img/auto-model/dashboard-configuration.png" alt="Auto Efficient configuration in the Kilo Dashboard" width="800" /%}

#### Usage Visibility

To view the models used by Auto Efficient, go to the [Kilo Dashboard](https://app.kilo.ai), navigate to the **Usage** tab, and scroll to the **Models** section.

## Auto Frontier

Routes to the latest and most capable paid models. It uses different models for reasoning-heavy tasks such as planning, architecture, and debugging versus implementation tasks such as coding, building, and exploring, pairing the right capability to each type of work.

## Auto Balanced

Routes to a cost-effective model for all modes. The specific model is selected based on the API interface in use, but does not vary by mode. It is a good default for most developers who want strong AI assistance without paying frontier prices.

## Auto Free

Routes to the best available free models on OpenRouter, splitting traffic across them. Because free model availability shifts over time as providers change promotional periods, the mapping is updated server-side, so you always get the best free option without having to track what is currently available. Quality is lower than paid tiers, and the models may change over time.

{% callout type="warning" title="Data handling for Auto Free" %}
Auto Free may route your requests to providers that log prompts and outputs and use them to improve their services. Do not submit personal or confidential data when using Auto Free. In particular, it may route to NVIDIA's free endpoints.

For NVIDIA free endpoints (Super/Ultra/etc): Trial use only - do not submit personal or confidential data. Your use is logged for security purposes and to improve NVIDIA products and services. The logged session data for improvement purposes is not linked to your identity or any persistent identifier. For more information about our data processing practices, see our [Privacy Policy](https://www.nvidia.com/en-us/about-nvidia/privacy-policy/). By interacting with this endpoint, you consent to our collection, recording, and use of such information and the [NVIDIA API Trial Terms of Service](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf).
{% /callout %}

## Benefits

### Cost Optimization

Automatically uses the best model for a given task, selecting the best balance of cost and capability for a given task. Uses the more economical models for more straightforward tasks, while reserving stronger reasoning models for planning tasks. You get optimal cost-to-capability ratio without thinking about it.

### No Configuration Required

No need to manually switch models when changing modes. Auto Model handles routing transparently in the background.

### Flexible Cost Control

Pick the tier that fits your budget. Frontier gives you the best models for demanding work; Balanced offers capable models at a fraction of the cost; Efficient minimizes cost per task by matching model capability to task difficulty; Free costs nothing.

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
