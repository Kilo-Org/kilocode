---
title: "Using Ollama Cloud with Kilo Code"
description: "Connect to Ollama's cloud-hosted models in Kilo Code using your Ollama API key. Setup guide for VS Code and the CLI."
sidebar_label: Ollama Cloud
---

# Using Ollama Cloud With Kilo Code

Ollama Cloud is the managed cloud service from [Ollama](https://ollama.com/), offering hosted access to popular open-weight models without requiring local hardware. It uses an OpenAI-compatible API at `https://ollama.com/v1` and authenticates with an Ollama API key.

This is distinct from running Ollama locally. If you want to run models on your own machine, see the [Ollama (local)](/docs/ai-providers/ollama) guide instead.

**Website:** [https://ollama.com/](https://ollama.com/)
**API Docs:** [https://docs.ollama.com/cloud](https://docs.ollama.com/cloud)

## Getting an API Key

1. **Sign Up/Sign In:** Go to [https://ollama.com/](https://ollama.com/) and create an account or sign in.
2. **Generate a Key:** Navigate to your account settings and create an API key for Ollama Cloud.
3. **Copy the Key:** Store it securely — you will need it to configure Kilo Code.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode (Legacy)" %}

1. **Open Kilo Code Settings:** Click the gear icon ({% codicon name="gear" /%}) in the Kilo Code panel.
2. **Select Provider:** Choose "Ollama Cloud" from the "API Provider" dropdown.
3. **Enter API Key:** Paste your Ollama API key into the API key field.
4. **Select Model:** Choose a model from the "Model" dropdown (e.g., `qwen3-coder:480b` or `devstral-2:123b`).

{% /tab %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab to add Ollama Cloud and enter your API key.

The extension stores this in your `kilo.json` config file. You can also edit the config file directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="CLI" %}

Set your API key as an environment variable:

```bash
export OLLAMA_API_KEY="your-api-key"
```

Or configure it in your `kilo.json` config file:

```jsonc
{
  "provider": {
    "ollama-cloud": {
      "env": ["OLLAMA_API_KEY"],
    },
  },
}
```

Then set your default model:

```jsonc
{
  "model": "ollama-cloud/qwen3-coder:480b",
}
```

{% /tab %}
{% /tabs %}

## Available Models

Ollama Cloud hosts a selection of popular open-weight models. Some notable options for coding tasks:

| Model | Context | Notes |
|---|---|---|
| `qwen3-coder:480b` | 262,144 | Large coding-focused model |
| `devstral-2:123b` | 262,144 | Mistral's code-focused model |
| `devstral-small-2:24b` | 262,144 | Smaller devstral variant |
| `deepseek-v3.1:671b` | 163,840 | DeepSeek V3 |
| `deepseek-v3.2` | 163,840 | DeepSeek V3.2 |
| `kimi-k2.5` | 262,144 | Kimi K2.5 with reasoning |
| `kimi-k2:1t` | 262,144 | Kimi K2 1T |
| `qwen3.5:397b` | 262,144 | Qwen3.5 large |
| `gemma4:31b` | 262,144 | Google Gemma 4 |
| `glm-5` | 202,752 | Zhipu GLM-5 |

The full list of available models is shown in the Kilo model picker once your API key is configured. You can also browse models at [https://ollama.com/](https://ollama.com/).

## Tips and Notes

- **Same company, different product:** Ollama Cloud is a hosted service from the same team that makes the local Ollama tool. The `ollama-cloud` provider ID connects to `https://ollama.com/v1` and requires authentication, unlike the local `ollama` provider.
- **Model IDs:** Models use the same naming convention as the local Ollama library (e.g., `qwen3-coder:480b`). Use the `ollama-cloud/<model-id>` format when specifying models in config or CLI.
- **Pricing:** Refer to the [Ollama Cloud documentation](https://docs.ollama.com/cloud) for current pricing.
- **Local alternative:** If you have sufficient hardware and prefer offline access, consider [running Ollama locally](/docs/ai-providers/ollama) instead.
