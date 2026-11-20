---
title: "Using Mistral AI with Kilo Code"
description: "Configure Mistral AI models, including Codestral, in Kilo Code. Guide to getting an API key and setup for VS Code and the CLI."
sidebar_label: Mistral AI
---

# Using Mistral AI With Kilo Code

Kilo Code supports accessing models through the Mistral AI API, including both standard Mistral models and the code-specialized Codestral model.

**Website:** [https://mistral.ai/](https://mistral.ai/)

## Getting an API Key

1. Sign in to [Mistral AI Studio](https://console.mistral.ai/).
2. Open **API Keys** and create a standard Studio API key.
3. Copy the key and store it securely. Mistral only shows the full key once.

You do not need a separate Codestral key. See Mistral's [API key setup guide](https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key) for the current steps.

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

[Codestral](https://docs.mistral.ai/models/codestral-25-08) supports code completion through Mistral's [FIM API](https://docs.mistral.ai/api/endpoint/fim). Use a standard Studio API key for requests to `https://api.mistral.ai`.

For autocomplete through Kilo Gateway, add the key under **Mistral AI** on the Kilo BYOK page and select Codestral as your autocomplete model. Follow the [Mistral autocomplete setup guide](/docs/code-with-ai/features/autocomplete/mistral-setup) for the steps and legacy-key troubleshooting.
