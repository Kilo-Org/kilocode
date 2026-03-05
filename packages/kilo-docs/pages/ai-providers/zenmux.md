---
title: ZenMux
sidebar_label: ZenMux
---

# Using ZenMux With Kilo Code

ZenMux is a unified API gateway that provides access to all leading AI models through a single API endpoint with automatic routing, failover, and cost optimization.

**Website:** [https://zenmux.ai/](https://zenmux.ai/)

## Getting an API Key

1. Visit [ZenMux](https://zenmux.ai/) and create an account.
2. Navigate to the API Keys section in your dashboard.
3. Generate a new API key and copy it.

## Supported Models

ZenMux supports models from multiple providers including:

- OpenAI (GPT-4, GPT-4o, etc.)
- Anthropic (Claude 3.5, Claude 3, etc.)
- Google (Gemini Pro, Gemini Ultra, etc.)

Visit the [ZenMux documentation](https://zenmux.ai/docs) for a complete list of supported models.

## Configuration in Kilo Code

1. Open the Kilo Code settings {% codicon name="gear" /%}
2. Select **ZenMux** as your API provider.
3. Enter your ZenMux API key.
4. Select your desired model from the dropdown.

## Tips and Notes

- ZenMux provides automatic provider routing and failover, so your requests are automatically routed to the best available provider.
- ZenMux offers cost optimization by selecting the most cost-effective provider for each request.
- For more information about available features and configuration options, visit the [ZenMux documentation](https://zenmux.ai/docs).
