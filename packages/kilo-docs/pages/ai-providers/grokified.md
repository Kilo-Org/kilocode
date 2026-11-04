---
title: "Using Grokified with Kilo Code"
description: "Connect Kilo Code to Grokified, an OpenAI-compatible Grok API at half the list price, as a custom provider with an API key."
sidebar_label: Grokified
---

# Using Grokified With Kilo Code

[Grokified](https://grokified.com) is an OpenAI-compatible API for Grok models. Every request is charged at 50% of the list price. Grokified is not a built-in provider in Kilo Code, so you connect it as a custom provider using the OpenAI-compatible protocol.

**Website:** [https://grokified.com](https://grokified.com)

**API base URL:** `https://api.grokified.com/v1`

**Docs:** [https://grokified.com/docs](https://grokified.com/docs)

## Getting an API key

1. Create an account at [grokified.com/login](https://grokified.com/login).
2. Open the dashboard and create an API key. Keys start with `gk_live_` and are shown once, so copy it when it appears.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** (gear icon) and go to the **Providers** tab.
2. Scroll to the bottom and click **Custom provider**.
3. Fill in the dialog:
   - **Provider ID**: `grokified`
   - **Display name**: `Grokified`
   - **Provider API**: **OpenAI Compatible**
   - **Base URL**: `https://api.grokified.com/v1`
   - **API key**: your `gk_live_...` key
4. Click **Fetch models**, select `grok-build-0.1` (and any others you want), then **Submit**.

For token limits, edit `kilo.jsonc` directly as shown in the CLI tab.

{% /tab %}
{% tab label="CLI" %}

Keep the key in the environment so it never lands in a project file:

```bash
export GROKIFIED_API_KEY="gk_live_your_key"
```

Declare the provider in `~/.config/kilo/kilo.json` or `./kilo.json`:

```jsonc
{
  "provider": {
    "grokified": {
      "name": "Grokified",
      "npm": "@ai-sdk/openai-compatible",
      "env": ["GROKIFIED_API_KEY"],
      "options": {
        "baseURL": "https://api.grokified.com/v1",
      },
      "models": {
        "grok-build-0.1": {
          "name": "Grok Build 0.1",
          "limit": {
            "context": 256000,
            "output": 32768,
          },
        },
        "grok-4.6": {
          "name": "Grok 4.6",
          "limit": {
            "context": 500000,
            "output": 32768,
          },
        },
      },
    },
  },
  "model": "grokified/grok-build-0.1",
}
```

The `output` value is the maximum number of output tokens Kilo Code requests per reply. It is a client setting, not a published model limit, so raise or lower it to taste.

{% /tab %}
{% /tabs %}

## Models

| Model | Context | Input | Cached input | Output |
|---|---|---|---|---|
| `grok-build-0.1` | 256K | $0.50 | $0.10 | $1.00 |
| `grok-4.6` | 500K | $1.00 | $0.25 | $3.00 |

Prices are USD per 1M tokens after the 50% discount, as of 2026-10-02. `grok-build-0.1` is tuned for code and agent work. The full list, including image and video models, is on the [Grokified models page](https://grokified.com/docs/models), and the [Grok Build page](https://grokified.com/grok-build) covers the coding model in more detail.

`grok-4.7` is also available, but it needs a Basic or higher Grokified plan. On a prepaid or free account the API returns a 403 `plan_capability_required` error for it, so start with `grok-build-0.1` or `grok-4.6`.

## Tips and notes

- **Billing**: prepaid credit or a monthly plan. Non-streaming responses include a `usage.grokified` block with the list price, the amount charged and your remaining balance.
- **Free accounts** are capped at 32K input tokens per request until the first top-up. Agent requests with a large context usually exceed that and get a 413 `free_tier_request_too_large` error, so top up before using Kilo Code's agent modes.
- **Streaming and tool calls** use the standard OpenAI Chat Completions shapes.
- **Model not found**: copy the exact slug (for example `grok-build-0.1`), not a display name.
- **401 invalid key**: create a new key in the dashboard and update `GROKIFIED_API_KEY`.

{% callout type="note" %}
This documentation was contributed by a Grokified affiliate.
{% /callout %}
