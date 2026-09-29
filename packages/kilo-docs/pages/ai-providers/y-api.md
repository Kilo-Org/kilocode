---
title: "Using Y-API with Kilo Code"
description: "Configure Y-API in Kilo Code as a custom OpenAI-compatible provider, with the base URL, API key variable, and verbatim vendor/model IDs it expects."
sidebar_label: Y-API
---

# Using Y-API With Kilo Code

[Y-API](https://y-api.bestvirtualgoods.com) is an OpenAI-compatible gateway that serves models from several vendors behind one API key. Kilo Code has no built-in `y-api` provider, so you add it as a custom provider: base URL `https://api.y-api.bestvirtualgoods.com/v1`, key read from `Y_API_API_KEY`.

Y-API model IDs are themselves in `vendor/model` form, so a full reference in Kilo has three segments: `y-api/<vendor>/<model>`.

## Before you begin

1. Create an account at [y-api.bestvirtualgoods.com](https://y-api.bestvirtualgoods.com).
2. Create an API key in your Y-API console.
3. Choose a model ID. The catalog is a public JSON file that needs no authentication, at [models.json](https://y-api.bestvirtualgoods.com/models.json). Copy each ID byte for byte: it is case-sensitive and carries the `vendor/` prefix.

## Configure Kilo Code

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** (gear icon) and go to the **Providers** tab.
2. Scroll to the bottom and click **Custom provider**.
3. Fill in the dialog:
   - **Provider ID** — `y-api`
   - **Display name** — `Y-API`
   - **Provider API** — **OpenAI Compatible**
   - **Base URL** — `https://api.y-api.bestvirtualgoods.com/v1`
   - **API key** — your Y-API key
   - **Models** — add IDs exactly as [models.json](https://y-api.bestvirtualgoods.com/models.json) returns them, for example `deepseek/deepseek-v4-pro`. With a valid base URL and key, Kilo can also fetch the list from the endpoint for you.
4. Click **Submit**. The models appear in the model picker.

{% /tab %}
{% tab label="CLI" %}

Keep the key in the environment and declare the provider in `~/.config/kilo/kilo.json` or `./kilo.json`, so the secret never lands in the project file:

```bash
export Y_API_API_KEY="your-api-key"
```

```jsonc
{
  "provider": {
    "y-api": {
      "npm": "@ai-sdk/openai-compatible",
      "env": ["Y_API_API_KEY"],
      "options": {
        "baseURL": "https://api.y-api.bestvirtualgoods.com/v1",
      },
      "models": {
        "deepseek/deepseek-v4-pro": {
          "name": "DeepSeek V4 Pro",
        },
        "z-ai/glm-5.3": {
          "name": "GLM 5.3",
        },
      },
    },
  },
  "model": "y-api/deepseek/deepseek-v4-pro",
}
```

{% /tab %}
{% /tabs %}

## Model IDs

Every ID takes its vendor prefix. The prefixes in the catalog are `deepseek/`, `qwen/`, `z-ai/`, `moonshotai/`, `minimax/`, `anthropic/`, `openai/`, `tencent/`, and `xiaomi/`. Examples, in the `provider/model` form Kilo expects:

```jsonc
{
  "model": "y-api/qwen/qwen3.8-flash",
}
```

```jsonc
{
  "model": "y-api/moonshotai/kimi-k3",
}
```

```jsonc
{
  "model": "y-api/anthropic/claude-sonnet-5",
}
```

A model absent from [models.json](https://y-api.bestvirtualgoods.com/models.json) is not served. Do not rely on a static list in this page or in your config; read the catalog before you add an ID.

## Using the Anthropic Messages endpoint

Alongside OpenAI Chat Completions, Y-API serves the Anthropic Messages protocol at `/v1/messages`. A provider ID maps to one protocol package, so declare a second ID for it rather than changing the first:

```jsonc
{
  "provider": {
    "y-api-anthropic": {
      "npm": "@ai-sdk/anthropic",
      "env": ["Y_API_API_KEY"],
      "options": {
        "baseURL": "https://api.y-api.bestvirtualgoods.com/v1",
      },
      "models": {
        "anthropic/claude-opus-5": {
          "name": "Claude Opus 5",
        },
      },
    },
  },
  "model": "y-api-anthropic/anthropic/claude-opus-5",
}
```

The published OpenAPI description at [openapi.json](https://y-api.bestvirtualgoods.com/openapi.json) lists `/chat/completions`, `/messages`, and `/models`. It does not list a token-counting endpoint, so a workflow that depends on one should use the `y-api` Chat Completions provider ID instead.

## Cost tracking

Kilo Code estimates spend from the `cost` block on each model, whose `input` and `output` are USD per million tokens. It has no rates for a provider it does not already know, so its estimate for Y-API stays at zero until you declare `cost` on each model you use.

Y-API publishes its rates as account credit per million tokens at [pricing.json](https://y-api.bestvirtualgoods.com/pricing.json), together with the credit-to-USD conversion rate in the same file. Read both from that file and divide the credit figure by the conversion rate to get the `cost` value. The file states which rate is currently in force, and the rate changes, so no figures are copied into this page.

Declare `limit` if you want the context gauge to be right. Kilo defaults it to zero for a model it does not know, and [models.json](https://y-api.bestvirtualgoods.com/models.json) does not carry context sizes, so take those from the [Y-API docs](https://y-api.bestvirtualgoods.com/docs).

## Troubleshooting

- **Model not found:** copy the ID exactly as [models.json](https://y-api.bestvirtualgoods.com/models.json) returns it, including the `vendor/` prefix. An ID that is not in the catalog is not served.
- **Model list does not load:** the live catalog `GET https://api.y-api.bestvirtualgoods.com/v1/models` requires a key. Use `models.json`, which needs none, or enter the key in the custom provider dialog.
- **Spend stays at zero:** add a `cost` block with `input` and `output` to each model you use, as described above.
- **Provider is not in the list:** Y-API is not built in. Use **Custom provider**.
- **A model you just added is missing:** restart Kilo Code, then check the ID against [models.json](https://y-api.bestvirtualgoods.com/models.json).

{% callout type="note" %}
This documentation was contributed by Y-API, the provider it describes. It documents configuration fields and the published catalog files; no requests were sent to the API as part of writing it.
{% /callout %}
