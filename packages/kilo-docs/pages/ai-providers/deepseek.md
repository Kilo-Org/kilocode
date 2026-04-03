---
sidebar_label: DeepSeek
---

# Using DeepSeek With Kilo Code

Kilo Code supports accessing models through the DeepSeek API, including `deepseek-chat` and `deepseek-reasoner`.

**Website:** [https://platform.deepseek.com/](https://platform.deepseek.com/)

## Getting an API Key

1.  **Sign Up/Sign In:** Go to the [DeepSeek Platform](https://platform.deepseek.com/). Create an account or sign in.
2.  **Navigate to API Keys:** Find your API keys in the [API keys](https://platform.deepseek.com/api_keys) section of the platform.
3.  **Create a Key:** Click "Create new API key". Give your key a descriptive name (e.g., "Kilo Code").
4.  **Copy the Key:** **Important:** Copy the API key _immediately_. You will not be able to see it again. Store it securely.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode (Legacy)" %}

1.  **Open Kilo Code Settings:** Click the gear icon ({% codicon name="gear" /%}) in the Kilo Code panel.
2.  **Select Provider:** Choose "DeepSeek" from the "API Provider" dropdown.
3.  **Enter API Key:** Paste your DeepSeek API key into the "DeepSeek API Key" field.
4.  **Select Model:** Choose your desired model from the "Model" dropdown.

{% /tab %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab to add DeepSeek and enter your API key.

The extension stores this in your `kilo.json` config file. You can also edit the config file directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="CLI" %}

Set the API key as an environment variable or configure it in your `kilo.json` config file:

**Environment variable:**

```bash
export DEEPSEEK_API_KEY="your-api-key"
```

**Config file** (`~/.config/kilo/kilo.json` or `./kilo.json`):

```jsonc
{
  "provider": {
    "deepseek": {
      "env": ["DEEPSEEK_API_KEY"],
    },
  },
}
```

Then set your default model:

```jsonc
{
  "model": "deepseek/deepseek-chat",
}
```

{% /tab %}
{% /tabs %}

## Tips and Notes

- **Pricing:** Refer to the [DeepSeek Pricing](https://api-docs.deepseek.com/quick_start/pricing/) page for details on model costs.
