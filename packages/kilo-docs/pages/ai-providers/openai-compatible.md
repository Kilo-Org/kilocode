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
- **Models** — Add models manually or select from the auto-fetched list.
- **Headers** (optional) — Custom HTTP headers as key-value pairs.

4. Click **Submit** to save. The provider's models appear in the model picker.

For additional model configuration (token limits, tool calling, variants), edit the `kilo.jsonc` config file directly — see the **CLI** tab or the [Custom Models](/docs/code-with-ai/agents/custom-models) guide.

{% /tab %}
{% tab label="CLI" %}

Set the API key and base URL as environment variables or configure them in your `kilo.json` config file:

**Environment variable:**

```bash
export OPENAI_API_KEY="your-api-key"
```

**Config file** (`~/.config/kilo/kilo.json` or `./kilo.json`):

```jsonc
{
  "provider": {
    "openai-compatible": {
      "env": ["OPENAI_API_KEY"],
      "baseURL": "https://api.your-provider.com/v1",
    },
  },
}
```

Then set your default model:

```jsonc
{
  "model": "openai-compatible/model-name",
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
