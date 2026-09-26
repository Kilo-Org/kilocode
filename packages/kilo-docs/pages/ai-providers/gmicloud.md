---
title: "Using GMI Cloud with Kilo Code"
description: "Connect GMI Cloud's OpenAI-compatible models to Kilo Code. Setup guide for the VS Code extension and the CLI."
sidebar_label: GMI Cloud
---

# Using GMI Cloud With Kilo Code

Kilo Code supports GMI Cloud as a built-in provider. GMI Cloud serves OpenAI-compatible chat models, including streaming, tool calling, and structured output.

**Website:** [https://www.gmicloud.ai/](https://www.gmicloud.ai/)

The API base URL is `https://api.gmi-serving.com/v1`. Requests use Bearer authentication and the OpenAI Chat Completions endpoint (`/v1/chat/completions`). Model lists come from `GET /v1/models` and the built-in catalog.

## Getting an API Key

1. **Sign Up/Sign In:** Go to the [GMI Cloud console](https://console.gmicloud.ai/). Create an account or sign in.
2. **Navigate to API Keys:** Open **Settings → API Keys**.
3. **Create a Key:** Create an API key and give it a descriptive name (e.g., "Kilo Code").
4. **Copy the Key:** Copy the API key and store it securely.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab to add GMI Cloud and enter your API key.

The extension stores this in your `kilo.json` config file. You can also edit the config file directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="CLI" %}

Set the API key as an environment variable or configure it in your `kilo.json` config file:

**Environment variable:**

```bash
export GMI_API_KEY="your-api-key"
```

`GMICLOUD_API_KEY` is also accepted. That is the name published in the model catalog.

**Config file** (`~/.config/kilo/kilo.json` or `./kilo.json`):

```jsonc
{
  "provider": {
    "gmicloud": {
      "env": ["GMI_API_KEY"],
    },
  },
}
```

Then set your default model:

```jsonc
{
  "model": "gmicloud/deepseek-ai/DeepSeek-V4-Pro",
}
```

{% /tab %}
{% /tabs %}

## Supported Models

Kilo loads GMI Cloud models from the built-in catalog. Example model IDs include `deepseek-ai/DeepSeek-V4-Pro` and `moonshotai/Kimi-K2.6`.

Model availability changes. Refer to the [GMI Cloud LLM API reference](https://docs.gmicloud.ai/inference-engine/api-reference/llm-api-reference) for the current list.

## Tips and Notes

- **Docs:** [https://docs.gmicloud.ai/](https://docs.gmicloud.ai/)
- **API reference:** [LLM API reference](https://docs.gmicloud.ai/inference-engine/api-reference/llm-api-reference)
