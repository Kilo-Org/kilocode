---
title: "Using Reka with Kilo Code | Multimodal Models"
description: "Run Reka's first-party multimodal and hosted open models in Kilo Code via the Reka API. Setup guide for VS Code and the CLI."
---

# Using Reka With Kilo Code

[Reka](https://reka.ai/) is a first-party model provider offering its own multimodal models (Reka Flash, Reka Edge) plus hosted open models (GLM, DeepSeek, Qwen, Gemma) through a single OpenAI-compatible API. Reasoning traces are returned on reasoning models, and prompt caching is automatic.

**Website:** [https://reka.ai/](https://reka.ai/)

**Developer docs:** [https://developer.reka.ai/](https://developer.reka.ai/)

## Getting an API Key

1. **Sign Up/Sign In:** Go to [developer.reka.ai](https://developer.reka.ai/) and create an account or sign in.
2. **Create a Key:** Create an API key from the API keys page.
3. **Copy the Key:** Copy the API key and store it securely.

## Configuration in Kilo Code

Kilo Code consumes the Reka provider catalog (models, capabilities, context and output limits, pricing) automatically from models.dev, so once your key is set, Reka models appear in the model picker — no manual model configuration needed.

{% tabs %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab to add Reka and enter your API key.

The extension stores this in your `kilo.json` config file. You can also edit the config file directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="CLI" %}

Set the API key as an environment variable or configure it in your `kilo.json` config file:

**Environment variable:**

```bash
export REKA_API_KEY="your-api-key"
```

**Config file** (`~/.config/kilo/kilo.json` or `./kilo.json`):

```jsonc
{
  "provider": {
    "reka": {
      "env": ["REKA_API_KEY"]
    }
  }
}
```

Then select a Reka model from the model picker, or set a default model after confirming the model ID in your account:

```jsonc
{
  "model": "reka/glm5.3"
}
```

> Reka's model IDs are unhyphenated on the Reka API (e.g. `glm5.3`, `reka-flash-3`) — check [developer.reka.ai/models](https://developer.reka.ai/models) for the current IDs.

{% /tab %}
{% /tabs %}

## Available Models

Reka's catalog includes first-party multimodal models (Reka Flash 3, Reka Edge 2603) and hosted open models (GLM 5.3, GLM 5.3 Flash, DeepSeek V4 Flash, Qwen 3.8 27B). See [developer.reka.ai/models](https://developer.reka.ai/models) for the current list, limits, and pricing.

## Support

- Reka documentation: [developer.reka.ai](https://developer.reka.ai/)
- Issues with the Reka API: [reka.ai](https://reka.ai/) support
