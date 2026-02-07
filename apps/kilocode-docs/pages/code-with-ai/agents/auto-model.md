---
title: "Auto Model"
description: "Smart model routing that automatically selects the optimal AI model based on your current mode"
---

# Auto Model

Auto Model (`kilo/auto`) is a smart model routing system that automatically selects the optimal AI model based on the Kilo Code mode you're using. It balances cost and capability so you get the best results without manual model switching.

## How It Works

1. Select `kilo/auto` as your model in the model dropdown
2. Start working in any mode (Code, Architect, Debug, etc.)
3. The system automatically routes your requests to the best model for that task

That's it. No configuration needed.

## Mode-to-Model Mapping

Auto Model routes to different models based on the task type:

| Mode           | Model Used        | Best For                     |
| -------------- | ----------------- | ---------------------------- |
| `architect`    | Claude Opus 4.6   | System design, planning      |
| `orchestrator` | Claude Opus 4.6   | Multi-step task coordination |
| `ask`          | Claude Opus 4.6   | Questions, explanations      |
| `plan`         | Claude Opus 4.6   | Planning, reasoning          |
| `general`      | Claude Opus 4.6   | General assistance           |
| `code`         | Claude Sonnet 4.5 | Writing and editing code     |
| `build`        | Claude Sonnet 4.5 | Implementation tasks         |
| `debug`        | Claude Sonnet 4.5 | Debugging and fixing issues  |
| `explore`      | Claude Sonnet 4.5 | Codebase exploration         |

**Planning and reasoning tasks** use Claude Opus 4.6, which excels at complex reasoning, architectural decisions, and breaking down problems.

**Implementation tasks** use Claude Sonnet 4.5, which is optimized for fast, accurate code generation and editing.

## Benefits

### Simplified Setup

No need to manually switch models when changing modes. Auto Model handles the routing transparently in the background.

### Cost Optimization

Uses the more economical Sonnet for implementation tasks where speed matters, while reserving Opus for planning tasks that benefit from deeper reasoning. You get optimal cost-to-capability ratio without thinking about it.

### Best-in-Class Models

Auto Model always routes to Claude's latest and most capable models:

- **Claude Opus** for reasoning-intensive tasks
- **Claude Sonnet** for implementation-focused tasks

## Requirements

{% callout type="warning" title="Version Requirements" %}
Auto Model requires **VS Code/JetBrains extension v5.2.3+** or **CLI v1.0.15+** for automatic mode-based switching. On older versions, `kilo/auto` will default to Claude Sonnet for all requests.
{% /callout %}

## Getting Started

{% callout type="tip" title="Quick Setup" %}
Select `kilo/auto` from the model dropdown in the Kilo Code chat interface. That's all you need to do.
{% /callout %}

1. Open Kilo Code in VS Code or JetBrains
2. Click the model selector dropdown
3. Choose `kilo/auto`
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
Auto Model is a new feature and we're actively improving it. We'd love to hear how it's working for you! Share feedback in our [Discord](https://discord.gg/kilocode) or [open an issue on GitHub](https://github.com/Kilo-Org/kilocode/issues).
{% /callout %}

## Related

- [Model Selection Guide](/docs/code-with-ai/agents/model-selection) - General guidance on choosing models
- [Using Modes](/docs/code-with-ai/agents/using-modes) - Learn about different Kilo Code modes
- [Free & Budget Models](/docs/code-with-ai/agents/free-and-budget-models) - Cost-effective alternatives
