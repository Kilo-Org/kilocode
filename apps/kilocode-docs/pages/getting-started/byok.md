---
title: "Bring Your Own Key (BYOK)"
description: "Use your own API keys with Kilo Gateway while retaining platform features"
---

# Bring Your Own Key (BYOK)

Bring Your Own Key (BYOK) lets you use your own API keys when using the Kilo Gateway, while retaining Kilo platform features like Code Reviews and Cloud Agents.

A user or organization may want to use BYOK to:

- Utilize new models quickly, Kilo Gateway supports most new models in minutes
- Use subscriptions with third-party AI providers, for example [Z.AI](https://z.ai/subscribe) or [Minimax](https://platform.minimax.io/subscribe/coding-plan)
- Attribute usage against existing provider commitments or agreements
- Use existing credits with a provider

## Supported BYOK providers

Kilo Gateway currently supports BYOK keys for these providers:

- Anthropic
- OpenAI
- Google AI Studio
- Minimax
- Mistral AI
- xAI
- Z.AI

## Add a BYOK key

1. Log into the Kilo platform and select the account or organization you want to add the BYOK key to.
2. Navigate to the [Bring Your Own Key (BYOK) page](https://app.kilo.ai/byok), available in the sidebar under `Account`.
3. Click `Add Your First Key`, select the provider, and paste your API key.
4. Save.

## How Bring Your Own Key works

- When you use the **Kilo Gateway** provider, Kilo checks if there's a BYOK key for the selected model's provider.
- If a matching BYOK key exists, the request is routed using your key.
- If the key is invalid, the request fails. It does not fall back to using Kilo's keys.

## Using BYOK in the Extensions and CLI

- BYOK works with the Kilo Gateway provider. Users should ensure that is set as the active [provider](/docs/ai-providers).
- Select a model from a provider configured for BYOK, for example Claude Sonnet 4.5 if you configured BYOK for Anthropic.
- (Optional) Validate with the provider that traffic is being served by that key.

## Limitations

- BYOK is not fully supported by Agent Manager. See [Agent Manager](/docs/automate/agent-manager) for details.
