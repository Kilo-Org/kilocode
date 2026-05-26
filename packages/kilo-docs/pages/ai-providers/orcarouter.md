---
title: "Using OrcaRouter with Kilo Code | Unified AI API"
description: "Access OpenAI, Anthropic, Google, DeepSeek, Grok, Qwen, Kimi, MiniMax, and Z.ai models through OrcaRouter — an OpenAI-compatible API gateway at provider cost price — by configuring it in Kilo Code. Setup guide for VS Code and the CLI."
sidebar_label: OrcaRouter
---

# Using OrcaRouter With Kilo Code

[OrcaRouter](https://www.orcarouter.ai) is an OpenAI-compatible API gateway that routes requests to OpenAI, Anthropic, Google Gemini, DeepSeek, xAI Grok, Alibaba Qwen, Moonshot Kimi, MiniMax, and Z.ai. Models are reached at the upstream provider's published per-token price; OrcaRouter's revenue comes from optional paid plans, not from inflating token costs.

Because OrcaRouter speaks the OpenAI wire shape, Kilo Code talks to it through `@ai-sdk/openai-compatible` and gets streaming, tool calling, multimodal inputs, and reasoning support out of the box.

**Website:** [https://www.orcarouter.ai](https://www.orcarouter.ai)

## Getting an API Key

1.  **Sign up:** Go to [orcarouter.ai](https://www.orcarouter.ai) and create an account.
2.  **Create a key:** Open the dashboard and generate an API key. Keys start with `sk-orca-`.
3.  **Copy the key:** You will paste it into Kilo Code below.

Kilo Code fetches the OrcaRouter catalog only after you have added an API key (via env var, `kilo auth login`, or `kilo.json`). Once a key is set, OrcaRouter plus the chat-LLM catalog appears in the picker.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode" %}

Open **Settings** (gear icon), go to the **Providers** tab, add OrcaRouter, and enter your API key.

The extension stores this in your `kilo.json` config file. You can also edit the config file directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="CLI" %}

Set the API key as an environment variable or configure it in your `kilo.json` config file:

**Environment variable:**

```bash
export ORCAROUTER_API_KEY="sk-orca-..."
```

**Config file** (`~/.config/kilo/kilo.json` or `./kilo.json`):

```jsonc
{
  "provider": {
    "orcarouter": {
      "env": ["ORCAROUTER_API_KEY"],
    },
  },
}
```

Then set your default model. Model IDs follow OrcaRouter's `<vendor>/<model>` naming:

```jsonc
{
  "model": "orcarouter/anthropic/claude-sonnet-4.6",
}
```

You can also store the key via `kilo auth orcarouter` so it lives in the shared auth store rather than your shell environment.

{% /tab %}
{% /tabs %}

## Supported Capabilities

OrcaRouter is OpenAI-compatible, so the standard Kilo Code feature set works without OrcaRouter-specific configuration:

- **Streaming responses** — token-by-token output for long generations.
- **Tool calling** — both single and parallel tool calls. Kilo Code's built-in tools and any MCP tools you connect work directly.
- **Multimodal inputs** — text and image where the underlying model supports them. The OrcaRouter `/api/pricing` catalog reports `input_modalities` per model and Kilo Code reflects that in the picker.
- **Reasoning effort** — for reasoning-capable models, Kilo Code passes `reasoning_effort: "minimal" | "low" | "medium" | "high"` through OrcaRouter, which then translates it to the upstream's native shape (OpenAI's flat `reasoning_effort`, Anthropic's `thinking` block, Gemini's `thinkingConfig`).

## The `orcarouter/auto` Router

OrcaRouter creates a named router called `auto` for every account on signup. Use it by setting `model` to `orcarouter/auto`:

```jsonc
{
  "model": "orcarouter/auto",
}
```

**Routing strategies.** `auto` runs whichever routing strategy you've selected in the [OrcaRouter dashboard](https://www.orcarouter.ai/console/routing). Four strategies are available:

| Strategy | Behavior |
|---|---|
| `cheapest` | Lowest per-token price among live candidates. Seed default for `auto`. |
| `balanced` | Picks a low-cost option that still meets a quality bar; falls back to the highest-quality option if nothing meets the bar. Default for new routers you create yourself. |
| `quality` | Highest quality score among live candidates, regardless of price. |
| `adaptive` | A per-router contextual bandit (LinUCB) that learns from your real traffic to weigh quality, cost, latency, and reliability. Two sub-modes (Standard / Gated) and a short warm-up phase during which it behaves like `balanced`. |

From the dashboard you can also narrow the candidate pool (e.g. restrict to `openai/*` or to tool-capable models only), set a `default_model` fallback, or create additional named routers like `orcarouter/<your-router-name>` for separate use cases. See [OrcaRouter routing docs](https://docs.orcarouter.ai/routing/auto-router) for the full reference.

**Caveat for agent use.** The default `auto` pool includes every chat model in your account, some of which may not support tool calling. When Kilo Code dispatches a tool-using request, the cheapest pick may then reject it. If you rely on tools, either narrow the `auto` pool to tool-capable models in the dashboard or pin to a specific model (e.g. `orcarouter/openai/gpt-5` or `orcarouter/anthropic/claude-opus-4.7`).

## Disabling OrcaRouter

If you do not want OrcaRouter to load at all, add it to `disabled_providers` in `kilo.json`:

```jsonc
{
  "$schema": "https://app.kilo.ai/config.json",
  "disabled_providers": ["orcarouter"]
}
```

This skips both the model fetch and the provider injection.

## Tips and Notes

- **Model IDs** mirror the upstream — for example `anthropic/claude-sonnet-4.6`, `openai/gpt-5`, `google/gemini-2.5-pro`, `deepseek/deepseek-reasoner`. Use Kilo's model picker (or `Ctrl+X m` in the TUI) to browse the live catalog.
- **Pricing** is reported by `/api/pricing` and shown by Kilo Code's picker; OrcaRouter charges the underlying model's price with no per-token markup.
- **Reasoning models that reject `temperature`.** Some reasoning models (`anthropic/claude-opus-4.7`, OpenAI `o*` family, OpenAI `gpt-5*` family) reject the `temperature` parameter at the upstream. Kilo Code's catalog reflects this — the temperature slider is hidden for those models.
- **Reference:** [OrcaRouter docs](https://docs.orcarouter.ai) cover the full request shape, reasoning controls, routing options, and `extra_body` overrides.
