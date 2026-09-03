---
title: "Using Synthetic with Kilo Code"
description: "Access open-source AI models through Synthetic in Kilo Code. Setup guide for getting an API key and configuring models."
sidebar_label: Synthetic
---

# Using Synthetic With Kilo Code

Synthetic provides access to several open-source AI models running on secure infrastructure within the US and EU. They offer both subscription-based and usage-based pricing options, with strong privacy guarantees - they never train on your data and auto-delete API data within 14 days.

**Website:** [https://synthetic.new](https://synthetic.new)

## Getting an API Key

1. **Sign Up/Sign In:** Go to [Synthetic](https://synthetic.new) and create an account or sign in.
2. **Navigate to API Keys:** After logging in, go to the [API Keys page](https://synthetic.new/user-settings/api) in your account settings.
3. **Copy your Key:** Click the Copy icon next to your key to copy it to your clipboard.

## Supported Models

Kilo Code supports all "always on" Synthetic AI models. The available models include various open-source options optimized for different use cases.

**Note:** Model availability may change. Refer to the [Synthetic documentation](https://synthetic.new) for the most up-to-date list of supported models and their capabilities.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab to add Synthetic and enter your API key.

The extension stores this in your `kilo.json` config file. You can also edit the config file directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="CLI" %}

Set the API key as an environment variable or configure it in your `kilo.json` config file:

```bash
export SYNTHETIC_API_KEY="your-api-key"
```

```jsonc
{
  "provider": {
    "synthetic": {
      "env": ["SYNTHETIC_API_KEY"],
    },
  },
}
```

Select a Synthetic model from the model picker after authentication, or set its full `synthetic/<model-id>` identifier as your default model.

{% /tab %}
{% /tabs %}

## Tips and Notes

- **Pricing Options:** Synthetic offers both subscriptions and pay-as-you-go usage-based [pricing](https://synthetic.new/pricing).
- **Privacy:** Strong privacy policy with no training on user data and automatic deletion of API data within 14 days.
- **OpenAI Compatibility:** Synthetic models work with any OpenAI-compatible tools and applications.
