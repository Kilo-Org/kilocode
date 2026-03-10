---
sidebar_label: ZenMux
---

# Using ZenMux With Kilo Code

ZenMux is an AI gateway that provides a unified API to access multiple AI models from different providers through a single endpoint, with automatic routing, fallbacks, and cost optimization.

**Website:** [https://zenmux.ai/](https://zenmux.ai/)

## Getting an API Key

1.  **Sign Up:** Visit [zenmux.ai](https://zenmux.ai) to create an account.
2.  **Get an API Key:** Navigate to your dashboard to generate an API key.
3.  **Copy the Key:** Copy the API key.

## Configuration in Kilo Code

1.  **Open Kilo Code Settings:** Click the gear icon ({% codicon name="gear" /%}) in the Kilo Code panel.
2.  **Select Provider:** Choose "ZenMux" from the "API Provider" dropdown.
3.  **Enter API Key:** Paste your ZenMux API key into the "ZenMux API Key" field.
4.  **Select Model:** Choose your desired model from the "Model" dropdown.
5.  **(Optional) Custom Base URL:** If you need to use a custom base URL for the ZenMux API, check "Use custom base URL" and enter the URL. Leave this blank for most users.

## Supported Models

ZenMux supports models from OpenAI, Anthropic, Google, Meta, Mistral, and other providers. Visit [zenmux.ai/models](https://zenmux.ai/models) for the complete list of available models.

## Provider Routing

ZenMux can route requests based on different criteria:

- **Price:** Route to the lowest cost provider.
- **Throughput:** Route to the provider with the highest tokens/second.
- **Latency:** Route to the provider with the fastest response time.

## Data Collection Settings

Control how ZenMux handles your data:

- **Allow:** Allow data collection for service improvement.
- **Deny:** Disable all data collection (Zero Data Retention).

## Supported Transforms

ZenMux provides a middle-out transform feature to optimize prompts that exceed model context limits. You can enable it by checking the "Compress prompts and message chains to the context size" box.

## Tips and Notes

- **Fallback Support:** If a provider is unavailable, ZenMux automatically falls back to alternative providers that support the same model.
- **API Key Issues:** Ensure your API key is correctly copied without extra spaces and that your account has available credits.
- **Model Availability:** Some models may have regional restrictions. Check the ZenMux dashboard for current availability.
- **Support:** Visit the [ZenMux documentation](https://zenmux.ai/docs) for additional help.
