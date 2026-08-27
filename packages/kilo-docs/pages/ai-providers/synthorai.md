---
title: "Using Synthorai with Kilo Code | OpenAI- and Anthropic-compatible gateway"
description: "Configure Synthorai in Kilo Code as a custom provider — one base URL and one key serve both the OpenAI Chat Completions and Anthropic Messages APIs."
sidebar_label: Synthorai
---

# Using Synthorai With Kilo Code

[Synthorai](https://synthorai.io) is an AI gateway that serves models from Anthropic, OpenAI, Google, DeepSeek, Qwen, Moonshot and Z.ai. It has no dedicated Kilo Code provider — you add it through the **Custom provider** flow described on the [OpenAI Compatible](/docs/ai-providers/openai-compatible) page.

What's worth knowing before you set it up: **the same base URL and the same key serve both wire formats.** `POST /v1/chat/completions` and `POST /v1/messages` answer on the same host, so you can pick either **OpenAI Compatible** or **Anthropic Messages** as the Provider API without changing the URL or issuing a second key.

## Before you begin

1. Create an account at [synthorai.io](https://synthorai.io).
2. Create an API key in the [console](https://synthorai.io/console/api-keys). Copy it immediately — it is shown once.
3. Pick a model id from the [catalog](https://synthorai.io/models/). Ids are **bare, not vendor-prefixed** — `claude-opus-5`, not `anthropic/claude-opus-5`.

## Configure Kilo Code

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** (gear icon) and go to the **Providers** tab.
2. Scroll to the bottom and click **Custom provider**.
3. Fill in the dialog:

- **Provider ID** — `synthorai`
- **Display name** — `Synthorai`
- **Provider API** — **OpenAI Compatible**
- **Base URL** — `https://synthorai.io/v1`
- **API key** — your key

Kilo auto-fetches the model list from `https://synthorai.io/v1/models`, so you should not need to add models by hand.

4. Click **Submit**. The models appear in the model picker.

{% /tab %}
{% tab label="CLI" %}

Set the key as an environment variable:

```bash
export SYNTHORAI_API_KEY="your-api-key"
```

Then declare the provider in `kilo.json`:

```jsonc
{
  "provider": {
    "synthorai": {
      "npm": "@ai-sdk/openai-compatible",
      "env": ["SYNTHORAI_API_KEY"],
      "models": {
        "claude-opus-5": {
          "name": "Claude Opus 5",
          "limit": { "context": 1000000, "output": 128000 },
        },
        "deepseek-v4-pro": {
          "name": "DeepSeek V4 Pro",
          "limit": { "context": 1000000, "output": 393216 },
        },
      },
      "options": {
        "baseURL": "https://synthorai.io/v1",
      },
    },
  },
}
```

Both models above are only examples. `limit.context` and `limit.output` for **any** model
come from the catalog — `max_input_tokens` and `max_output_tokens` at
[https://synthorai.io/api/models](https://synthorai.io/api/models), which is public and needs
no key. Copy the values from there rather than from this page, in case they move.

Then set the default model with the `provider-id/model-id` form:

```jsonc
{
  "model": "synthorai/claude-opus-5",
}
```

{% /tab %}
{% /tabs %}

## Using the Anthropic surface instead

If you would rather Kilo speak the Anthropic Messages format — for Anthropic-native behaviour — create a second custom provider with **Provider API** set to **Anthropic Messages** and the **same** base URL `https://synthorai.io/v1` and the same key.

Note this differs from the plain Anthropic SDK, which takes the host root and appends `/v1/messages` itself. Here the base URL already includes `/v1`.

## Troubleshooting

**404 on every request.** The base URL must end in `/v1`. Kilo appends paths such as `/chat/completions`, so a base URL without it resolves to the wrong path.

**Model not found.** Ids are case-sensitive and bare. Check what your key can reach with:

```bash
curl https://synthorai.io/v1/models -H "Authorization: Bearer $SYNTHORAI_API_KEY"
```

**Models didn't auto-fetch.** Confirm the base URL is exactly `https://synthorai.io/v1` and that the key is valid — an invalid key returns 401 and the list stays empty.
