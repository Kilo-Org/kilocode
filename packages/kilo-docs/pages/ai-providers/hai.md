---
title: "Using HAI with Kilo Code"
description: "Connect HAI, a Japan-based OpenAI-compatible LLM Inference API with JPY billing, to Kilo Code."
sidebar_label: HAI
---

# Using HAI With Kilo Code

HAI is a Japan-based OpenAI-compatible LLM Inference API with fixed JPY pricing. It exposes standard OpenAI Chat Completions and Responses endpoints, so you can use it from Kilo Code via the catalog (after [models.dev](https://models.dev) includes HAI) or as a custom OpenAI-compatible provider.

**Website:** [https://hai.hcloud.ltd](https://hai.hcloud.ltd)  
**Docs:** [https://hai.hcloud.ltd/docs](https://hai.hcloud.ltd/docs)  
**API Base:** `https://hai-api.hcloud.ltd/v1`

## Getting an API Key

1. Open the [HAI Console](https://hai.hcloud.ltd/console/).
2. Sign in and create an API key (`hai_...`).
3. Copy the key. Store it as `HAI_API_KEY` if you prefer environment variables.

## Supported Models

Examples (see the [HAI docs](https://hai.hcloud.ltd/docs) for the full catalog):

| Model ID | Notes |
|---|---|
| `kimi-k2.6` | General purpose (recommended default) |
| `kimi-k3` | Long context (1M) |
| `deepseek-v4-flash` | Fast / low cost |
| `qwen3.6-35b-a3b` | Lightweight MoE |
| `qwen3.6-35b-a3b-uncensored` | Uncensored MoE |
| `gemma-4-31b-it` | Multimodal (includes video) |

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode" %}

### Option A — Provider from catalog (after models.dev lists HAI)

1. Open **Settings** → **Providers**.
2. Select **HAI**.
3. Paste your API key.

### Option B — Custom OpenAI Compatible provider

1. Open **Settings** → **Providers**.
2. Click **Custom provider**.
3. Set:
   - **Provider API:** OpenAI Compatible
   - **Base URL:** `https://hai-api.hcloud.ltd/v1`
   - **API Key:** your `hai_...` key
   - **Model:** e.g. `kimi-k2.6`

{% /tab %}
{% tab label="CLI" %}

```bash
export HAI_API_KEY="hai_..."
```

```jsonc
{
  "provider": {
    "hai": {
      "env": ["HAI_API_KEY"],
      "options": {
        "baseURL": "https://hai-api.hcloud.ltd/v1"
      }
    }
  }
}
```

Or as a custom OpenAI-compatible endpoint:

```jsonc
{
  "provider": {
    "hai-custom": {
      "npm": "@ai-sdk/openai-compatible",
      "api": "https://hai-api.hcloud.ltd/v1",
      "env": ["HAI_API_KEY"]
    }
  }
}
```

Select `hai/kimi-k2.6` (or your custom provider ID + model) in the model picker.

{% /tab %}
{% /tabs %}

## Tips

- Pricing is JPY per million tokens; see the [pricing table](https://hai.hcloud.ltd).
- Auth header is `Authorization: Bearer hai_...`.
- Base URL must end at `/v1` (do not append `/chat/completions`).
