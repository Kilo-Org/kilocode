---
sidebar_label: Glama
---

# Using Glama With Kilo Code

Glama provides access to a variety of language models through a unified API, including models from Anthropic, OpenAI, and others. It offers features like prompt caching and cost tracking.

**Website:** [https://glama.ai/](https://glama.ai/)

## Getting an API Key

1.  **Sign Up/Sign In:** Go to the [Glama sign-up page](https://glama.ai/sign-up). Sign up using your Google account or name/email/password.
2.  **Get API Key:** After signing up, navigate to the [API Keys](https://glama.ai/settings/gateway/api-keys) page to get an API key.
3.  **Copy the Key:** Copy the displayed API key.

## Supported Models

Kilo Code will automatically try to fetch a list of available models from the Glama API. Some models that are commonly available through Glama include:

- **Anthropic Claude models:** (e.g., `anthropic/claude-3-5-sonnet`) These are generally recommended for best performance with Kilo Code.
- **OpenAI models:** (e.g., `openai/o3-mini-high`)
- **Other providers and open-source models**

Refer to the [Glama documentation](https://glama.ai/models) for the most up-to-date list of supported models.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode (Legacy)" %}

1.  **Open Kilo Code Settings:** Click the gear icon ({% codicon name="gear" /%}) in the Kilo Code panel.
2.  **Select Provider:** Choose "Glama" from the "API Provider" dropdown.
3.  **Enter API Key:** Paste your Glama API key into the "Glama API Key" field.
4.  **Select Model:** Choose your desired model from the "Model" dropdown.

{% /tab %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab to add Glama and enter your API key.

The extension stores this in your `kilo.json` config file. You can also edit the config file directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="CLI" %}

{% callout type="warning" %}
Glama is not yet available as a CLI provider. Check the [Kilo Code releases](https://github.com/Kilo-Org/kilocode/releases) for updates on provider support.
{% /callout %}

{% /tab %}
{% /tabs %}

## Tips and Notes

- **Pricing:** Glama operates on a pay-per-use basis. Pricing varies depending on the model you choose.
- **Prompt Caching:** Glama supports prompt caching, which can significantly reduce costs and improve performance for repeated prompts.
