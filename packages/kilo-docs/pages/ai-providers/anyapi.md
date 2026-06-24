---
sidebar_label: AnyAPI
---

# Using AnyAPI With Kilo Code

Kilo Code supports AnyAPI as a native provider. AnyAPI is a unified AI platform that provides access to over 400 AI models from leading providers (OpenAI, Anthropic, Google, Meta, and more) through a single, OpenAI-compatible API endpoint.

**Website:** [https://anyapi.ai/](https://anyapi.ai/)

## Getting an API Key

1.  **Sign Up:** Go to the [AnyAPI Dashboard](https://dash.anyapi.ai) and create a free account.
2.  **Get an API Key:** Navigate to [API Keys](https://dash.anyapi.ai/?page=api-keys) and click **Create New Key**.
3.  **Copy the Key:** Copy your API key and store it securely.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab to add AnyAPI and enter your API key.

The extension stores this in your `kilo.json` config file. You can also edit the config file directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="CLI" %}

Set the API key as an environment variable or configure it in your `kilo.json` config file:

**Environment variable:**

```bash
export ANYAPI_API_KEY="your-api-key"
```

**Config file** (`~/.config/kilo/kilo.json` or `./kilo.json`):

```jsonc
{
  "provider": {
    "anyapi": {
      "env": ["ANYAPI_API_KEY"]
    }
  }
}
```

Then select an AnyAPI model from the model picker, or set a default model:

```jsonc
{
  "model": "anyapi/openai/gpt-4o"
}
```

You can also set a custom base URL if needed:

```jsonc
{
  "provider": {
    "anyapi": {
      "env": ["ANYAPI_API_KEY"],
      "options": {
        "baseURL": "https://api.anyapi.ai/v1"
      }
    }
  }
}
```

{% /tab %}
{% tab label="VSCode (Legacy)" %}

Use the **OpenAI Compatible** provider. Enter your AnyAPI base URL (`https://api.anyapi.ai/v1`), API key, and model ID (e.g. `openai/gpt-4o`).

{% /tab %}
{% /tabs %}

## Tips and Notes

- **OpenAI Compatible:** AnyAPI uses an OpenAI-compatible API, so all standard chat completion features work out of the box.
- **Model Selection:** AnyAPI provides access to 400+ models. Use the model picker to browse available models, or check the [AnyAPI docs](https://docs.anyapi.ai) for the full catalog.
- **Pricing:** AnyAPI uses its internal token system (₳nyTokens). Free tier includes 100K tokens/day. See [AnyAPI Pricing](https://anyapi.ai/pricing) for details.
- **Tool Calling:** Models support tool/function calling when the underlying model supports it.
- **Streaming:** Real-time streaming responses are supported for all chat models.

## Troubleshooting

- **Invalid API key:** Verify `ANYAPI_API_KEY` is set in the same environment that launches Kilo, or reconnect the provider in Settings.
- **Model not available:** Refresh providers or pick a current model from the model picker. Some models may require a Pro plan.
- **Custom endpoint issues:** Confirm `ANYAPI_BASE_URL` points to the correct OpenAI-compatible endpoint (`https://api.anyapi.ai/v1`).
