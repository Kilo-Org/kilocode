---
sidebar_label: ZenMux
---

# Using ZenMux With Kilo Code

ZenMux provides a unified API gateway to access multiple AI models from different providers through a single endpoint, with automatic routing, fallbacks, and cost optimization.

**Website:** [https://zenmux.ai](https://zenmux.ai)

## Getting an API Key

1. **Sign Up:** Visit [zenmux.ai](https://zenmux.ai) to create an account.
2. **Navigate to Dashboard:** After signing up, go to your dashboard.
3. **Generate API Key:** Create a new API key for use with Kilo Code.
4. **Copy the Key:** Copy and store your API key securely.

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

The extension stores this in your `kilo.json` config file. You can also edit the config file directly â€” see the **CLI** tab for the file format.

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

## Supported Models

ZenMux supports models from OpenAI, Anthropic, Google, Meta, Mistral, and other providers. Visit [zenmux.ai/models](https://zenmux.ai/models) for the complete list of available models.

## Tips and Notes

- **Pricing:** Check the [ZenMux dashboard](https://zenmux.ai) for current pricing and usage details.
- **Zero Data Retention:** ZenMux offers a ZDR mode for maximum privacy. See the [ZenMux documentation](https://zenmux.ai/docs) for configuration details.
- **Routing Options:** ZenMux can route requests by price, throughput, or latency. Refer to the [ZenMux documentation](https://zenmux.ai/docs) for advanced routing configuration.
