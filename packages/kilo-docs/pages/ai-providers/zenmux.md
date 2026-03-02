---
sidebar_label: ZenMux
---

# Using ZenMux With Kilo Code

ZenMux is a unified API gateway that provides access to multiple AI models from different providers through a single endpoint. It supports OpenAI, Anthropic, Google, and other major AI providers, with automatic routing, fallbacks, and cost optimization.

**Website:** [https://zenmux.ai/](https://zenmux.ai/)

## Getting an API Key

1. **Sign Up/Sign In:** Go to the [ZenMux website](https://zenmux.ai). Create an account or sign in.
2. **Get an API Key:** Navigate to your dashboard to generate an API key.
3. **Copy the Key:** Copy the key immediately and store it securely.

## Configuration in Kilo Code

1. **Open Kilo Code Settings:** Click the gear icon ({% codicon name="gear" /%}) in the Kilo Code panel.
2. **Select Provider:** Choose "ZenMux" from the "API Provider" dropdown.
3. **Enter API Key:** Paste your ZenMux API key into the "ZenMux API Key" field.
4. **Select Model:** Choose your desired model from the "Model" dropdown.
5. **(Optional) Custom Base URL:** If you need to use a custom base URL for the ZenMux API, check "Use custom base URL" and enter the URL. Leave this blank for most users.

## Supported Transforms

ZenMux provides an optional "middle-out" message transform to help with prompts that exceed the maximum context size of a model. You can enable it by checking the "Compress prompts and message chains to the context size" box.

## Tips and Notes

- **Model Selection:** ZenMux supports a wide range of models from OpenAI, Anthropic, Google, Meta, Mistral, and more. Visit [zenmux.ai/models](https://zenmux.ai/models) for the complete list.
- **Pricing:** Pricing varies by the underlying model and provider. Check your ZenMux dashboard for current pricing details.
- **Zero Data Retention:** ZenMux offers a ZDR mode to ensure no request or response data is stored, providing maximum privacy for sensitive applications.
