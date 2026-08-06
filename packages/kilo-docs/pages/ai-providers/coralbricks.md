---
title: "Using CoralBricks with Kilo Code | High-Throughput Open-Model Inference"
description: "Run open models like GLM 5.2 and Kimi K3 (1M context) on CoralBricks' OpenAI-compatible API in Kilo Code. Setup guide for VS Code and the CLI."
---

# Using CoralBricks With Kilo Code

CoralBricks is a high-throughput inference platform for open models — GLM 5.2
and Kimi K3 with 1M-token context windows, and GPT-OSS 120B. It
exposes an OpenAI-compatible API (plus an Anthropic Messages endpoint) and
connects to Kilo Code as a custom provider. Cached input tokens are free,
which matters for agent loops that re-send context on every turn.

**Website:** [https://www.coralbricks.ai/](https://www.coralbricks.ai/)

## Getting an API Key

1. **Sign Up/Sign In:** Go to [CoralBricks](https://www.coralbricks.ai/) and create an account or sign in.
2. **Navigate to API Keys:** Open the [API Keys page](https://www.coralbricks.ai/api-keys).
3. **Create a Key:** Mint a key (keys look like `ak_...`) and copy it.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** (gear icon) and go to the **Providers** tab.
2. Scroll to the bottom and click **Custom provider**.
3. Fill in the dialog:
   - **Provider ID** — `coralbricks`
   - **Display name** — `CoralBricks`
   - **Provider API** — **OpenAI Compatible**
   - **Base URL** — `https://inference.coralbricks.ai/v1`
   - **API key** — your `ak_...` key
   - **Models** — Kilo Code auto-fetches the model list from CoralBricks'
     `/v1/models` endpoint; select the models you want.
4. Click **Submit**. The models appear in the model picker.

{% /tab %}
{% tab label="CLI" %}

Define the provider in your global `kilo.json` config file
(`~/.config/kilo/kilo.json`):

{% callout type="warning" %}
`{env:...}` references only resolve in trusted config — the global config,
`KILO_CONFIG` / `KILO_CONFIG_CONTENT`, or MDM-managed config. In a
project-level `./kilo.json` the reference is silently ignored and the
provider will fail to authenticate; put the provider block in the global
config, or inline the key (not recommended for committed files).
{% /callout %}

```bash
export CORALBRICKS_API_KEY="ak_..."
```

```jsonc
{
  "provider": {
    "coralbricks": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "CoralBricks",
      "options": {
        "baseURL": "https://inference.coralbricks.ai/v1",
        "apiKey": "{env:CORALBRICKS_API_KEY}",
      },
      "models": {
        "glm-5.2-fp4": {
          "name": "GLM 5.2",
          "limit": {
            "context": 1048576,
            "output": 32768,
          },
        },
        "kimi-k3": {
          "name": "Kimi K3",
          "limit": {
            "context": 1048576,
            "output": 32768,
          },
        },
        },
        "gpt-oss-120b": {
          "name": "GPT-OSS 120B",
          "limit": {
            "context": 131072,
            "output": 32768,
          },
        },
      },
    },
  },
  "model": "coralbricks/glm-5.2-fp4",
}
```

{% /tab %}
{% /tabs %}

## Models

| Model | Model ID | Context |
| --- | --- | --- |
| GLM 5.2 | `glm-5.2-fp4` | 1M |
| Kimi K3 | `kimi-k3` | 1M |
| GPT-OSS 120B | `gpt-oss-120b` | 128K |

Tool calling, streaming, and reasoning are supported across the model line.
The `/v1/models` endpoint reports per-model context windows, capabilities,
and pricing, so Kilo Code's auto-detection stays current.

## Tips and Notes

- **Free cached input:** Cached input tokens are not billed. Agent loops
  re-send their context every turn, so this significantly reduces the cost
  of long Kilo Code sessions.
- **1M context:** GLM 5.2 and Kimi K3 accept up to 1,048,576 input tokens —
  set the context limit in your model config so Kilo Code's context
  management uses the full window.
- **Anthropic Messages:** CoralBricks also exposes an Anthropic-format
  endpoint; selecting **Anthropic Messages** as the Provider API with base
  URL `https://inference.coralbricks.ai` works as well.
- **Docs:** See the [CoralBricks API reference](https://www.coralbricks.ai/docs)
  for the full API surface.
