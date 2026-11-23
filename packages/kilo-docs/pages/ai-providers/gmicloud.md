---
title: "Using GMI Cloud with Kilo Code | OpenAI-Compatible Inference"
description: "Configure GMI Cloud in Kilo Code. Built-in OpenAI-compatible provider with one API key for a catalog of open and frontier models."
sidebar_label: GMI Cloud
---

# Using GMI Cloud With Kilo Code

[GMI Cloud](https://www.gmicloud.ai/) is an AI-native cloud platform that serves open and frontier models on its own GPU infrastructure behind an OpenAI-compatible API. Kilo Code ships it as a **built-in provider**, so you can connect with an API key and start coding. Kilo Code uses the `gmicloud` provider ID and reads your API key from `GMICLOUD_API_KEY`.

**Website:** [https://www.gmicloud.ai/](https://www.gmicloud.ai/)

{% callout type="tip" %}
GMI Cloud maintains its own Kilo Code setup guide at [docs.gmicloud.ai/coding-tools/kilo](https://docs.gmicloud.ai/coding-tools/kilo). Use it alongside this page for provider-side details like console navigation and account setup.
{% /callout %}

## Before you begin

1. Create an account at [console.gmicloud.ai](https://console.gmicloud.ai/).
2. Create an API key. Open **API Keys** at the top right of the console and click **Create API key**, then copy it immediately.
3. Choose a model ID available to your account. Model availability and pricing change, so check the live catalog instead of copying an old model list.

## Configure Kilo Code

GMI Cloud is a **built-in provider** in Kilo Code, so you connect it directly without any custom provider setup.

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** (gear icon) and go to the **Providers** tab.
2. Click **Connect provider**, search for **GMI Cloud**, and select it.
3. Paste your GMI Cloud API key.
4. Pick a model from the list.

The provider credentials are stored in Kilo's `auth.json` store.

{% /tab %}
{% tab label="CLI" %}

**Recommended:** connect interactively so the API key is stored in Kilo's `auth.json` store, the same credential store the VS Code extension uses.

1. In the TUI, open the model picker with `/models`, press **Ctrl + A** to connect a provider, choose **GMI Cloud**, then paste your API key.
2. Or from the shell:

```bash
kilo auth login --provider gmicloud
```

Then pick a model from the model picker, or set a default model in `provider-id/model-id` form:

```jsonc
{
  "model": "gmicloud/zai-org/GLM-5.2-FP8",
}
```

**Manual configuration (optional):** keep the key in the environment and declare the provider in `~/.config/kilo/kilo.json` or `./kilo.json`, so the secret never lands in the project file:

```bash
export GMICLOUD_API_KEY="your-api-key"
```

```jsonc
{
  "provider": {
    "gmicloud": {
      "env": ["GMICLOUD_API_KEY"],
    },
  },
  "model": "gmicloud/zai-org/GLM-5.2-FP8",
}
```

{% /tab %}
{% /tabs %}

## Model naming

GMI Cloud model IDs are in `vendor/model` form, so a full reference in Kilo Code has three segments: `gmicloud/<vendor>/<model>`. For example:

```jsonc
{
  "model": "gmicloud/zai-org/GLM-5.2-FP8",
}
```

```jsonc
{
  "model": "gmicloud/deepseek-ai/DeepSeek-V4-Pro",
}
```

```jsonc
{
  "model": "gmicloud/anthropic/claude-sonnet-4.6",
}
```

Agentic coding leans on tool calling, so pick catalog models with function-calling support for the best results.

## OpenAI compatibility

Kilo Code connects to GMI Cloud through the OpenAI-compatible API at `https://api.gmi-serving.com/v1`. Keep the trailing `/v1` if you point the provider at a custom base URL or add GMI Cloud as a manual [OpenAI Compatible](/docs/ai-providers/openai-compatible) provider.

## Tips and notes

- **Model list:** The picker comes from the [models.dev](https://models.dev/providers/gmicloud) catalog. If a model you expect is missing, check GMI Cloud's `/v1/models` endpoint for what your key can use.
- **Model choice:** Match the model to the task — fast variants for quick edits, larger reasoning models for architecture and debugging.
- **Pricing:** GMI Cloud bills pay-as-you-go based on your usage. See [GMI Cloud pricing](https://www.gmicloud.ai/pricing) for current rates.

## Troubleshooting

- **Invalid API key:** create a new key in the GMI Cloud console, then reconnect with `/connect` or `kilo auth login --provider gmicloud`, or update `GMICLOUD_API_KEY` if you use manual configuration.
- **Model not found:** copy the model ID exactly as the catalog shows it, including the vendor prefix.
- **Provider not visible:** refresh Kilo Code's provider catalog, then check **Show more providers**.
- **Tool calls failing:** select a catalog model that advertises function-calling support.
