---
title: "Using JZSTOKEN with Kilo Code"
description: "Configure JZSTOKEN in Kilo Code through its OpenAI-compatible API."
sidebar_label: JZSTOKEN
---

# Using JZSTOKEN With Kilo Code

JZSTOKEN exposes an OpenAI-compatible Chat Completions API at `https://jzstoken.com/api/v1`. You can use its models from Kilo Code by configuring a custom OpenAI Compatible provider.

**Website:** [https://jzstoken.com](https://jzstoken.com)

## Getting an API Key

1. Sign in to the [JZSTOKEN dashboard](https://jzstoken.com/dashboard/keys).
2. Create a Standard key for general use.
3. Copy the key when it is displayed.

A key created for `jzs-max-3.0` only exposes that model. Use a Standard key to access other models.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VS Code" %}

1. Open **Settings** (gear icon) and go to the **Providers** tab.
2. Scroll to the bottom and select **Custom provider**.
3. Enter `jzstoken` as the provider ID and `JZSTOKEN` as the display name.
4. Select **OpenAI Compatible** as the provider API.
5. Set the base URL to `https://jzstoken.com/api/v1`.
6. Enter the API key and select **Fetch models**.
7. Select a model and submit the provider.

{% /tab %}
{% tab label="CLI" %}

Set the API key as an environment variable:

```bash
export JZSTOKEN_API_KEY="your-api-key"
```

Add the provider to `kilo.json` or `kilo.jsonc`:

```jsonc
{
  "provider": {
    "jzstoken": {
      "npm": "@ai-sdk/openai-compatible",
      "env": ["JZSTOKEN_API_KEY"],
      "models": {
        "claude-sonnet-5": {
          "name": "Claude Sonnet 5",
          "limit": {
            "context": 1000000,
            "output": 32000
          }
        }
      },
      "options": {
        "baseURL": "https://jzstoken.com/api/v1"
      }
    }
  },
  "model": "jzstoken/claude-sonnet-5"
}
```

JZSTOKEN publishes the 1M context window for `claude-sonnet-5` but does not currently publish a per-model maximum output limit. The example uses a conservative 32K output limit. Update the `limit` values when JZSTOKEN publishes a maximum output value for the model you use.

{% /tab %}
{% /tabs %}

## Common Models

Select model IDs from the [JZSTOKEN model catalog](https://jzstoken.com/model-pricing). The catalog includes models from Anthropic, OpenAI, Google, DeepSeek, Moonshot, and other providers.

## Tips and Notes

- JZSTOKEN supports OpenAI Chat Completions on `https://jzstoken.com/api/v1`.
- Use the model ID exactly as shown in the JZSTOKEN catalog.
- Set `limit.context` and `limit.output` for each configured model so Kilo Code can manage context correctly.
