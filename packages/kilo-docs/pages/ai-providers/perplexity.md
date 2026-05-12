---
title: "Using Perplexity with Kilo Code"
description: "Connect Perplexity's Sonar models to Kilo Code via BYOK or direct API. Setup guide for VS Code and the CLI."
sidebar_label: Perplexity
---

# Using Perplexity With Kilo Code

Kilo Code supports accessing Perplexity's **Sonar** models through the Perplexity API. Sonar models are search-augmented and designed for up-to-date, grounded responses — useful for tasks that benefit from real-time web information.

Perplexity is available as a direct provider and as a [BYOK](/docs/getting-started/byok) provider via the Kilo Gateway.

**Website:** [https://www.perplexity.ai/](https://www.perplexity.ai/)
**API Docs:** [https://docs.perplexity.ai/](https://docs.perplexity.ai/)

## Getting an API Key

1. **Sign Up/Sign In:** Go to [https://www.perplexity.ai/](https://www.perplexity.ai/) and create an account or sign in.
2. **Navigate to API Settings:** Open [https://www.perplexity.ai/settings/api](https://www.perplexity.ai/settings/api).
3. **Generate a Key:** Click "Generate" to create a new API key.
4. **Copy the Key:** Copy it immediately and store it securely — you will need it to configure Kilo Code.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode (Legacy)" %}

1. **Open Kilo Code Settings:** Click the gear icon ({% codicon name="gear" /%}) in the Kilo Code panel.
2. **Select Provider:** Choose "Perplexity" from the "API Provider" dropdown.
3. **Enter API Key:** Paste your Perplexity API key into the API key field.
4. **Select Model:** Choose a Sonar model from the "Model" dropdown (e.g., `sonar-pro` or `sonar`).

{% /tab %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab to add Perplexity and enter your API key.

The extension stores this in your `kilo.json` config file. You can also edit the config file directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="CLI" %}

Set your API key as an environment variable:

```bash
export PERPLEXITY_API_KEY="your-api-key"
```

Or configure it in your `kilo.json` config file:

```jsonc
{
  "provider": {
    "perplexity": {
      "env": ["PERPLEXITY_API_KEY"],
    },
  },
}
```

Then set your default model:

```jsonc
{
  "model": "perplexity/sonar-pro",
}
```

{% /tab %}
{% /tabs %}

## Available Models

Perplexity's Sonar family provides search-augmented language models:

| Model | Notes |
|---|---|
| `sonar-pro` | Largest Sonar model; best for complex, research-heavy tasks |
| `sonar` | Balanced performance and speed for everyday queries |
| `sonar-reasoning-pro` | Sonar Pro with extended reasoning (chain-of-thought) |
| `sonar-reasoning` | Sonar with reasoning capabilities |
| `sonar-deep-research` | Optimized for deep, multi-step research tasks |

The full and up-to-date model list is available in the [Perplexity API documentation](https://docs.perplexity.ai/guides/model-cards).

## Using Perplexity via BYOK (Kilo Gateway)

If you are using the **Kilo Gateway** provider, you can bring your own Perplexity API key so requests are billed directly to your Perplexity account:

1. Log into the [Kilo dashboard](https://app.kilo.ai) and navigate to the [BYOK page](https://app.kilo.ai/byok).
2. Select **Perplexity** as the provider and paste your API key.
3. Save. Future requests for Perplexity models will use your key at no Kilo markup.

See [Bring Your Own Key (BYOK)](/docs/getting-started/byok) for full instructions.

## Tips and Notes

- **Search augmentation:** Sonar models query the web at inference time. This makes them well-suited for questions about current events or recent documentation, but adds latency compared to purely parametric models.
- **Pricing:** Refer to the [Perplexity pricing page](https://www.perplexity.ai/settings/api) for current rates.
