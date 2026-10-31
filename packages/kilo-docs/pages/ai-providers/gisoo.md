---
title: "Using Gisoo with Kilo Code"
description: "Connect Kilo Code to Gisoo's OpenAI-compatible multi-model API as a custom provider."
sidebar_label: Gisoo
---

# Using Gisoo With Kilo Code

[Gisoo](https://gisoo.pro) is an OpenAI-compatible, multi-model API. It exposes Chat Completions and a public model list at `https://gisoo.pro/api/v1`. Gisoo is a relay that routes requests to model labs' models; it is not a first-party lab.

This page uses Kilo Code's custom OpenAI-compatible provider, so it does not depend on Gisoo being present in the `models.dev` catalog.

## Before you begin

1. Create an account at [gisoo.pro](https://gisoo.pro).
2. Create an API key at [gisoo.pro/app/api/keys](https://gisoo.pro/app/api/keys).
3. Choose an exact model ID from the live list at [`https://gisoo.pro/api/v1/models`](https://gisoo.pro/api/v1/models) (no key needed). Model availability and pricing can change, so check the list instead of copying an old one. Each entry includes `context_length` and, where known, `max_output_tokens`.

## Configure Kilo Code

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** in the Kilo Code extension and go to the **Providers** tab.
2. Scroll to the bottom and click **Custom provider**.
3. Fill in the dialog:
   - **Provider ID** — `gisoo`
   - **Display name** — `Gisoo`
   - **Provider API** — **OpenAI Compatible**
   - **Base URL** — `https://gisoo.pro/api/v1`
   - **API key** — your Gisoo API key
4. Kilo fetches the model list from `/models`. Select the models you want, then click **Submit**.

See [OpenAI Compatible](/docs/ai-providers/openai-compatible) for the full dialog reference.

{% /tab %}
{% tab label="CLI" %}

Set the key in the environment so the secret stays out of the project file:

```bash
export GISOO_API_KEY="your-api-key"
```

Then declare the provider in `~/.config/kilo/kilo.json` or `./kilo.json`. Replace the model ID, name and limits with values from the [model list](https://gisoo.pro/api/v1/models):

```jsonc
{
  "provider": {
    "gisoo": {
      "name": "Gisoo",
      "npm": "@ai-sdk/openai-compatible",
      "env": ["GISOO_API_KEY"],
      "options": {
        "baseURL": "https://gisoo.pro/api/v1",
      },
      "models": {
        "your-model-id": {
          "name": "Your model",
          "limit": {
            "context": 128000,
            "output": 8192,
          },
        },
      },
    },
  },
  "model": "gisoo/your-model-id",
}
```

{% /tab %}
{% /tabs %}

## API compatibility

Kilo Code talks to Gisoo through the OpenAI Chat Completions endpoint, `POST https://gisoo.pro/api/v1/chat/completions`, with the key sent as a `Bearer` token. The model list is public at `GET https://gisoo.pro/api/v1/models`. The full API reference is at [gisoo.pro/docs](https://gisoo.pro/docs).

## Troubleshooting

- **Invalid API key:** Create a new key at [gisoo.pro/app/api/keys](https://gisoo.pro/app/api/keys), then update the key in the provider settings or `GISOO_API_KEY`.
- **Model not found:** Copy an exact `id` from the [model list](https://gisoo.pro/api/v1/models). Do not rely on a static list.
- **No models appear in the picker:** Check that the Base URL is `https://gisoo.pro/api/v1`, then click **Fetch models**.

{% callout type="note" %}
This documentation was contributed by the operator of Gisoo.
{% /callout %}
