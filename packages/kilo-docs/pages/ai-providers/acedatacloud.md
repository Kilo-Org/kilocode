---
title: "Using Ace Data Cloud with Kilo Code"
description: "Connect Kilo Code to Ace Data Cloud with your own API key and an OpenAI-compatible chat model."
sidebar_label: Ace Data Cloud
---

# Using Ace Data Cloud with Kilo Code

[Ace Data Cloud](https://platform.acedata.cloud) provides an OpenAI-compatible API. This guide adds models that support Ace Data Cloud's Chat Completions endpoint to a Kilo custom provider.

{% callout type="note" %}
This guide uses Kilo's custom provider configuration. Direct requests use your Ace Data Cloud balance, independently of Kilo Gateway credits.
{% /callout %}

## Before you begin

1. Sign in to the [Ace Data Cloud console](https://platform.acedata.cloud/console/applications) and create an application API token with access to the models you want to use. If you restrict allowed APIs, include the Models API for discovery and the Chat Completions API listed for each selected model.
2. Check your balance. Use the [model catalog](https://platform.acedata.cloud/models) to identify models that list **Chat Completions** and check their current pricing.
3. Keep the token private. Use the provider dialog or an environment variable; do not commit it to your project.

## Configure Kilo Code

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings → Providers** and select **Custom provider**.
2. Enter these values:

- **Provider ID:** `acedatacloud`
- **Display name:** `Ace Data Cloud`
- **Provider API:** **OpenAI Compatible**
- **Base URL:** `https://api.acedata.cloud/v1`
- **API key:** Your Ace Data Cloud API token

3. Use **Fetch models** next to the model list to refresh the models available with your credentials. Select each compatible model you want to use, then click **Submit**. If discovery is unavailable, enter the exact model ID from the catalog.
4. Choose one of the saved models in the Kilo model picker. You can reopen **Settings → Providers** to add more models later.

Follow the [automatic model detection guide](/docs/ai-providers/openai-compatible#automatic-model-detection) for discovery troubleshooting. To set context limits and tool calling for a specific model, use a global configuration entry like the one in the **CLI** tab and verify those settings for that model.

{% /tab %}
{% tab label="CLI" %}

Set your API token in the environment:

```bash
export ACEDATACLOUD_API_KEY="your-api-token"
```

Merge this configuration into your global `~/.config/kilo/kilo.json`. The `{env:ACEDATACLOUD_API_KEY}` reference requires global configuration; do not put this example in a project-level `kilo.json`.

Define the models you want to use under `models`, using the exact ID of each Chat Completions model. The example defines `gpt-4.1-mini`.

```json
{
  "$schema": "https://app.kilo.ai/config.json",
  "provider": {
    "acedatacloud": {
      "name": "Ace Data Cloud",
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "https://api.acedata.cloud/v1",
        "apiKey": "{env:ACEDATACLOUD_API_KEY}"
      },
      "models": {
        "gpt-4.1-mini": {
          "name": "GPT-4.1 Mini",
          "tool_call": true,
          "modalities": { "input": ["text"], "output": ["text"] },
          "limit": { "context": 32768, "output": 4096 }
        }
      }
    }
  }
}
```

The example sets conservative client budgets for `gpt-4.1-mini`. For additional models, check the model's context and output limits, modalities, and tool support before setting those fields. Check [Ace Data Cloud pricing](https://platform.acedata.cloud/models) for current rates.

The CLI requires an explicit model definition for a custom provider. Setting the base URL alone does not populate the CLI model picker.

Verify the configuration:

```bash
kilo models acedatacloud
kilo run -m acedatacloud/gpt-4.1-mini "Reply with KILO_ACE_OK"
```

{% /tab %}
{% /tabs %}

## API compatibility

Use **OpenAI Compatible** (`@ai-sdk/openai-compatible`) for this configuration. It sends requests to `https://api.acedata.cloud/v1/chat/completions`. The example enables text, streaming, and tool calls. It does not declare vision or reasoning support.

Models served only through Responses or Messages need configuration for that protocol and its authentication. Check the [model catalog](https://platform.acedata.cloud/models) and the [Chat Completions API guide](https://platform.acedata.cloud/documents/openai-chat-completions) for the model you select.

## Troubleshooting

- **Authentication fails:** Check that the API token is valid and has access to the selected model’s Chat Completions API. A platform management token is not an inference API token.
- **Model not found:** Use the exact model ID, and keep the explicit `models` entry for CLI configuration. Check the current Ace Data Cloud catalog and your account access.
- **Model discovery fails:** Check the token and base URL, then use **Fetch models** again or add an exact compatible model ID manually.
- **Balance or access error:** Check your account balance and service access in the Ace Data Cloud console.

{% callout type="note" %}
This documentation was contributed by an Ace Data Cloud affiliate.
{% /callout %}
