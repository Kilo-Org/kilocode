---
title: "Using Mixlayer with Kilo Code | Fast Open-Model Inference"
description: "Run open models like GLM and Qwen on Mixlayer's OpenAI-compatible API in Kilo Code. Setup guide for VS Code and the CLI."
---

# Using Mixlayer With Kilo Code

Mixlayer is an inference platform for open models such as GLM and Qwen, with a serving stack built from scratch by core contributors to Candle. It exposes an OpenAI-compatible API and is available as a built-in provider in Kilo Code.

**Website:** [https://mixlayer.com/](https://mixlayer.com/)

## Getting an API Key

1. **Sign Up/Sign In:** Go to [Mixlayer](https://mixlayer.com/) and create an account or sign in.
2. **Navigate to API Keys:** Open the [Mixlayer console](https://console.mixlayer.com/) and go to the API Keys page.
3. **Create a Key:** Click **New Key**, give it a descriptive name (e.g., "Kilo Code"), and copy it. You will not be able to view it again.

## Configuration in Kilo Code

Mixlayer is available as a **built-in provider** in Kilo Code, so you can connect it directly — no custom provider setup needed.

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** (gear icon) and go to the **Providers** tab.
2. Click **Connect provider**, search for **Mixlayer**, and select it.
3. Enter your Mixlayer API key.
4. Pick a model from the list.

{% /tab %}
{% tab label="CLI" %}

**Method 1 — `/connect` (recommended)**

Run `kilo`, then use the `/connect` command, select **Mixlayer**, and paste your API key when prompted:

```bash
kilo
# then, inside Kilo, run:
/connect
```

**Method 2 — config file**

Set your API key and add Mixlayer in your `kilo.json` config file (`~/.config/kilo/kilo.json` or `./kilo.json`):

```bash
export MIXLAYER_API_KEY="your-api-key"
```

```jsonc
{
  "provider": {
    "mixlayer": {
      "env": ["MIXLAYER_API_KEY"],
    },
  },
  "model": "mixlayer/z-ai/glm-5.3",
}
```

{% /tab %}
{% /tabs %}

## Models

Mixlayer serves open models including:

- `z-ai/glm-5.3` — 256K context
- `deepseek/deepseek-v4.1-flash` — 256K context
- `qwen/qwen3.8-27b` — 256K context, vision-capable
- `qwen/qwen3.6-35b-a3b` and `qwen/qwen3.5-9b` — 128K context, vision-capable
- `qwen/qwen3.5-4b-free` — free, 128K context, vision-capable

Tool calling and reasoning are supported across the model line. See the [Mixlayer docs](https://docs.mixlayer.com) for the full, current model list and supported parameters.

## Tips and Notes

- **Model list:** The picker comes from the [models.dev](https://models.dev/providers/mixlayer) catalog. If a model you expect is missing, check Mixlayer's `/v1/models` endpoint for what your key can use.
- **Pricing:** See [Mixlayer pricing](https://mixlayer.com/pricing) for current per-model pricing.
- **Reasoning:** Qwen models support a thinking mode; reasoning tokens count against the output budget, so give responses enough room when reasoning is enabled.
