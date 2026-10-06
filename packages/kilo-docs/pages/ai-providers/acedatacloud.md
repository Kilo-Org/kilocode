---
title: "Using Ace Data Cloud with Kilo Code"
description: "Connect Kilo Code to Ace Data Cloud with your own API key and an OpenAI-compatible chat model."
sidebar_label: Ace Data Cloud
---

# Using Ace Data Cloud with Kilo Code

[Ace Data Cloud](https://platform.acedata.cloud) provides an OpenAI-compatible API. This guide uses its Chat Completions endpoint with `gpt-4.1-mini`.

{% callout type="note" %}
This guide uses Kilo's custom provider configuration. Ace Data Cloud is not currently in Kilo's built-in provider catalog. Direct requests use your Ace Data Cloud balance, independently of Kilo Gateway credits.
{% /callout %}

## Before you begin

1. Sign in to the [Ace Data Cloud console](https://platform.acedata.cloud/console/applications) and create an API token that can call the OpenAI service.
2. Check your balance and the current [model availability and pricing](https://platform.acedata.cloud/models).
3. Keep the token private. Use the provider dialog or an environment variable; do not commit it to your project.

## Configure Kilo Code

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings → Providers** and select **Custom provider**.
2. Enter these values:

- **Provider ID:** `acedatacloud`
- **Display name:** `Ace Data Cloud`
- **Provider API:** **OpenAI Compatible**
- **Base URL:** `https://api.acedata.cloud/openai`
- **API key:** Your Ace Data Cloud API token
- **Model ID:** `gpt-4.1-mini`

3. Select `gpt-4.1-mini` from the fetched models or add it manually, then click **Submit**.
4. Select the model in the model picker. To set explicit context limits and cost estimates, use the model definition in the **CLI** tab in your `kilo.json` or `kilo.jsonc` file.

Model discovery returns IDs; it does not establish tool support, context limits, or pricing for every returned model. Add only models whose capabilities you have checked.

{% /tab %}
{% tab label="CLI" %}

Set your API token in the environment:

```bash
export ACEDATACLOUD_API_KEY="your-api-token"
```

Add this configuration to `~/.config/kilo/kilo.json`, or merge it into your project's `kilo.json`:

```json
{
  "$schema": "https://app.kilo.ai/config.json",
  "provider": {
    "acedatacloud": {
      "name": "Ace Data Cloud",
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "https://api.acedata.cloud/openai",
        "apiKey": "{env:ACEDATACLOUD_API_KEY}"
      },
      "models": {
        "gpt-4.1-mini": {
          "name": "GPT-4.1 Mini",
          "tool_call": true,
          "modalities": { "input": ["text"], "output": ["text"] },
          "limit": { "context": 32768, "output": 4096 },
          "cost": { "input": 0.147173075, "output": 0.58869265 }
        }
      }
    }
  },
  "model": "acedatacloud/gpt-4.1-mini"
}
```

The limits above are conservative client budgets, not the model's advertised maximums. The cost estimates are USD per million tokens at the entry package rate on October 6, 2026: $7 for 40 Credits. Package rates and account discounts affect your actual cost; check current pricing before copying these estimates.

The CLI requires an explicit model definition for a custom provider. Setting the base URL alone does not populate the CLI model picker.

Verify the configuration:

```bash
kilo models acedatacloud
kilo run -m acedatacloud/gpt-4.1-mini "Reply with KILO_ACE_OK"
```

{% /tab %}
{% /tabs %}

## API compatibility

Use **OpenAI Compatible** (`@ai-sdk/openai-compatible`) for this configuration. It sends requests to `https://api.acedata.cloud/openai/chat/completions`. The example enables text, streaming, and tool calls. It does not declare vision or reasoning support.

Other API protocols and models have different requirements. Do not change the protocol selection or add a model solely because it appears in the model list. See the [Chat Completions documentation](https://platform.acedata.cloud/documents/openai-chat-completions).

## Troubleshooting

- **Authentication fails:** Check that the API token is valid and has access to the OpenAI service. A platform management token is not an inference API token.
- **Model not found:** Use the exact model ID, and keep the explicit `models` entry for CLI configuration. Check the current Ace Data Cloud catalog and your account access.
- **Model discovery fails:** Add `gpt-4.1-mini` manually. Keep the base URL set to `https://api.acedata.cloud/openai`.
- **Balance or access error:** Check your account balance and service access in the Ace Data Cloud console.

{% callout type="note" %}
This documentation was contributed by an Ace Data Cloud affiliate.
{% /callout %}
