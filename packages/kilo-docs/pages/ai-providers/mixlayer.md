---
title: "Using Mixlayer with Kilo Code | Fast Open-Model Inference"
description: "Run open models like GLM and Qwen on Mixlayer's OpenAI-compatible API in Kilo Code. Setup guide for VS Code and the CLI."
---

# Using Mixlayer With Kilo Code

Mixlayer is an inference platform for open models such as GLM and Qwen, with a serving stack built from scratch by core contributors to Candle. It exposes an OpenAI-compatible API, so you can use it in Kilo Code through the **OpenAI Compatible** provider.

**Website:** [https://mixlayer.com/](https://mixlayer.com/)

## Getting an API Key

1. **Sign Up/Sign In:** Go to [Mixlayer](https://mixlayer.com/) and create an account or sign in.
2. **Navigate to API Keys:** Open the [Mixlayer console](https://console.mixlayer.com/) and go to the API Keys page.
3. **Create a Key:** Click **New Key**, give it a descriptive name (e.g., "Kilo Code"), and copy it. You will not be able to view it again.

## Configuration in Kilo Code

Mixlayer's API is OpenAI-compatible, with the base URL `https://models.mixlayer.ai/v1`. Configure it through Kilo Code's **OpenAI Compatible** provider.

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** (gear icon) and go to the **Providers** tab.
2. Scroll to the bottom and click **Custom provider**.
3. Fill in the dialog:
   - **Provider ID** — `mixlayer`
   - **Display name** — `Mixlayer`
   - **Provider API** — **OpenAI Compatible**
   - **Base URL** — `https://models.mixlayer.ai/v1`
   - **API key** — your Mixlayer API key
4. Kilo Code auto-fetches the available models from Mixlayer's `/v1/models` endpoint, so you can pick a model directly from the list. Click **Submit** to save.

{% /tab %}
{% tab label="CLI" %}

Set the API key as an environment variable and define an OpenAI-compatible provider in your `kilo.json` config file (`~/.config/kilo/kilo.json` or `./kilo.json`):

**Environment variable:**

```bash
export MIXLAYER_API_KEY="your-api-key"
```

**Config file:**

```jsonc
{
  "provider": {
    "mixlayer": {
      "npm": "@ai-sdk/openai-compatible",
      "env": ["MIXLAYER_API_KEY"],
      "options": {
        "baseURL": "https://models.mixlayer.ai/v1",
      },
      "models": {
        "z-ai/glm-5.2": {
          "name": "GLM-5.2",
          "limit": { "context": 262144, "output": 262144 },
        },
        "qwen/qwen3.5-397b-a17b": {
          "name": "Qwen3.5 397B A17B",
          "limit": { "context": 131072, "output": 131072 },
        },
      },
    },
  },
}
```

Then set your default model using the `provider-id/model-id` format:

```jsonc
{
  "model": "mixlayer/z-ai/glm-5.2",
}
```

{% /tab %}
{% /tabs %}

## Models

Mixlayer serves open models including:

- `z-ai/glm-5.2` — 256K context
- `qwen/qwen3.5-397b-a17b` and the Qwen 3.5 / 3.6 line (vision-capable)
- `moonshotai/kimi-k2.7-code`

Tool calling and reasoning are supported across the model line. See the [Mixlayer docs](https://docs.mixlayer.com) for the full, current model list and supported parameters.

## Tips and Notes

- **Model list:** Kilo Code auto-detects available models from Mixlayer's `/v1/models` endpoint, so the picker stays current with your account.
- **Pricing:** See the [Mixlayer console](https://console.mixlayer.com/) for current per-model pricing.
- **Reasoning:** Qwen models support a thinking mode; reasoning tokens count against the output budget, so allow enough `limit.output` when reasoning is enabled.
