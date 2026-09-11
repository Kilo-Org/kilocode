---
title: "Using MindsHub with Kilo Code"
description: "Route AI model requests through MindsHub, an OpenAI/Anthropic-compatible inference gateway, in Kilo Code with a single API key."
sidebar_label: MindsHub
---

# Using MindsHub With Kilo Code

MindsHub is a fully OpenAI/Anthropic-compatible LLM inference gateway: one API key and one bill
reach any model in its catalog — Claude, GPT, Kimi, DeepSeek, Gemini, Grok, and more — through the
OpenAI Chat Completions, OpenAI Responses, or Anthropic Messages wire formats. Kilo Code talks to it
with the built-in MindsHub provider.

**Website:** [https://mindshub.ai](https://mindshub.ai)
**Docs:** [https://docs.mindshub.ai/inference/](https://docs.mindshub.ai/inference/)

## Getting an API Key

1. Sign in to the [MindsHub console](https://console.mindshub.ai).
2. Create an API key and copy it.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) inside the Kilo Code extension and go to the **Providers** tab to add
MindsHub and enter your API key. If you don't see MindsHub listed, click **Show more providers**.

The extension stores this in your `kilo.json` config file. You can also edit the config file
directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="CLI" %}

Set the API key as an environment variable or configure it in your `kilo.json` config file:

**Environment variable:**

```bash
export MINDSHUB_API_KEY="your-api-key"
```

**Config file** (`~/.config/kilo/kilo.json` or `./kilo.json`):

```jsonc
{
  "provider": {
    "mindshub": {
      "env": ["MINDSHUB_API_KEY"],
    },
  },
}
```

Then set your default model to one of MindsHub's catalog aliases:

```jsonc
{
  "model": "mindshub/sonnet",
}
```

{% /tab %}
{% /tabs %}

## Supported Models

Kilo Code fetches the live model list from `GET https://api.mindshub.ai/v1/models`, so any alias
enabled on your account shows up in the model picker automatically. Common aliases from the
[catalog](https://docs.mindshub.ai/inference/models) include:

- `mindshub/sonnet` — Claude Sonnet 5
- `mindshub/opus` — Claude Opus 5
- `mindshub/gpt` — GPT 5.6 Sol
- `mindshub/gpt-codex` — GPT 5.3 Codex
- `mindshub/kimi` — Kimi K3
- `mindshub/deepseek` — DeepSeek V4-Pro-0813
- `mindshub/mindshub_air` — MindsHub Air, covered by monthly included tokens

Always check `GET /v1/models` or the [models page](https://docs.mindshub.ai/inference/models) for the
current, authoritative list — aliases can move to a newer underlying model without notice.

## Tips and Notes

- **One key, any wire format.** The same MindsHub key also works for [Claude Code and OpenAI
  Codex](https://docs.mindshub.ai/inference/coding-agents) directly, and for the Anthropic Messages
  API, if you want to point other tools at MindsHub alongside Kilo Code.
- **Streaming, tool calling, and image input** are all supported, following the OpenAI-compatible
  Chat Completions contract.
- **Reasoning effort.** Some aliases accept a `reasoning_effort` level (`low` through `max`); see
  [Reasoning effort](https://docs.mindshub.ai/inference/models#reasoning-effort) for which models
  support it.
- **Custom base URL.** If you're routed through a proxy, override it with
  `provider.mindshub.options.baseURL` in `kilo.json` or the `MINDSHUB_BASE_URL` environment variable.
