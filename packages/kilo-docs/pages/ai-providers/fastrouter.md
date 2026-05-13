---
title: "Using FastRouter with Kilo Code | Unified AI API"
description: "Access models from Anthropic, OpenAI, Google, and more through FastRouter — an OpenRouter-compatible AI gateway — by configuring it in Kilo Code. Setup guide for VS Code and the CLI."
sidebar_label: FastRouter
---

# Using FastRouter With Kilo Code

[FastRouter](https://fastrouter.ai) is an OpenRouter-compatible AI gateway that routes requests to many model providers (Anthropic, OpenAI, Google, Mistral, and more) through a single API. Because it speaks the same wire format as OpenRouter, Kilo Code talks to it through the same Vercel AI SDK and supports streaming, tool calling, multimodal inputs, and reasoning out of the box.

**Website:** [https://fastrouter.ai](https://fastrouter.ai)

## Getting an API Key

1.  **Sign up:** Go to the [FastRouter dashboard](https://go.fastrouter.ai) and create an account.
2.  **Create a key:** Generate an API key from the keys page.
3.  **Copy the key:** You will paste it into Kilo Code below.

The model catalog at [`https://go.fastrouter.ai/api/v1/models`](https://go.fastrouter.ai/api/v1/models) is public — Kilo Code fetches it without an API key, so the FastRouter provider and its models always show up in the picker. The key is only used for chat completions.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode" %}

Open **Settings** (gear icon), go to the **Providers** tab, add FastRouter, and enter your API key.

The extension stores this in your `kilo.json` config file. You can also edit the config file directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="CLI" %}

Set the API key as an environment variable or configure it in your `kilo.json` config file:

**Environment variable:**

```bash
export FASTROUTER_API_KEY="your-api-key"
```

**Config file** (`~/.config/kilo/kilo.json` or `./kilo.json`):

```jsonc
{
  "provider": {
    "fastrouter": {
      "env": ["FASTROUTER_API_KEY"],
    },
  },
}
```

Then set your default model:

```jsonc
{
  "model": "fastrouter/anthropic/claude-sonnet-4-5",
}
```

You can also store the key via `kilo auth fastrouter` so it lives in the shared auth store rather than your shell environment.

{% /tab %}
{% /tabs %}

## Supported Capabilities

Because FastRouter mirrors the OpenRouter API surface, all of the following work without any FastRouter-specific configuration:

- **Streaming responses** — token-by-token output for long generations.
- **Tool calling** — both single and parallel tool calls. Kilo Code's built-in tools and any MCP tools you connect work directly.
- **Multimodal inputs** — text, image, audio, video, and PDF where the underlying model supports them. The FastRouter `/models` catalog reports the supported modalities per model and Kilo Code reflects that in the picker.
- **Reasoning effort** — for reasoning-capable models, Kilo Code passes `reasoning: { effort: "minimal" | "low" | "medium" | "high" }` through to FastRouter the same way it does for OpenRouter.

## Provider-Routing Options

FastRouter accepts the same `provider` routing fields as OpenRouter (sort, order, only, data_collection, zdr). To pass them through, set them on the model's `options` in `kilo.json` — anything under `options` is forwarded verbatim:

```jsonc
{
  "provider": {
    "fastrouter": {
      "models": {
        "anthropic/claude-sonnet-4-5": {
          "options": {
            "provider": {
              "sort": "price",
              "order": ["Anthropic", "Google"],
              "only": ["Anthropic"]
            }
          }
        }
      }
    }
  }
}
```

Refer to the FastRouter docs at [https://docs.fastrouter.ai](https://docs.fastrouter.ai) for the full list of accepted fields — Kilo Code does not validate them, so any future option works the moment FastRouter ships it.

## Disabling FastRouter

If you do not want FastRouter to load at all, add it to `disabled_providers` in `kilo.json`:

```jsonc
{
  "$schema": "https://app.kilo.ai/config.json",
  "disabled_providers": ["fastrouter"]
}
```

This skips both the model fetch and the provider injection.

## Tips and Notes

- **Model IDs** mirror the underlying provider — for example `anthropic/claude-sonnet-4-5`, `openai/gpt-5`, `google/gemini-2.0-pro`. Use `kilo` model picker (or `Ctrl+X m` in the TUI) to browse the live catalog.
- **Pricing** is reported by the `/models` endpoint and shown by Kilo Code's picker; FastRouter charges the underlying model's price.
- **Cache control** uses the OpenRouter-compatible `prompt_cache_key` automatically; you do not need to configure anything.
