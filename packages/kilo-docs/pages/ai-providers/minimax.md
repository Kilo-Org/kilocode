---
title: "Using MiniMax with Kilo Code"
description: "Configure MiniMax AI models in Kilo Code. Guide to getting an API key and setup for VS Code and the CLI."
sidebar_label: MiniMax
---

# Using MiniMax With Kilo Code

MiniMax is a global AI foundation model company focused on fast, cost-efficient multimodal models with strong coding, tool-use, and agentic capabilities. Their flagship MiniMax M2.1 model delivers high-speed inference, long-context reasoning, and advanced development workflow support.

**Website:** [https://www.minimax.io/](https://www.minimax.io/)

## Getting an API Key

1. **Sign Up/Sign In:** Go to the [MiniMax Console](https://platform.minimax.io/). Create an account or sign in.
2. **Open the API Keys Page:** Navigate to your **Profile > API Keys**.
3. **Create a Key:** Click to generate a new API key and give it a descriptive name (e.g., "Kilo Code").
4. **Copy the Key:** Copy the key immediately. You may not be able to view it again. Store it securely.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode (Legacy)" %}

1. **Open Kilo Code Settings:** Click the gear icon ({% codicon name="gear" /%}) in the Kilo Code panel.
2. **Select Provider:** Navigate to **Providers**. Choose **MiniMax** from the API Provider dropdown.
3. **Enter API Key:** Paste your MiniMax API key into the MiniMax API Key field.
4. **Select Model:** Choose your desired MiniMax model from the Model dropdown.

{% /tab %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab to add MiniMax and enter your API key.

The extension stores this in your `kilo.json` config file. You can also edit the config file directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="CLI" %}

Set the API key as an environment variable or configure it in your `kilo.json` config file:

**Environment variable:**

```bash
export MINIMAX_API_KEY="your-api-key"
```

**Config file** (`~/.config/kilo/kilo.json` or `./kilo.json`):

```jsonc
{
  "provider": {
    "minimax": {
      "env": ["MINIMAX_API_KEY"],
    },
  },
}
```

Then set your default model:

```jsonc
{
  "model": "minimax/MiniMax-M1",
}
```

{% /tab %}
{% /tabs %}

## Tips and Notes

- **Performance:** MiniMax M2.1 emphasizes fast inference, strong coding ability, and exceptional tool-calling performance.
- **Context Window:** MiniMax models support ultra-long context windows suitable for large codebases and agent workflows.
- **Pricing:** Pricing varies by model, with input costs ranging from $0.20 to $0.30 per million tokens and output costs from $1.10 to $2.20 per million tokens. Refer to the MiniMax documentation for the most current pricing information.
