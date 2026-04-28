---
sidebar_label: ZenMux
---

# Using ZenMux With Kilo Code

ZenMux is a unified AI gateway that provides access to multiple AI models from different providers through a single API endpoint. It supports OpenAI, Anthropic, Google, and other major AI providers, with automatic routing, fallbacks, and cost optimization.

**Website:** [https://zenmux.ai/](https://zenmux.ai/)

## Getting an API Key

1. **Sign Up/Sign In:** Go to the [ZenMux website](https://zenmux.ai) and create an account.
2. **Get an API Key:** Navigate to your dashboard to generate an API key.
3. **Copy the Key:** Copy the API key.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode (Legacy)" %}

1. **Open Kilo Code Settings:** Click the gear icon ({% codicon name="gear" /%}) in the Kilo Code panel.
2. **Select Provider:** Choose "ZenMux" from the "API Provider" dropdown.
3. **Enter API Key:** Paste your ZenMux API key into the "ZenMux API Key" field.
4. **Select Model:** Choose your desired model from the "Model" dropdown.
5. **(Optional) Custom Base URL:** If you need to use a custom base URL for the ZenMux API, check "Use custom base URL" and enter the URL. Leave this blank for most users.

{% /tab %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab to add ZenMux and enter your API key.

The extension stores this in your `kilo.json` config file. You can also edit the config file directly. See the **CLI** tab for the file format.

{% /tab %}
{% tab label="CLI" %}

Set the API key as an environment variable or configure it in your `kilo.json` config file:

**Environment variable:**

```bash
export ZENMUX_API_KEY="your-api-key"
```

**Config file** (`~/.config/kilo/kilo.json` or `./kilo.json`):

```jsonc
{
  "provider": {
    "zenmux": {
      "env": ["ZENMUX_API_KEY"],
    },
  },
}
```

Then set your default model:

```jsonc
{
  "model": "zenmux/openai/gpt-5",
}
```

{% /tab %}
{% /tabs %}

## Provider Routing

ZenMux can route requests to different inference providers based on your preferences.

### Provider Sorting

- Default provider sorting: use the setting in your ZenMux account
- Prefer providers with lower price
- Prefer providers with higher throughput (more tokens per second)
- Prefer providers with lower latency (shorter time to first token)

### Data Policy

- **Allow:** allow data collection for service improvement
- **Deny:** disable all data collection
- **Zero Data Retention (ZDR):** only providers with a strict zero data retention policy are used, ensuring no request or response data is stored

## Tips and Notes

- **Model Selection:** ZenMux supports a wide range of models from OpenAI, Anthropic, Google, and more. Visit [zenmux.ai/models](https://zenmux.ai/models) for the full list.
- **Fallback Support:** If a provider is unavailable, ZenMux automatically falls back to alternative providers that support the same model capabilities.
- **Pricing:** ZenMux charges based on the underlying model's pricing. Check your ZenMux dashboard for cost details.
- **Troubleshooting:** Ensure your API key is copied without extra spaces and that your ZenMux account has available credits. Some models may have regional restrictions. Check the ZenMux dashboard for current availability.
