---
title: "Using DotHoosh with Kilo Code | DotHoosh"
description: "Configure DotHoosh in Kilo Code — locally with your own API key from the DotHoosh gateway."
sidebar_label: DotHoosh
---

# Using DotHoosh With Kilo Code

DotHoosh (دات‌هوش) is an Iranian AI gateway billed in Toman (IRT) from a prepaid wallet. One API key serves Claude, GPT, Gemini, DeepSeek and Kimi models. You can connect it to Kilo Code locally with your own API key in the VS Code extension, JetBrains plugin, or CLI.

**Website:** [https://gateway.dothoosh.com/](https://gateway.dothoosh.com/)

## Prerequisites

- A DotHoosh API key
- Kilo Code installed: the [VS Code extension](/docs/code-with-ai/platforms/vscode), [JetBrains plugin](/docs/code-with-ai/platforms/jetbrains), or [CLI](/docs/code-with-ai/platforms/cli)

## Getting an API Key

1. **Sign Up/Sign In:** Go to [DotHoosh API keys](https://gateway.dothoosh.com/api-keys) and create an account or sign in.
2. **Create a Key:** Open the API Keys section and create a new API key.
3. **Copy the Key:** Copy the key and store it securely.

## Add Your Key Locally

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** (gear icon) and go to the **Providers** tab.
2. Click **Show more providers** and select **DotHoosh**.
3. Paste your API key and save.

The extension stores this in your `kilo.json` config file. You can also edit the config file directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="JetBrains" %}

1. Open **Settings** and go to **Kilo Code > Providers**.
2. Find **DotHoosh** in the **All providers** list, or use the filter box.
3. Click **Connect** and paste your API key.

{% /tab %}
{% tab label="CLI" %}

Run `kilo` and use the `/connect` command to add your DotHoosh API key interactively.

Alternatively, set the API key as an environment variable or configure it in your `kilo.json` config file:

**Environment variable:**

```bash
export DOTHOOSH_API_KEY="your-api-key"
```

**Config file** (`~/.config/kilo/kilo.json` or `./kilo.json`):

```jsonc
{
  "provider": {
    "dothoosh": {
      "env": ["DOTHOOSH_API_KEY"],
    },
  },
}
```

Then set your default model:

```jsonc
{
  "model": "dothoosh/claude-sonnet-5-5",
}
```

{% /tab %}
{% /tabs %}

## Select a DotHoosh Model

Once your key is configured, open the model picker and select any model tagged **DotHoosh**. Model IDs use the `dothoosh/<model>` format. Example models:

- `dothoosh/claude-sonnet-5-5`
- `dothoosh/gpt-6.1-sol`
- `dothoosh/deepseek-flash`
- `dothoosh/kimi-k3`

See [https://gateway.dothoosh.com/models](https://gateway.dothoosh.com/models) for the full model list.

## Tips and Notes

- **Images:** DotHoosh does not accept image input yet. Use text-only prompts with DotHoosh models for now.
- **Pricing:** DotHoosh bills in Toman (IRT) from your prepaid wallet. See [https://gateway.dothoosh.com/models](https://gateway.dothoosh.com/models) for current rates.
