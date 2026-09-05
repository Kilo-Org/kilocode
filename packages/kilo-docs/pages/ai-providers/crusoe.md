---
title: "Using Crusoe with Kilo Code | Managed Inference for Open Models"
description: "Run open models like GLM 5.2 on Crusoe Managed Inference's OpenAI-compatible API in Kilo Code. Setup guide for VS Code and the CLI."
---

# Using Crusoe With Kilo Code

Crusoe provides Managed Inference, an OpenAI-compatible API for open-weight models such as GLM, DeepSeek, and Nemotron, served from Crusoe's vertically integrated AI cloud. It is available as a built-in provider in Kilo Code.

**Website:** [https://crusoe.ai/](https://crusoe.ai/)

## Getting an API Key

1. **Sign Up/Sign In:** Go to the [Crusoe Console](https://console.crusoe.ai/) and create an account or sign in.
2. **Navigate to API Keys:** In the console, go to **Security > Inference API Key**.
3. **Create a Key:** Create a new key, give it a descriptive name (e.g., "Kilo Code"), and copy it. You will not be able to view it again.

## Configuration in Kilo Code

Crusoe is available as a **built-in provider** in Kilo Code, so you can connect it directly, with no custom provider setup needed.

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** (gear icon) and go to the **Providers** tab.
2. Click **Connect provider**, search for **Crusoe**, and select it.
3. Enter your Crusoe API key.
4. Pick a model. Kilo Code fetches the available models automatically.

{% /tab %}
{% tab label="CLI" %}

**Method 1: `/connect` (recommended)**

Run `kilo`, then use the `/connect` command, select **Crusoe**, and paste your API key when prompted:

```bash
kilo
# then, inside Kilo, run:
/connect
```

**Method 2: config file**

Set your API key and add Crusoe in your `kilo.json` config file (`~/.config/kilo/kilo.json` or `./kilo.json`):

```bash
export CRUSOE_API_KEY="your-api-key"
```

```jsonc
{
  "provider": {
    "crusoe": {
      "env": ["CRUSOE_API_KEY"],
    },
  },
  "model": "crusoe/zai/GLM-5.2",
}
```

{% /tab %}
{% /tabs %}

## Models

Crusoe Managed Inference serves open models including:

- `zai/GLM-5.2` (256K context) and `zai/GLM-5.1`
- `nvidia/Nemotron-3-Nano-Omni-Reasoning-30B-A3B`
- `deepseek-ai/DeepSeek-V3-0324`
- `google/gemma-4-31b-it`
- `moonshotai/Kimi-K2.6`
- `openai/gpt-oss-120b`
- `meta-llama/Llama-3.3-70B-Instruct`

Tool calling and reasoning are supported across most of the model line. See the [Crusoe Managed Inference docs](https://docs.crusoecloud.com/managed-inference/overview) for the full, current model list and supported parameters.

## Tips and Notes

- **Model list:** The current catalog is always available from the `/v1/models` endpoint at `https://api.inference.crusoecloud.com/v1/models`.
- **Pricing:** See [Crusoe pricing](https://crusoe.ai/cloud/pricing) for current per-model rates.
- **Reasoning:** Reasoning models such as GLM 5.2 return their thinking alongside responses; `openai/gpt-oss-120b` additionally supports low/medium/high reasoning effort levels. Reasoning tokens count against the output budget, so give responses enough room when reasoning is enabled.
