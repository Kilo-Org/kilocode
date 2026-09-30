---
title: "Using ainetcafe with Kilo Code | Kimi K3 on a Dedicated Cluster"
description: "Run Kimi K3 through ainetcafe's OpenAI-compatible API in Kilo Code. Setup guide for VS Code and the CLI."
sidebar_label: ainetcafe
---

# Using ainetcafe With Kilo Code

ainetcafe serves Kimi K3 from its own cluster at the model's released MXFP4 precision, with tool calling, image input, prompt caching and a 256K context by default (1M on request). It exposes an OpenAI-compatible API at `https://microquickjs.com/v1` and an Anthropic-compatible API at `https://microquickjs.com`.

**Website:** [https://ainetcafe.com/k3/](https://ainetcafe.com/k3/)

## Getting an API Key

1. **Sign Up/Sign In:** Go to [ainetcafe](https://microquickjs.com/register?lng=en) and create an account or sign in. New accounts receive a small sign-up credit.
2. **Navigate to Token Management:** Open **Token Management** in the console.
3. **Create a Key:** Click **Create token**, give it a name (e.g., "Kilo Code"), and copy it. The key starts with `sk-`.

## Configuration in Kilo Code

ainetcafe is configured as a custom OpenAI-compatible provider.

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** (gear icon) and go to the **Providers** tab.
2. Scroll to the bottom and click **Custom provider**.
3. Fill in the dialog:
   - **Provider ID:** `ainetcafe`
   - **Display name:** `ainetcafe`
   - **Provider API:** **OpenAI Compatible**
   - **Base URL:** `https://microquickjs.com/v1`
   - **API key:** your ainetcafe key
   - **Models:** pick `Kimi-K3` from the auto-fetched list (Kilo reads `/v1/models`).
4. Click **Submit** and select `Kimi-K3` in the model picker.

{% /tab %}
{% tab label="CLI" %}

Set your API key as an environment variable and add ainetcafe to your `kilo.json` config file (`~/.config/kilo/kilo.json` or `./kilo.json`). The `env` field tells Kilo which variable holds the key, so the key itself never goes into the file:

```bash
export AINETCAFE_API_KEY="your-api-key"
```

```jsonc
{
  "provider": {
    "ainetcafe": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "ainetcafe",
      "env": ["AINETCAFE_API_KEY"],
      "options": {
        "baseURL": "https://microquickjs.com/v1",
      },
      "models": {
        "Kimi-K3": {
          "name": "Kimi K3",
          "limit": {
            "context": 262144,
            "output": 32768,
          },
        },
      },
    },
  },
  "model": "ainetcafe/Kimi-K3",
}
```

{% /tab %}
{% /tabs %}

## Models

- `Kimi-K3` — Kimi K3, 256K context by default (1M available per account on request), text and image input, tool calling, reasoning.

The model ID is case-sensitive.

## Tips and Notes

- **Reasoning:** K3 thinks before it answers; the first token on a large repository can take a few seconds, then output streams normally. Reasoning is returned as `reasoning_content` and does not count against the visible output. The depth can be set with `reasoning_effort` (`low`, `high`, `max`).
- **Prompt caching:** On by default. Repeated context in long agent sessions is billed at the cached-input rate.
- **Pricing and status:** Current per-token pricing, a live availability probe and a comparison with other K3 providers are published at [ainetcafe.com/k3](https://ainetcafe.com/k3/).
- **Anthropic protocol:** If you prefer the Anthropic Messages API, use **Anthropic Messages** as the Provider API with base URL `https://microquickjs.com` and the same key.
