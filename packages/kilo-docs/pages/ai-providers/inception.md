---
title: "Using Inception Labs with Kilo Code"
description: "Connect Inception Labs' Mercury diffusion LLMs to Kilo Code for ultra-fast code generation. Setup guide for VS Code and the CLI."
sidebar_label: Inception
---

# Using Inception With Kilo Code

Inception provides access to cutting-edge AI models with a focus on performance and reliability. Their infrastructure is designed for enterprise-grade applications requiring consistent, high-quality outputs.

**Website:** [https://www.inceptionlabs.ai](https://www.inceptionlabs.ai)

## Getting an API Key

1. **Sign Up/Sign In:** Go to the [Inception website](https://www.inceptionlabs.ai) and access their developer/API dashboard.
2. **Navigate to API Keys:** Access the API Keys section in your account settings.
3. **Create a Key:** Click "Create new API key". Give your key a descriptive name (e.g., "Kilo Code").
4. **Copy the Key:** **Important:** Copy the API key _immediately_. You will not be able to see it again. Store it securely.

## Supported Models

Kilo Code supports Inception's available models. Model selection and capabilities may vary based on your account tier.

Refer to Inception's current website and developer documentation for the most up-to-date list of supported models and capabilities.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode (Legacy)" %}

1. **Open Kilo Code Settings:** Click the gear icon ({% codicon name="gear" /%}) in the Kilo Code panel.
2. **Select Provider:** Choose "Inception" from the "API Provider" dropdown.
3. **Enter API Key:** Paste your Inception API key into the "Inception API Key" field.
4. **Select Model:** Choose your desired model from the "Model" dropdown.

{% /tab %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab to add Inception and enter your API key.

The extension stores this in your `kilo.json` config file. You can also edit the config file directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="CLI" %}

Set the API key as an environment variable or configure it in your `kilo.json` config file:

**Environment variable:**

```bash
export INCEPTION_API_KEY="your-api-key"
```

**Config file** (`~/.config/kilo/kilo.json` or `./kilo.json`):

```jsonc
{
  "provider": {
    "inception": {
      "env": ["INCEPTION_API_KEY"],
    },
  },
}
```

Then set your default model:

```jsonc
{
  "model": "inception/mercury-coder-small-beta",
}
```

{% /tab %}
{% /tabs %}

## Tips and Notes

- **Enterprise Focus:** Inception is designed for production-grade AI applications with emphasis on reliability and consistency.
- **Pricing:** Refer to the Inception platform for current pricing details and available subscription options.
- **Support:** Enterprise customers have access to dedicated support channels for technical assistance.
- **Docs Feedback:** Report documentation issues at [Kilo-Org/kilocode issues](https://github.com/Kilo-Org/kilocode/issues/new?title=Documentation%20Issue:%20/docs/ai-providers/inception).
