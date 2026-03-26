---
sidebar_label: ZenMux
---

# Using ZenMux With Kilo Code

ZenMux is an AI gateway that provides access to multiple AI models from different providers through a single API endpoint, with automatic routing, fallbacks, and cost optimization.

**Website:** [https://zenmux.ai](https://zenmux.ai)

## Getting an API Key

1.  **Sign Up:** Visit [zenmux.ai](https://zenmux.ai) to create an account.
2.  **Get API Key:** After signing up, navigate to your dashboard to generate an API key.
3.  **Copy the Key:** Copy the API key.

## Configuration in Kilo Code

1.  **Open Kilo Code Settings:** Click the gear icon ({% codicon name="gear" /%}) in the Kilo Code panel.
2.  **Select Provider:** Choose "ZenMux" from the "API Provider" dropdown.
3.  **Enter API Key:** Paste your ZenMux API key into the "ZenMux API Key" field.
4.  **Select Model:** Choose your desired model from the "Model" dropdown.
5.  **(Optional) Custom Base URL:** If you need to use a custom base URL for the ZenMux API, check "Use custom base URL" and enter the URL. Leave this blank for most users.

## Supported Models

ZenMux supports models from OpenAI, Anthropic, Google, Meta, Mistral, and other providers. Visit [zenmux.ai/models](https://zenmux.ai/models) to see the complete list of available models.

## Tips and Notes

- **Pricing:** ZenMux charges based on the underlying model's pricing. Check your ZenMux dashboard for usage and cost details.
- **Routing:** ZenMux can route requests based on price, throughput, or latency preferences.
- **Fallback:** If a provider is unavailable, ZenMux automatically falls back to alternative providers that support the same model.
- **Zero Data Retention:** ZenMux offers a ZDR mode for maximum privacy.
- **Prompt Compression:** ZenMux supports a middle-out transform to optimize prompts that exceed model context limits.
