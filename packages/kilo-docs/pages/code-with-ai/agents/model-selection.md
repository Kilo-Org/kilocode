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

## General Guidance

While the specifics change constantly, some principles stay consistent:

### How to Select and Switch Models

{% tabs %}
{% tab label="VSCode" %}

- Use the **model selector** in the chat prompt area to pick a model for the current session. You can also type `/models` to open the model picker.
- When the selected model supports variants, type `/variant` to open the reasoning effort selector.
- Set per-agent defaults and a global default in the **Settings** panel (Models tab), or directly in the `kilo.jsonc` config file.
- **Model precedence:** Session override → Last picked per agent → Per-agent config → Global config → Kilo Auto (free).
- The model selector remembers the last model you picked for each agent — switching agents restores your previous choice. A manual pick always beats config settings; use the **reset button** (visible when your active model differs from config) to go back to the config default.

{% /tab %}
{% tab label="CLI" %}

- In the TUI, use the **model picker** (`Ctrl+X m` or `/models`) to switch models.
- For non-interactive use, pass `--model` flag to `kilo run` (e.g., `kilo run --model claude-sonnet-4-20250514`).
- Set the global default with the `model` key in `kilo.jsonc`, or configure per-agent models in the `agent` section.
- **Model precedence:** `--model` flag → Per-agent config → Last used in session → Global config → Recent models → First available.

{% /tab %}
{% tab label="VSCode (Legacy)" %}

- Use the **model dropdown** in the chat panel to select a model for each conversation.
- Configure **API profiles** in Settings to group provider + model combinations and switch between them quickly.
- Models are **sticky per mode** — each mode (Code, Architect, Debug, etc.) remembers the last model you selected.

{% /tab %}
{% /tabs %}

**For complex coding tasks**: Premium models (Claude Sonnet/Opus, GPT-5 class, Gemini Pro) typically handle nuanced requirements, large refactors, and architectural decisions better.

**For everyday coding**: Mid-tier models often provide the best balance of speed, cost, and quality. They're fast enough to keep your flow state intact and capable enough for most tasks.

**For budget-conscious work**: Newer efficient models keep surprising us with price-to-performance ratios. DeepSeek, Qwen, and similar models can handle more than you'd expect.

**For local/private work**: Ollama and LM Studio let you run models locally. The tradeoff is usually speed and capability for privacy and zero API costs.

**Using an unlisted model?** You can register any model — including fine-tunes, newly released models, or custom local models — by adding it to your config file. See [Custom Models](/docs/code-with-ai/agents/custom-models) for details.

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

## Models During Delegation

When an agent delegates work to a subagent (via the `task` tool), the subagent **inherits the parent agent's model** by default. You can override this per subagent in your config:

{% tabs %}
{% tab label="CLI" %}

```json
{
  "agent": {
    "explore": {
      "model": "anthropic/claude-haiku-4-20250514"
    }
  }
}
```

This sets the `explore` subagent to always use Haiku regardless of the parent's model. Any subagent without a `model` override uses whatever model the invoking agent is running.

{% /tab %}
{% tab label="VSCode" %}

Subagents inherit the model currently active in the primary agent session — the model shown in the selector at the bottom of the chat. To bypass inheritance and pin a specific model for a subagent:

- **Via Settings** — open **Settings → Models → Model per Mode**, find the subagent, and pick its model.
- **Via config file** — edit `kilo.jsonc`:

```json
{
  "agent": {
    "explore": {
      "model": "anthropic/claude-haiku-4-5"
    }
  }
}
```

The Settings UI writes the same `agent.<name>.model` entry, so either method produces the same override. Subagents without an explicit model continue to inherit whatever the invoking agent is running.

{% /tab %}
{% tab label="VSCode (Legacy)" %}

In the legacy extension, each mode has **Sticky Models** — switching from one mode to another (e.g., Code → Architect) uses whatever model you last selected for that mode, not the model from the mode you came from. This means you can assign different models to different modes:

- **Architect:** a reasoning-heavy model (Gemini Pro, Claude Opus)
- **Code:** a fast coding model (Claude Sonnet, GPT-4.1)
- **Debug:** a cost-efficient model (Gemini Flash, DeepSeek)

The model selection is remembered per mode across sessions.

{% /tab %}
{% /tabs %}

For details on configuring subagent models, see [Custom Subagents](/docs/customize/custom-subagents).

## Stay Current

The AI model space moves fast. Bookmark [kilo.ai/models](https://kilo.ai/models) and check back when you're evaluating options. What's best today might not be best next month — and that's actually exciting.
