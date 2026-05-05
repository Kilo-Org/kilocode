---
title: "Using Kilo for Free"
description: "How to use Kilo Code for free — Auto Free, finding free models, free autocomplete, and free background tasks"
---

# Using Kilo for Free

Kilo Code can be used completely free of charge. There are three places where Kilo uses AI model inference, and each can be configured to use free models.

## Where Kilo Uses Models

1. **Agentic interactions** — Conversations with coding agents in IDE extensions (VS Code, JetBrains), CLI, and cloud services like App Builder and Code Reviewer
2. **Autocomplete** — In-editor code completions as you type (IDE extensions only)
3. **Background tasks** — Automatic session titles and context summarization

Each of these consumes credits by default. **To use Kilo entirely for free, configure all three to use free models.**

## Free Agentic Usage

Kilo provides free models for coding tasks through the Kilo Gateway and partner providers.

### Auto Free

The easiest way to get started is [**Auto Free**](/docs/code-with-ai/agents/auto-model) (`kilo-auto/free`). This is a Kilo-provided model tier that automatically routes your requests to the best available free models — no configuration needed.

{% callout type="warning" title="Data handling for Auto Free" %}
Auto Free may route your requests to providers that log prompts and outputs and use them to improve their services — including NVIDIA's free endpoints, which are provided under the [NVIDIA API Trial Terms of Service](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf) (trial use only, not for production or sensitive data). Do not submit personal or confidential data when using Auto Free.
{% /callout %}

### Finding Other Free Models

You can also browse and select individual free models. In the model picker, type `free` to filter the list — free models are clearly labeled across all platforms.

**In the IDE Extensions (VS Code, JetBrains):**

1. Click on the current model below the chat window
2. Type `free` in the search box
3. Select any model labeled "(free)"

**In the CLI:**

1. Run `kilo` to open the CLI
2. Use the `/models` command
3. Type `free` to filter the list

{% callout type="note" %}
Some free models may be rate limited by the upstream provider. If you hit a rate limit, try switching to a different free model.
{% /callout %}

### Cloud Tasks

Kilo's cloud services — App Builder, Code Reviewer, and others — also support free models. Select any model labeled "(free)" in the model dropdown when configuring a cloud task.

{% callout type="tip" %}
Available free models change over time as Kilo partners with different inference providers. Subscribe to our blog or join our [Discord](https://kilo.ai/discord) for updates.
{% /callout %}

## Free Autocomplete

Kilo's autocomplete feature provides AI-powered code completions as you type in IDE extensions.

By default, autocomplete routes through the Kilo provider and uses credits. If you run out of credits without a free alternative configured, autocomplete stops working — but your main coding workflow is unaffected.

### How to Get It Free

Add your own Mistral AI (Codestral) API key via **BYOK (Bring Your Own Key)** on the Kilo Gateway. Mistral offers a free tier for Codestral. When you configure a BYOK key, autocomplete requests use your key directly — at no cost on your Kilo balance.

See the [Mistral Setup Guide](/docs/code-with-ai/features/autocomplete/mistral-setup) for step-by-step instructions.

## Free Background Tasks

Kilo uses a small model in the background for tasks like session titling. By default this is Auto Small, which consumes credits. If the small model is unavailable, Kilo falls back to your primary model — which may also consume credits if it's a paid model.

To avoid credit usage for background tasks, set the small model to a free model:

**In the VS Code extension:** Go to **Settings → Models** and change the small model to any free model.

**In the CLI:** Set the `small_model` parameter in `~/.config/kilo/config.json`:

```json
{
  "small_model": "your-preferred-free-model"
}
```

Replace `your-preferred-free-model` with any free model from the model picker.

## Related Resources

- [Auto Model](/docs/code-with-ai/agents/auto-model) — Smart model routing including the free tier
- [Mistral Setup Guide](/docs/code-with-ai/features/autocomplete/mistral-setup) — Free autocomplete via BYOK
- [Autocomplete](/docs/code-with-ai/features/autocomplete) — Full autocomplete documentation
- [CLI Documentation](/docs/code-with-ai/platforms/cli) — Complete CLI reference
