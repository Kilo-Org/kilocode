---
sidebar_label: OpenAI Compatible
---

# Using OpenAI Compatible Providers With Kilo Code

Kilo Code supports a wide range of AI model providers that offer APIs compatible with the OpenAI API standard. This means you can use models from providers _other than_ OpenAI, while still using a familiar API interface. This includes providers like:

- **Local models** running through tools like Ollama and LM Studio (covered in separate sections).
- **Cloud providers** like Perplexity, Together AI, Anyscale, and others.
- **Any other provider** offering an OpenAI-compatible API endpoint.

This document focuses on setting up providers _other than_ the official OpenAI API (which has its own [dedicated configuration page](/docs/ai-providers/openai)).

## General Configuration

{% tabs %}
{% tab label="VSCode (Legacy)" %}

The key to using an OpenAI-compatible provider is to configure two main settings:

1.  **Base URL:** This is the API endpoint for the provider. It will _not_ be `https://api.openai.com/v1` (that's for the official OpenAI API).
2.  **API Key:** This is the secret key you obtain from the provider.
3.  **Model ID:** This is the model name of the specific model.

You'll find these settings in the Kilo Code settings panel (click the {% codicon name="gear" /%} icon):

- **API Provider:** Select "OpenAI Compatible".
- **Base URL:** Enter the base URL provided by your chosen provider. **This is crucial.**
- **API Key:** Enter your API key.
- **Model:** Choose a model.
- **Model Configuration:** This lets you customize advanced configuration for the model
  - Max Output Tokens
  - Context Window
  - Image Support
  - Computer Use
  - Input Price
  - Output Price

{% /tab %}
{% tab label="VSCode" %}

1. Open **Settings** (gear icon) and go to the **Providers** tab.
2. Scroll to the bottom and click **Custom provider**.

![Custom provider button](/docs/img/custom-models/custom-provider-button.png)

3. Fill in the custom provider dialog:

![Custom provider configuration dialog](/docs/img/custom-models/custom-provider-details.png)

- **Provider ID** — A unique identifier (e.g., `my-provider`).
- **Display name** — A human-readable name shown in the UI.
- **Base URL** — The provider's OpenAI-compatible API endpoint (e.g., `https://api.your-provider.com/v1`). Kilo auto-fetches available models when a valid URL is entered.
- **API key** — Your API key. Optional — leave empty if authentication is handled via headers.
- **Models** — Add models manually or select from the auto-fetched list (see [Automatic Model Detection](#automatic-model-detection) below).
- **Headers** (optional) — Custom HTTP headers as key-value pairs.

4. Click **Submit** to save. The provider's models appear in the model picker.

For additional model configuration (token limits, tool calling, variants), edit the `kilo.jsonc` config file directly — see the **CLI** tab or the [Custom Models](/docs/code-with-ai/agents/custom-models) guide.

### Automatic Model Detection

When configuring a custom OpenAI-compatible provider, Kilo Code can automatically detect available models from your provider's `/v1/models` endpoint.

Once you enter a valid **Base URL** and **API Key**, Kilo Code will query the provider and present a searchable model picker with all available models. You can:

- **Search** with fuzzy matching (e.g., typing "gpt4o" finds "gpt-4o-mini")
- **Select** individual models to add to the provider configuration
- **Edit** an existing custom provider to add or remove models later

This eliminates the need to manually look up and type model IDs. If auto-detection fails (for example, if the provider doesn't support the `/v1/models` endpoint), you can still enter model IDs manually.

{% /tab %}
{% tab label="CLI" %}

Define a custom provider in your `kilo.json` config file (`~/.config/kilo/kilo.json` or `./kilo.json`). The provider key (e.g., `"vllm"`) is your chosen identifier — it can be any name you like.

You must define at least one model. Setting `name` and `limit` (context window and max output tokens) is recommended so the agent can manage context correctly:

```jsonc
{
  "provider": {
    "vllm": {
      "models": {
        "qwen35": {
          "name": "Qwen 3.5",
          "limit": {
            "context": 262144,
            "output": 16384,
          },
        },
      },
      "options": {
        "apiKey": "none",
        "baseURL": "http://my.url:8000/v1",
      },
    },
  },
}
```

Then set your default model using the `provider-id/model-id` format:

```jsonc
{
  "model": "vllm/qwen35",
}
```

**Configuration fields:**

- **`models`** — A map of model IDs to model definitions. Each model should include a `name` and `limit` with `context` and `output` token counts. If `limit.context` or `limit.output` is omitted, it defaults to `0`, which limits context management.
- **`options.baseURL`** — The base URL of your OpenAI-compatible API endpoint.
- **`options.apiKey`** — Your API key. Use any non-empty string (e.g., `"none"`) if the provider doesn't require authentication.

You can also set the API key via an environment variable instead of putting it in the config file. Use the `env` field to specify which variable to read:

```jsonc
{
  "provider": {
    "my-provider": {
      "env": ["MY_PROVIDER_API_KEY"],
      "models": {
        "my-model": {
          "name": "My Model",
          "limit": { "context": 128000, "output": 4096 },
        },
      },
      "options": {
        "baseURL": "https://api.my-provider.com/v1",
      },
    },
  },
}
```

{% /tab %}
{% /tabs %}

### Full Endpoint URL Support

Kilo Code supports full endpoint URLs in the Base URL field, providing greater flexibility for provider configuration:

**Standard Base URL Format:**

```
https://api.provider.com/v1
```

**Full Endpoint URL Format:**

```
https://api.provider.com/v1/chat/completions
https://custom-endpoint.provider.com/api/v2/models/chat
```

This enhancement allows you to:

- Connect to providers with non-standard endpoint structures
- Use custom API gateways or proxy services
- Work with providers that require specific endpoint paths
- Integrate with enterprise or self-hosted API deployments

**Note:** When using full endpoint URLs, ensure the URL points to the correct chat completions endpoint for your provider.

## Troubleshooting

- **"Invalid API Key":** Double-check that you've entered the API key correctly.
- **"Model Not Found":** Make sure you're using a valid model ID for your chosen provider.
- **Connection Errors:** Verify the Base URL is correct and that your provider's API is accessible.
- **Unexpected Results:** If you're getting unexpected results, try a different model.

By using an OpenAI-compatible provider, you can leverage the flexibility of Kilo Code with a wider range of AI models. Remember to always consult your provider's documentation for the most accurate and up-to-date information.
