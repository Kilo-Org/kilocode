---
title: "Using AIHubMix with Kilo Code | Unified AI Gateway"
description: "Access OpenAI, Claude, Gemini, DeepSeek, Qwen, and 500+ AI models through a single AIHubMix API key in Kilo Code. Setup guide for VS Code and the CLI."
---

# Using AIHubMix With Kilo Code

AIHubMix is an AI gateway that provides unified access to models from OpenAI, Anthropic, Google, DeepSeek, Qwen, and other providers through a single API. It offers competitive pricing and supports features like prompt caching.

**Website:** [https://aihubmix.com/](https://aihubmix.com/)

## Getting an API Key

1. **Sign Up/Sign In:** Go to [AIHubMix](https://aihubmix.com/) and create an account or sign in.
2. **Create a Key:** Go to the [API Keys page](https://aihubmix.com/token) and generate an API key.
3. **Copy the Key:** Copy the API key and store it securely.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab to add AIHubMix and enter your API key.

The extension stores this in your `kilo.json` config file. You can also edit the config file directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="CLI" %}

Set the API key as an environment variable or configure it in your `kilo.json` config file:

**Environment variable:**

```bash
export AIHUBMIX_API_KEY="your-api-key"
```

**Config file** (`~/.config/kilo/kilo.json` or `./kilo.json`):

```jsonc
{
  "provider": {
    "aihubmix": {
      "env": ["AIHUBMIX_API_KEY"],
    },
  },
}
```

Then set your default model:

```jsonc
{
  "model": "aihubmix/claude-sonnet-4-6",
}
```

{% /tab %}
{% /tabs %}

## Tips and Notes

- **Model Selection:** AIHubMix offers a wide range of models from multiple providers behind one API key.
- **Pricing:** AIHubMix charges based on the underlying model's pricing. See the [AIHubMix Models page](https://aihubmix.com/models) for details.
- **Prompt Caching:** Some models support prompt caching. See the [AIHubMix documentation](https://docs.aihubmix.com) for supported models.
