---
title: "Using Kilo for Free"
description: "Learn how to use Kilo Code without spending money by configuring free models for agentic tasks, autocomplete, and CLI background tasks"
---

# Using Kilo for Free

Kilo Code can be used completely free of charge, but you need to understand where Kilo uses AI models and configure each one appropriately.

## When Kilo Uses Model Inference

Kilo uses AI model inference in three places:

1. **Agentic interactions** - Coding assistant conversations in IDE extensions (VS Code, JetBrains), CLI, and cloud services like App Builder and Code Reviewer
2. **Autocomplete** - In-editor code completions as you type (IDE extensions only)
3. **CLI Background tasks** - Automatic session titles and context summarization (CLI only)

Each of these can consume credits by default. **For a completely free Kilo experience, you must configure all three to use free models.**

## Free Agentic Usage

Kilo Code provides access to free models for your coding tasks through the Kilo Gateway and partner providers.

### Finding Free Models

Free models are clearly labeled in the model picker across all Kilo platforms. To find and use them:

**In the IDE Extensions (VS Code, JetBrains):**

1. Click on the current model below the chat window
2. Browse the model list—free models are labeled as "(free)"
3. Select your preferred free model

**In the CLI:**

1. Open the CLI by running `kilo`
2. Use the `/models` command to browse available models
3. Free models are labeled as "free"
4. Select a free model for your tasks

### Free Models for Cloud Tasks

Kilo's cloud services—including App Builder, Code Reviewer, and other cloud-based features—also support free models. When configuring a cloud task:

1. Look for the model selection dropdown
2. Free models are labeled as "(free)" in the dropdown
3. Select any free model to avoid using credits

{% callout type="tip" %}
The available free models change over time as Kilo partners with different AI inference providers. Subscribe to our blog, join our Discord, and check the model picker regularly to see current free options.
{% /callout %}

## Free Autocomplete

Kilo Code's autocomplete feature provides AI-powered code completions as you type in the IDE extensions.

### Default Behavior

By default, autocomplete is routed through the Kilo Code provider and uses credits from your account.

### If You Don't Have Credits

If you run out of credits and haven't configured a free alternative, autocomplete will stop working. Your main coding workflow won't be affected -- you just won't get AI-powered completions.

### How to Get It Free

Configure Mistral directly as your autocomplete provider. Mistral offers free access to their Codestral model, which is optimized for code completions. When you configure Mistral directly, it takes precedence over the default Kilo Code routing.

For step-by-step instructions with screenshots, see our [Mistral Setup Guide](/docs/code-with-ai/features/autocomplete/mistral-setup).

## Free CLI Background Tasks

The Kilo CLI uses AI in the background for quality-of-life features that enhance your experience like context compression and titling sessions.

### Default Behavior

By default, CLI background tasks use `gpt-5-nano`, which consumes credits.

### If You Don't Have Credits

Background tasks degrade gracefully when you don't have credits:

- **Session titles** fall back to truncating your first message instead of generating a smart summary
- **Context management** uses simple truncation instead of intelligent summarization
- **Your main workflow continues uninterrupted** - these are convenience features, not requirements

### How to Get It Free

Configure the `small_model` parameter in `~/.kilocode/config.json` to use a free model:

```json
{
	"small_model": "your-preferred-free-model"
}
```

Replace `your-preferred-free-model` with any free model available in the model picker.

## Related Resources

- [Mistral Setup Guide](/docs/code-with-ai/features/autocomplete/mistral-setup) - Step-by-step free autocomplete setup
- [Autocomplete](/docs/code-with-ai/features/autocomplete) - Full autocomplete documentation
- [CLI Documentation](/docs/code-with-ai/platforms/cli) - Complete CLI reference
