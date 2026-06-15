---
title: "Using Cerebras with Kilo Code | Ultra-Fast Inference"
description: "Run Llama and Qwen models at record-breaking speeds by configuring Cerebras in Kilo Code. Setup for VS Code and the CLI."
sidebar_label: Cerebras
---

# Using Cerebras With Kilo Code

Cerebras is known for their ultra-fast AI inference powered by the Cerebras CS-3 chip, the world's largest and fastest AI accelerator. Their platform delivers exceptional inference speeds for large language models, making them ideal for interactive development workflows.

**Website:** [https://cerebras.ai/](https://cerebras.ai/)

## Getting an API Key

1. **Sign Up/Sign In:** Go to the [Cerebras Cloud Platform](https://cloud.cerebras.ai/). Create an account or sign in.
2. **Navigate to API Keys:** Access the API Keys section in your account dashboard.
3. **Create a Key:** Click to generate a new API key. Give it a descriptive name (e.g., "Kilo Code").
4. **Copy the Key:** **Important:** Copy the API key _immediately_. Store it securely.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode (Legacy)" %}

1. **Open Kilo Code Settings:** Click the gear icon ({% codicon name="gear" /%}) in the Kilo Code panel.
2. **Select Provider:** Choose "Cerebras" from the "API Provider" dropdown.
3. **Enter API Key:** Paste your Cerebras API key into the "Cerebras API Key" field.
4. **Select Model:** Choose your desired model from the "Model" dropdown.

{% /tab %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab to add Cerebras and enter your API key.

The extension stores this in your `kilo.json` config file. You can also edit the config file directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="CLI" %}

Set the API key as an environment variable or configure it in your `kilo.json` config file:

**Environment variable:**

```bash
export CEREBRAS_API_KEY="your-api-key"
```

**Config file** (`~/.config/kilo/kilo.json` or `./kilo.json`):

```jsonc
{
  "provider": {
    "cerebras": {
      "env": ["CEREBRAS_API_KEY"],
    },
  },
}
```

Then set your default model:

```jsonc
{
  "model": "cerebras/llama-4-scout-17b-16e-instruct",
}
```

{% /tab %}
{% /tabs %}

## Tips and Notes

- **Inference Speed:** Cerebras models deliver some of the fastest inference speeds available, reducing wait times during development.
- **Open Source Models:** Many Cerebras models are based on open-source architectures, optimized for their custom hardware.
- **Cost Efficiency:** Fast inference can lead to better cost efficiency for interactive use cases.
- **Pricing:** Refer to the Cerebras platform for current pricing information and available plans.
