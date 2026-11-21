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
4. Kilo queries the Base URL and lists the served models; select the ones you want, or add model ids manually.
5. Click **Submit**, then pick a model in the model picker.

{% /tab %}
{% tab label="CLI" %}

Define the provider in your Kilo config file — `~/.config/kilo/kilo.json` for a global setup, or `./kilo.json` inside a project — and keep the key in an environment variable:

```bash
export CROWLLM_API_KEY="your-api-key"
```

```jsonc
{
  "provider": {
    "crowllm": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "CrowLLM",
      "env": ["CROWLLM_API_KEY"],
      "options": {
        "baseURL": "https://crowllm.com/v1",
      },
      "models": {
        "deepseek-v4-flash": {
          "name": "DeepSeek V4 Flash",
          "limit": { "context": 128000, "output": 16384 },
        },
        "glm-5.3": {
          "name": "GLM 5.3",
          "limit": { "context": 200000, "output": 32768 },
        },
      },
    },
  },
  "model": "crowllm/deepseek-v4-flash",
}
```

Add any id from `GET https://crowllm.com/v1/models` (keyless) under `models`. Each entry needs `limit.context` and `limit.output`; omitted limits are treated as zero and disable context management.

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
- **Model list comes back empty:** confirm the Base URL is exactly `https://crowllm.com/v1` (with `/v1`) and reopen the dialog so Kilo queries the endpoint again.

{% callout type="note" %}
This documentation was contributed by a CrowLLM maintainer.
{% /callout %}
