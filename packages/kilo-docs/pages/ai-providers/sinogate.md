---
title: "Using SinoGate with Kilo Code"
description: "Connect Kilo Code to SinoGate's OpenAI-compatible gateway for Chinese models such as DeepSeek, Qwen, GLM, Kimi, and MiniMax."
sidebar_label: SinoGate
---

# Using SinoGate With Kilo Code

[SinoGate](https://sinogate.ai/) is an OpenAI-compatible API gateway for Chinese model families, including DeepSeek, Qwen, GLM, Kimi, and MiniMax. It provides one endpoint and one API key, automatic failover across upstreams, and USD billing. SinoGate is not a built-in provider, so you add it as a custom [OpenAI Compatible](/docs/ai-providers/openai-compatible) provider.

**Website:** [https://sinogate.ai/](https://sinogate.ai/)

## Before you begin

1. Create an account and an API key at [sinogate.ai](https://sinogate.ai/).
2. Choose a model ID. The public [`/v1/models`](https://api.sinogate.ai/v1/models) endpoint and the [model catalog](https://sinogate.ai/models) list the current IDs, for example `deepseek-v4-pro`, `qwen3.7-max`, `glm-5.3`, `kimi-k3`, and `MiniMax-M2.5`.

## Configure Kilo Code

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** (gear icon) and go to the **Providers** tab.
2. Add a custom **OpenAI Compatible** provider.
3. Set **Base URL** to `https://api.sinogate.ai/v1` and paste your SinoGate API key.
4. Click **Fetch models** and select the models you want, or enter model IDs manually.

{% /tab %}
{% tab label="CLI" %}

Define SinoGate as a custom provider in `~/.config/kilo/kilo.json` or `./kilo.json`:

```jsonc
{
  "provider": {
    "sinogate": {
      "npm": "@ai-sdk/openai-compatible",
      "models": {
        "deepseek-v4-pro": { "name": "DeepSeek V4 Pro" },
        "qwen3.7-max": { "name": "Qwen 3.7 Max" },
        "kimi-k3": { "name": "Kimi K3" },
      },
      "options": {
        "apiKey": "your-sinogate-api-key",
        "baseURL": "https://api.sinogate.ai/v1",
      },
    },
  },
  "model": "sinogate/deepseek-v4-pro",
}
```

Add a `limit` with `context` and `output` token counts to each model if you want Kilo Code to manage context for it. See the [OpenAI Compatible](/docs/ai-providers/openai-compatible) guide for all configuration fields.

{% /tab %}
{% /tabs %}

## API compatibility

Kilo Code connects to SinoGate through the OpenAI-compatible Chat Completions API at `https://api.sinogate.ai/v1`. Keep the trailing `/v1` in the base URL.

## Troubleshooting

- **Invalid API key:** create a new key at [sinogate.ai](https://sinogate.ai/) and update the provider settings.
- **Model not found:** copy the model ID exactly as `/v1/models` returns it (IDs are case-sensitive, for example `MiniMax-M2.5`).
- **Tool calls failing:** pick a model that supports function calling for agentic coding.

{% callout type="note" %}
This documentation was contributed by the SinoGate team.
{% /callout %}
