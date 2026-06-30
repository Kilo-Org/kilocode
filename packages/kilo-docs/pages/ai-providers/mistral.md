---
title: "Using Mistral AI with Kilo Code"
description: "Configure Mistral AI models, including Codestral, in Kilo Code. Guide to getting an API key and setup for VS Code and the CLI."
sidebar_label: Mistral AI
---

# Using Mistral AI With Kilo Code

Kilo Code supports accessing models through the Mistral AI API, including both standard Mistral models and the code-specialized Codestral model.

**Website:** [https://mistral.ai/](https://mistral.ai/)

## Getting an API Key

1.  **Sign Up/Sign In:** Go to the [Mistral Platform](https://console.mistral.ai/). Create an account or sign in. You may need to go through a verification process.
2.  **Create an API Key:**
    - [La Plateforme API Key](https://console.mistral.ai/api-keys/) and/or
    - [Codestral API Key](https://console.mistral.ai/codestral)

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab to add Mistral and enter your API key.

The extension stores this in your `kilo.json` config file. You can also edit the config file directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="CLI" %}

Set the API key as an environment variable or configure it in your `kilo.json` config file:

**Environment variable:**

```bash
export MISTRAL_API_KEY="your-api-key"
```

**Config file** (`~/.config/kilo/kilo.json` or `./kilo.json`):

```jsonc
{
  "provider": {
    "mistral": {
      "env": ["MISTRAL_API_KEY"],
    },
  },
}
```

Then set your default model:

```jsonc
{
  "model": "mistral/mistral-large-latest",
}
```

{% /tab %}
{% /tabs %}

## Reasoning Variants

Mistral's adjustable reasoning support is exposed only for reasoning-capable Mistral Small 4 models: `mistral-small-2603` and `mistral-small-latest`. When one of these models is selected, Kilo offers a `high` variant that sends `reasoningEffort: "high"` to the Mistral provider.

Other Mistral models do not get automatic reasoning variants, even if they appear in the same provider. See Mistral's [reasoning documentation](https://docs.mistral.ai/studio-api/conversations/reasoning) for provider-level details.

## Using Codestral

[Codestral](https://docs.mistral.ai/vibe/code/overview) is a model specifically designed for code generation and interaction.
Only for Codestral you could use different endpoints (Default: codestral.mistral.ai).
For the La Platforme API Key change the **Codestral Base Url** to: https://api.mistral.ai

To use Codestral:

1.  **Select "Mistral" as the API Provider.**
2.  **Select a Codestral Model**
3.  **Enter your Codestral (codestral.mistral.ai) or La Plateforme (api.mistral.ai) API Key.**
