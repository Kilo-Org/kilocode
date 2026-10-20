---
title: "Using RouterPlex with Kilo Code"
description: "Connect Kilo Code to RouterPlex, a hosted OpenAI-compatible gateway with a prepaid balance and per-key USD budgets, using a custom provider."
sidebar_label: RouterPlex
---

# Using RouterPlex With Kilo Code

[RouterPlex](https://routerplex.com) is a hosted gateway that exposes models from several vendors through one OpenAI-compatible API at `https://api.routerplex.com/v1`. It also serves the Anthropic Messages format. Models are billed at vendor list price with no top-up fee, from a prepaid balance that does not go negative.

**Website:** [https://routerplex.com](https://routerplex.com)

RouterPlex is configured in Kilo Code as a custom OpenAI-compatible provider. The steps below follow the general [OpenAI Compatible](/docs/ai-providers/openai-compatible) setup.

## Getting an API key

1. Sign in to the [RouterPlex dashboard](https://routerplex.com/dashboard).
2. Add credit from the billing page. Top-ups accept card or crypto.
3. Create an API key and copy it. You can set a hard USD budget and a model allowlist on each key, so a runaway agent loop cannot spend more than that key's cap.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** (gear icon) and go to the **Providers** tab.
2. Scroll to the bottom and click **Custom provider**.
3. Fill in the dialog:
   - **Provider ID** - `routerplex`
   - **Display name** - `RouterPlex`
   - **Provider API** - **OpenAI Compatible**
   - **Base URL** - `https://api.routerplex.com/v1`
   - **API key** - your RouterPlex API key
4. Select the models you want from the auto-fetched list, or add model IDs manually, then click **Submit**.

For token limits and other per-model settings, edit `kilo.jsonc` as shown in the CLI tab.

{% /tab %}
{% tab label="CLI" %}

Set the API key as an environment variable:

```bash
export ROUTERPLEX_API_KEY="your-api-key"
```

Then declare the provider in `~/.config/kilo/kilo.json` or `./kilo.json`:

```jsonc
{
  "provider": {
    "routerplex": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "RouterPlex",
      "env": ["ROUTERPLEX_API_KEY"],
      "options": {
        "baseURL": "https://api.routerplex.com/v1",
      },
      "models": {
        "claude-sonnet-4-6": {
          "name": "Claude Sonnet 4.6",
          "limit": { "context": 1000000, "output": 64000 },
        },
        "gpt-6-sol": {
          "name": "GPT-6 Sol",
          "limit": { "context": 922000, "output": 128000 },
        },
        "deepseek-v4-pro": {
          "name": "DeepSeek V4 Pro",
          "limit": { "context": 1000000, "output": 384000 },
        },
      },
    },
  },
  "model": "routerplex/claude-sonnet-4-6",
}
```

Model IDs are used exactly as listed in the catalog, with no vendor prefix.

{% /tab %}
{% /tabs %}

## Choosing models

The live model list, with context windows, output limits, and prices per million tokens, is at [https://routerplex.com/api/models](https://routerplex.com/api/models). Copy `context_tokens` and `max_output_tokens` into each model's `limit` so Kilo can manage context correctly. The catalog changes over time, so check it instead of relying on a static list.

## Tips and notes

- Prices are vendor list prices. Some models bill a higher rate for very long prompts. The catalog's `pricing_note` field says when.
- Each request's cost is reported in the RouterPlex dashboard logs, grouped by key.
- Create a separate key for Kilo Code. Its budget and logs then stay separate from your other tools.

## Troubleshooting

- **401 Unauthorized:** The key is wrong, revoked, or not exported in the shell that launched Kilo. Check `ROUTERPLEX_API_KEY`.
- **402 Payment Required:** Your account balance is used up. Add credit.
- **403 Forbidden:** The key reached its own budget, or the model is not on its allowlist. Raise the budget or edit the allowlist in the dashboard.
- **Model not found:** Use an exact `id` from the catalog.

{% callout type="note" %}
This documentation was contributed by the RouterPlex team.
{% /callout %}
