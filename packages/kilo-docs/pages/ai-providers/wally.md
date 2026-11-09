---
title: "Using Wally with Kilo Code | OpenAI-Compatible Inference"
description: "Configure Wally by RunAnywhere in Kilo Code. Built-in OpenAI-compatible provider for open-weight models such as DeepSeek, GLM, Kimi, and MiniMax."
sidebar_label: Wally
---

# Using Wally With Kilo Code

[Wally](https://www.runwally.com/) is RunAnywhere's inference API for open-weight models, served behind an OpenAI-compatible API. Kilo Code ships it as a **built-in provider**, so you can connect with an API key and start coding. Kilo Code uses the `wally` provider ID and reads your API key from `WALLY_API_KEY`.

**Website:** [https://www.runwally.com/](https://www.runwally.com/)

## Before you begin

1. Create an account at [console.runanywhere.ai](https://console.runanywhere.ai/).
2. Create a Cloud API key in the console and copy it.
3. Choose a model ID. Model availability and pricing change, so check the live catalog instead of copying an old model list:

```bash
export WALLY_API_KEY="your-api-key"

curl https://inference.runanywhere.ai/v1/models \
  -H "Authorization: Bearer $WALLY_API_KEY"
```

## Configure Kilo Code

Wally is a **built-in provider** in Kilo Code, so you connect it directly without any custom provider setup.

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** (gear icon) and go to the **Providers** tab.
2. Click **Show more providers**, search for **Wally**, and select it.
3. Paste your Wally API key.
4. Pick a model from the list.

The provider credentials are stored in Kilo's `auth.json` store.

{% /tab %}
{% tab label="CLI" %}

**Recommended:** connect interactively so the API key is stored in Kilo's `auth.json` store, the same credential store the VS Code extension uses.

1. In the TUI, open the model picker with `/models`, press **Ctrl + A** to connect a provider, choose **Wally**, then paste your API key.
2. Or from the shell:

```bash
kilo auth login --provider wally
```

Then pick a model from the model picker, or set a default model in `provider-id/model-id` form:

```jsonc
{
  "model": "wally/deepseek-v4.1-flash",
}
```

**Manual configuration (optional):** keep the key in the environment and declare the provider in `~/.config/kilo/kilo.json` or `./kilo.json`, so the secret never lands in the project file:

```bash
export WALLY_API_KEY="your-api-key"
```

```jsonc
{
  "provider": {
    "wally": {
      "env": ["WALLY_API_KEY"],
    },
  },
  "model": "wally/deepseek-v4.1-flash",
}
```

{% /tab %}
{% /tabs %}

## Model naming

A full model reference in Kilo Code is `wally/<model-id>`. For example:

```jsonc
{
  "model": "wally/glm-5.3-flash",
}
```

```jsonc
{
  "model": "wally/kimi-k3",
}
```

Current models support tool calling, and some, such as `deepseek-v4.1-flash` and `kimi-k3`, also accept image input. Check the catalog for each model's context window and input types.

## OpenAI compatibility

Kilo Code connects to Wally through the OpenAI-compatible API at `https://inference.runanywhere.ai/v1`. Keep the trailing `/v1` if you point the provider at a custom base URL or add Wally as a manual [OpenAI Compatible](/docs/ai-providers/openai-compatible) provider.

## Tips and notes

- **Model list:** The picker comes from the [models.dev](https://models.dev/providers/wally) catalog, which can lag behind Wally's `/v1/models` endpoint. To use a model that the endpoint lists but the picker does not, add it under `provider.wally.models` with limits taken from the endpoint (`context_length` and `max_output_tokens`). See [Custom Models](/docs/code-with-ai/agents/custom-models) for all fields.

```jsonc
{
  "provider": {
    "wally": {
      "models": {
        "<model-id>": {
          "name": "<display name>",
          "tool_call": true,
          "limit": { "context": 1048576, "output": 65536 },
        },
      },
    },
  },
}
```

- **Pricing:** Wally bills per token against prepaid credits. See [Wally pricing](https://www.runwally.com/pricing) for current rates.
- **API reference:** See the [Wally API docs](https://docs.runanywhere.ai/wally-cloud/api) for endpoints and request options.

## Troubleshooting

- **Invalid API key:** create a new key in the RunAnywhere console, then reconnect with `/connect` or `kilo auth login --provider wally`, or update `WALLY_API_KEY` if you use manual configuration.
- **Model not found:** copy the model ID exactly as the catalog shows it. If the ID is correct but Kilo Code still reports it as not found, the model is not in Kilo Code's catalog yet; add it under `provider.wally.models` as shown above.
- **Provider not visible:** refresh Kilo Code's provider catalog, then check **Show more providers**.
