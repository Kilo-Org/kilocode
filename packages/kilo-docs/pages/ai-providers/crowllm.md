---
title: "Using CrowLLM with Kilo Code"
description: "Connect Kilo Code to CrowLLM, an OpenAI-compatible gateway with one key for every model and a zero-rated free shelf."
sidebar_label: CrowLLM
---

# Using CrowLLM With Kilo Code

[CrowLLM](https://crowllm.com) is an OpenAI-compatible gateway: one endpoint (`https://crowllm.com/v1`) and one key for every model, with a zero-rated `:free` shelf next to the paid ids.

Use Kilo Code's **OpenAI Compatible** provider type — no custom code path is needed.

## Getting an API Key

1. Create an account at [crowllm.com](https://crowllm.com).
2. Open the console and create an API key.
3. Copy the key; it is used as a Bearer token on every request.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** (gear icon) and go to the **Providers** tab.
2. Scroll to the bottom and click **Custom provider**.
3. Fill in the dialog:
   - **Provider ID** — `crowllm`
   - **Display name** — `CrowLLM`
   - **Provider API** — **OpenAI Compatible**
   - **Base URL** — `https://crowllm.com/v1`
   - **API key** — your CrowLLM key
4. Click **Fetch models**; the picker lists what the gateway serves right now.
5. Click **Submit**, then pick a model.

{% /tab %}
{% tab label="CLI" %}

**Method 1 — environment variable**

```bash
export CROWLLM_API_KEY="your-api-key"
```

```jsonc
{
  "provider": {
    "crowllm": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "CrowLLM",
      "options": {
        "baseURL": "https://crowllm.com/v1",
      },
      "env": ["CROWLLM_API_KEY"],
      "models": {
        "deepseek-v4-flash": { "name": "DeepSeek V4 Flash" },
        "glm-5.3": { "name": "GLM 5.3" },
      },
    },
  },
  "model": "crowllm/deepseek-v4-flash",
}
```

Add any id from `GET https://crowllm.com/v1/models` (keyless) under `models`.

{% /tab %}
{% /tabs %}

## Models

The gateway serves 180+ ids across vendors. A few commonly used ones:

| Model | Id | Notes |
|-------|-----|-------|
| DeepSeek V4 Flash | `deepseek-v4-flash` | Fast and cheap |
| GLM 5.3 | `glm-5.3` | Reasoning effort supported |
| Kimi K3 | `kimi-k3` | Long-context coding |
| Claude Opus 4.7 | `claude-opus-4-7` | Frontier reasoning |
| Gemini 3.7 Flash | `gemini-3.7-flash` | Fast multimodal |
| Qwen 3.8 27B (free) | `qwen-3.8-27b:free` | Zero-rated free shelf |

Query the live catalog at any time:

```bash
curl https://crowllm.com/v1/models
```

## Free Models

Ids ending in `:free` bill at zero and need no card. They are rate-limited, so they suit exploration and small tasks rather than long agent runs. See [CrowLLM pricing](https://crowllm.com/pricing) for per-model rates.

## Troubleshooting

- **401 Unauthorized:** the key is missing or revoked; create a new one in the console.
- **Model not found:** copy an exact id from `GET https://crowllm.com/v1/models`; aliases change as the catalog rotates.
- **Auto-detection returns nothing:** confirm the Base URL is exactly `https://crowllm.com/v1` (with `/v1`), then press **Fetch models** again.

{% callout type="note" %}
This documentation was contributed by a CrowLLM maintainer.
{% /callout %}
