---
title: "Using Groq with Kilo Code | Fast LLM Inference"
description: "Run Llama, Mixtral, and other models at ultra-low latency by configuring Groq in Kilo Code. Setup guide for VS Code and the CLI."
sidebar_label: Groq
---

# Using Groq With Kilo Code

Groq provides ultra-fast inference for various AI models through their high-performance infrastructure. Kilo Code supports accessing models through the Groq API.

**Website:** [https://groq.com/](https://groq.com/)

## Getting an API Key

To use Groq with Kilo Code, you'll need an API key from the [GroqCloud Console](https://console.groq.com/). After signing up or logging in, navigate to the API Keys section of your dashboard to create and copy your key.

## Supported Models

Kilo Code will attempt to fetch the list of available models from the Groq API.

**Note:** Model availability and specifications may change. Refer to the [Groq Documentation](https://console.groq.com/docs/models) for the most up-to-date list of supported models and their capabilities.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode (Legacy)" %}

1.  **Open Kilo Code Settings:** Click the gear icon ({% codicon name="gear" /%}) in the Kilo Code panel.
2.  **Select Provider:** Choose "Groq" from the "API Provider" dropdown.
3.  **Enter API Key:** Paste your Groq API key into the "Groq API Key" field.
4.  **Select Model:** Choose your desired model from the "Model" dropdown.

{% /tab %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab to add Groq and enter your API key.

The extension stores this in your `kilo.json` config file. You can also edit the config file directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="CLI" %}

Set the API key as an environment variable or configure it in your `kilo.json` config file:

**Environment variable:**

```bash
export GROQ_API_KEY="your-api-key"
```

**Config file** (`~/.config/kilo/kilo.json` or `./kilo.json`):

```jsonc
{
  "provider": {
    "groq": {
      "env": ["GROQ_API_KEY"],
    },
  },
}
```

Then set your default model:

```jsonc
{
  "model": "groq/llama-3.3-70b-versatile",
}
```

{% /tab %}
{% /tabs %}

## Supported Models

Kilo Code supports the following models through Groq:

| Model ID | Provider | Context Window | Notes |
|---|---|---|---|
| `moonshotai/kimi-k2-instruct` | Moonshot AI | 128K tokens | Optimized max_tokens limit configured |
| `llama-3.3-70b-versatile` | Meta | 128K tokens | High-performance Llama model |
| `llama-3.1-70b-versatile` | Meta | 128K tokens | Versatile reasoning capabilities |
| `llama-3.1-8b-instant` | Meta | 128K tokens | Fast inference for quick tasks |
| `mixtral-8x7b-32768` | Mistral AI | 32K tokens | Mixture of experts architecture |

**Note:** Model availability may change. Refer to the [Groq documentation](https://console.groq.com/docs/models) for the latest model list and specifications.

## Model-Specific Features

### Kimi K2 Model

The `moonshotai/kimi-k2-instruct` model includes optimized configuration:

- **Max Tokens Limit:** Automatically configured with appropriate limits for optimal performance
- **Context Understanding:** Excellent for complex reasoning and long-context tasks
- **Multilingual Support:** Strong performance across multiple languages

## Tips and Notes

- **Ultra-Fast Inference:** Groq's hardware acceleration provides exceptionally fast response times
- **Cost-Effective:** Competitive pricing for high-performance inference
- **Rate Limits:** Be aware of API rate limits based on your Groq plan
- **Model Selection:** Choose models based on your specific use case:
  - **Kimi K2**: Best for complex reasoning and multilingual tasks
  - **Llama 3.3 70B**: Excellent general-purpose performance
  - **Llama 3.1 8B Instant**: Fastest responses for simple tasks
  - **Mixtral**: Good balance of performance and efficiency

## Troubleshooting

- **"Invalid API Key":** Verify your API key is correct and active in the Groq Console
- **"Model Not Available":** Check if the selected model is available in your region
- **Rate Limit Errors:** Monitor your usage in the Groq Console and consider upgrading your plan
- **Connection Issues:** Ensure you have a stable internet connection and Groq services are operational

## Pricing

Groq offers competitive pricing based on input and output tokens. Visit the [Groq pricing page](https://groq.com/pricing/) for current rates and plan options.
