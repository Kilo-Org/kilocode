---
title: "Using OpenRouter with Kilo Code | Unified AI API"
description: "Access hundreds of AI models through a single API by configuring OpenRouter in Kilo Code. Setup guide for VS Code and the CLI."
sidebar_label: OpenRouter
---

# Using OpenRouter With Kilo Code

OpenRouter is an AI platform that provides access to a wide variety of language models from different providers, all through a single API. This can simplify setup and allow you to easily experiment with different models.

**Website:** [https://openrouter.ai/](https://openrouter.ai/)

## Getting an API Key

1.  **Sign Up/Sign In:** Go to the [OpenRouter website](https://openrouter.ai/). Sign in with your Google or GitHub account.
2.  **Get an API Key:** Go to the [keys page](https://openrouter.ai/keys). You should see an API key listed. If not, create a new key.
3.  **Copy the Key:** Copy the API key.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab to add OpenRouter and enter your API key.

The extension stores this in your `kilo.json` config file. You can also edit the config file directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="CLI" %}

Set the API key as an environment variable or configure it in your `kilo.json` config file:

**Environment variable:**

```bash
export OPENROUTER_API_KEY="your-api-key"
```

**Config file** (`~/.config/kilo/kilo.json` or `./kilo.json`):

```jsonc
{
  "provider": {
    "openrouter": {
      "env": ["OPENROUTER_API_KEY"],
    },
  },
}
```

Then set your default model:

```jsonc
{
  "model": "openrouter/anthropic/claude-sonnet-4-20250514",
}
```

{% /tab %}
{% /tabs %}

## Supported Transforms

OpenRouter provides an [optional "middle-out" message transform](https://openrouter.ai/docs/guides/features/message-transforms) to help with prompts that exceed the maximum context size of a model.

The middle-out transform is not exposed as a dedicated UI control in the VS Code extension. To enable it, set `transforms` on the model's `options` in your `kilo.json` config file. Anything under `options` is forwarded verbatim to the OpenRouter AI SDK as `providerOptions.openrouter`:

```jsonc
{
  "provider": {
    "openrouter": {
      "models": {
        "anthropic/claude-sonnet-4-20250514": {
          "options": {
            "transforms": ["middle-out"],
          },
        },
      },
    },
  },
}
```

## Provider Routing

OpenRouter can route to many different inference providers. This can be controlled directly via OpenRouter's [`provider` routing parameter](https://openrouter.ai/docs/guides/routing/provider-selection).

Provider routing is not exposed as dedicated UI controls in the VS Code extension. To configure it, set OpenRouter's `provider` routing fields under the model's `options` in your `kilo.json` config file. Everything under `options` is forwarded to the OpenRouter AI SDK as `providerOptions.openrouter`, so any field from the [OpenRouter provider routing docs](https://openrouter.ai/docs/guides/routing/provider-selection) can be used.

```jsonc
{
  "provider": {
    "openrouter": {
      "models": {
        "anthropic/claude-sonnet-4-20250514": {
          "options": {
            "provider": {
              "sort": "price", // "price" | "throughput" | "latency"
              "order": ["Anthropic", "Google"], // specific provider preference
              "only": ["Anthropic"], // restrict to listed providers
              "data_collection": "deny", // "allow" | "deny"
              "zdr": true, // zero data retention
            },
          },
        },
      },
    },
  },
}
```

Omit any field to fall back to your OpenRouter account's default. Fields are passed through without validation — see OpenRouter's docs for the full list of supported values.

## Tips and Notes

- **Model Selection:** OpenRouter offers a wide range of models. Experiment to find the best one for your needs.
- **Pricing:** OpenRouter charges based on the underlying model's pricing. See the [OpenRouter Models page](https://openrouter.ai/models) for details.
- **Prompt Caching:** Some providers support prompt caching. See the OpenRouter documentation for supported models.
