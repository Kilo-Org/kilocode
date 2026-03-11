---
title: "Model Selection"
description: "Guide to choosing the right AI model for your tasks"
---

# Model Selection Guide

Here's the honest truth about AI model recommendations: by the time I write them down, they're probably already outdated. New models drop every few weeks, existing ones get updated, prices shift, and yesterday's champion becomes today's budget option.

Instead of maintaining a static list that's perpetually behind, we built something better — a real-time leaderboard showing which models Kilo Code users are actually having success with right now.

## Check the Live Models List

**[👉 See what's working today at kilo.ai/models](https://kilo.ai/models)**

This isn't benchmarks from some lab. It's real usage data from developers like you, updated continuously. You'll see which models people are choosing for different tasks, what's delivering results, and how the landscape is shifting in real-time.

## Model Resolution Priority

When Kilo Code determines which model to use for a given task, it follows a specific priority order. This applies to both primary agents (modes) and subagents:

| Priority | Source                          | Description                                                                                                                                                                                           |
| -------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | **Chat session model dropdown** | Selecting a model from the model dropdown in an active chat session overrides all other model settings for that session.                                      |
| 2        | **Mode/subagent model**         | A model explicitly set on the specific mode or subagent you're using. For modes, this is the model configured via Sticky Models. For subagents, this is the `model` field in the agent configuration. |
| 3        | **Global settings model**       | The model configured in your global settings, which applies when no mode-specific model is set.                                                                                                       |
| 4        | **Kilo default**                | If no model is configured at any level, Kilo uses its built-in default (currently Auto Free).                                                                                                         |

{% callout type="tip" title="Quick Model Override" %}
Need to use a different model without changing your saved settings? Use the **model dropdown** to override the current mode's model. That override stays active for the mode until you clear it or restart the extension, so starting a new session does not automatically reset it. 
{% /callout %}

{% callout type="info" title="How Subagents Inherit Models" %}
Built-in subagents (like `general` and `explore`) do **not** have a predefined model. When a primary agent invokes a subagent, the subagent inherits the model from the parent task — meaning it uses whatever model the primary agent is using. You can override this by setting a `model` on the subagent in your configuration. See [Custom Subagents](/docs/customize/custom-subagents#model-inheritance) for details.
{% /callout %}

## General Guidance

While the specifics change constantly, some principles stay consistent:

**For complex coding tasks**: Premium models (Claude Sonnet/Opus, GPT-5 class, Gemini Pro) typically handle nuanced requirements, large refactors, and architectural decisions better.

**For everyday coding**: Mid-tier models often provide the best balance of speed, cost, and quality. They're fast enough to keep your flow state intact and capable enough for most tasks.

**For budget-conscious work**: Newer efficient models keep surprising us with price-to-performance ratios. DeepSeek, Qwen, and similar models can handle more than you'd expect.

**For local/private work**: Ollama and LM Studio let you run models locally. The tradeoff is usually speed and capability for privacy and zero API costs.

## Context Windows Matter

One thing that doesn't change: context window size matters for your workflow.

- **Small projects** (scripts, components): 32-64K tokens works fine
- **Standard applications**: 128K tokens handles most multi-file context
- **Large codebases**: 256K+ tokens helps with cross-system understanding
- **Massive systems**: 1M+ token models exist but effectiveness degrades at the extremes

Check [our provider docs](/docs/ai-providers) for specific context limits on each model.

{% callout type="tip" %}
**Be thoughtful about Max Tokens settings for thinking models.** Every token you allocate to output takes away from space available to store conversation history. Consider only using high `Max Tokens` / `Max Thinking Tokens` settings with modes like Architect and Debug, and keeping Code mode at 16k max tokens or less.
{% /callout %}

{% callout type="tip" %}
**Recover from context limit errors:** If you hit the `input length and max tokens exceed context limit` error, you can recover by deleting a message, rolling back to a previous checkpoint, or switching over to a model with a long context window like Gemini for a message.
{% /callout %}

## Stay Current

The AI model space moves fast. Bookmark [kilo.ai/models](https://kilo.ai/models) and check back when you're evaluating options. What's best today might not be best next month — and that's actually exciting.
