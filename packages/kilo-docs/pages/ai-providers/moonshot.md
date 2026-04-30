---
title: "Using Moonshot AI (Kimi) with Kilo Code"
description: "Connect Moonshot's Kimi models to Kilo Code. Setup guide for getting an API key and selecting models in VS Code and the CLI."
sidebar_label: Moonshot.ai
---

# Using Moonshot.ai With Kilo Code

Moonshot.ai is a Chinese AI company known for their **Kimi** models featuring ultra-long context windows (up to 200K tokens) and advanced reasoning capabilities. Their K2-Thinking model delivers extended thinking and problem-solving abilities.

**Website:** [https://www.moonshot.cn/](https://www.moonshot.cn/)

## Getting an API Key

1. **Sign Up/Sign In:** Go to the [Moonshot.ai Platform](https://platform.moonshot.cn/). Create an account or sign in.
2. **Navigate to API Keys:** Access the API Keys section in your account dashboard.
3. **Create a Key:** Click to generate a new API key. Give it a descriptive name (e.g., "Kilo Code").
4. **Copy the Key:** **Important:** Copy the API key _immediately_. Store it securely.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode (Legacy)" %}

1. **Open Kilo Code Settings:** Click the gear icon ({% codicon name="gear" /%}) in the Kilo Code panel.
2. **Select Provider:** Choose "Moonshot.ai" from the "API Provider" dropdown.
3. **Enter API Key:** Paste your Moonshot.ai API key into the "Moonshot.ai API Key" field.
4. **Select Model:** Choose your desired model from the "Model" dropdown.

{% /tab %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab to add Moonshot.ai and enter your API key.

The extension stores this in your `kilo.json` config file. You can also edit the config file directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="CLI" %}

Set the API key as an environment variable or configure it in your `kilo.json` config file:

**Environment variable:**

```bash
export MOONSHOT_API_KEY="your-api-key"
```

**Config file** (`~/.config/kilo/kilo.json` or `./kilo.json`):

```jsonc
{
  "provider": {
    "moonshotai": {
      "env": ["MOONSHOT_API_KEY"],
    },
  },
}
```

Then set your default model:

```jsonc
{
  "model": "moonshotai/moonshot-v1-auto",
}
```

{% /tab %}
{% /tabs %}

## Tips and Notes

- **Ultra-Long Context:** Kimi models excel at handling large codebases and complex projects with their extended context windows.
- **Reasoning Capabilities:** The K2-Thinking variant provides enhanced problem-solving through extended reasoning chains.
- **Kimi-specific prompting:** Kilo automatically uses a Kimi-tuned system prompt for model IDs containing `kimi`; no extra configuration is required.
- **Language Support:** Kimi models have strong support for both English and Chinese languages.
- **Pricing:** Refer to the Moonshot.ai platform for current pricing information on different models.
