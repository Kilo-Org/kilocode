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
{% tab label="VSCode (Legacy)" %}

1.  **Open Kilo Code Settings:** Click the gear icon ({% codicon name="gear" /%}) in the Kilo Code panel.
2.  **Select Provider:** Choose "OpenRouter" from the "API Provider" dropdown.
3.  **Enter API Key:** Paste your OpenRouter API key into the "OpenRouter API Key" field.
4.  **Select Model:** Choose your desired model from the "Model" dropdown.
5.  **(Optional) Custom Base URL:** If you need to use a custom base URL for the OpenRouter API, check "Use custom base URL" and enter the URL. Leave this blank for most users.

{% /tab %}
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

OpenRouter provides an [optional "middle-out" message transform](https://openrouter.ai/docs/features/message-transforms) to help with prompts that exceed the maximum context size of a model. You can enable it by checking the "Compress prompts and message chains to the context size" box.

## Provider Routing

OpenRouter can route to many different inference providers and this can be controlled in the API Provider settings under Provider Routing.

### Provider Sorting

- Default provider sorting: use the setting in your OpenRouter account
- Prefer providers with lower price
- Prefer providers with higher throughput (i.e. more tokens per seconds)
- Prefer providers with lower latency (i.e. shorter time to first token)
- A specific provider preference can also be chosen.

### Data Policy

- No data policy set: use the settings in your OpenRouter account.
- Allow prompt training: providers that may train on your prompts or completions are allowed. Free models generally require this option to be enabled.
- Deny prompt training: providers that may train on your prompts or completions are not allowed.
- Zero data retention: only providers with a strict zero data retention policy are allowed. This option is not recommended, as it will disable many popular providers, such as Anthropic and OpenAI.

## Tips and Notes

- **Model Selection:** OpenRouter offers a wide range of models. Experiment to find the best one for your needs.
- **Pricing:** OpenRouter charges based on the underlying model's pricing. See the [OpenRouter Models page](https://openrouter.ai/models) for details.
- **Prompt Caching:** Some providers support prompt caching. See the OpenRouter documentation for supported models.
