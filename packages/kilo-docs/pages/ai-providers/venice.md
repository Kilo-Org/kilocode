---
sidebar_label: Venice AI
---

# Using Venice AI With Kilo Code

Kilo Code supports Venice AI through the native Venice provider. Venice offers privacy-focused access to open and reasoning-capable models through its API.

**Website:** [https://venice.ai/](https://venice.ai/)

## Getting an API Key

1. Sign in to Venice AI.
2. Open your API settings.
3. Create a key for Kilo Code.
4. Copy the key immediately and store it securely.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode (Legacy)" %}

Use the **OpenAI Compatible** provider if the legacy provider list does not include Venice AI. Enter your Venice API base URL, API key, and model ID from the Venice dashboard.

{% /tab %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab to add Venice AI and enter your API key.

The extension stores this in your `kilo.json` config file. You can also edit the config file directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="CLI" %}

Set the API key as an environment variable or configure it in your `kilo.json` config file:

**Environment variable:**

```bash
export VENICE_API_KEY="your-api-key"
```

**Config file** (`~/.config/kilo/kilo.json` or `./kilo.json`):

```jsonc
{
  "provider": {
    "venice": {
      "env": ["VENICE_API_KEY"]
    }
  }
}
```

Then select a Venice model from the model picker, or set a default model after confirming the model ID in your account:

```jsonc
{
  "model": "venice/<model-id>"
}
```

{% /tab %}
{% /tabs %}

## Tips and Notes

- **Native provider:** Kilo uses the Venice AI SDK provider for built-in Venice models.
- **Reasoning models:** Some Venice models expose reasoning controls. Kilo maps supported reasoning effort and disable-thinking options when the selected model supports them.
- **Model availability:** Venice model IDs and access can vary by plan. Use the model picker or Venice dashboard for the current list.
- **Pricing:** Refer to Venice AI pricing and account limits for current token costs and rate limits.

## Troubleshooting

- **Invalid API key:** Verify `VENICE_API_KEY` is set in the same environment that launches Kilo, or reconnect the provider in Settings.
- **Model not available:** Confirm your Venice account has access to the selected model and try selecting it from the model picker.
