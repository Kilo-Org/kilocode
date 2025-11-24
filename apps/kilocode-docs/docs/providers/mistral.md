---
sidebar_label: Mistral AI
---

# Using Mistral AI With Kilo Code

Kilo Code supports accessing models through the Mistral AI API, including both standard Mistral models and the code-specialized Codestral model.

**Website:** [https://mistral.ai/](https://mistral.ai/)

## Getting an API Key

1.  **Sign Up/Sign In:** Go to the [Mistral Platform](https://console.mistral.ai/). Create an account or sign in. You may need to go through a verification process.
2.  **Create an API Key:**
    - [La Plateforme API Key](https://console.mistral.ai/api-keys/) and/or
    - [Codestral API Key](https://console.mistral.ai/codestral)

## Supported Models

Kilo Code supports the following Mistral models:

| Model ID             | Model Default Temperature | Function Calling | Vision / Image support |
| -------------------- | ------------------------- | ---------------- | ---------------------- |
| codestral-latest     | 0.3                       | ✅               | ❌                     |
| devstral             | 0.3                       | ✅               | ❌                     |
| mistral-large-latest | 0.7                       | ✅               | ❌                     |
| ministral-8b-latest  | 0.3                       | ✅               | ❌                     |
| ministral-3b-latest  | 0.3                       | ✅               | ❌                     |
| mistral-small-latest | 0.3                       | ✅               | ❌                     |
| pixtral-large-latest | 0.7                       | ✅               | ✅                     |

The default model temperature in Kilo Code is 0.0, so you should consider experimenting with [temperature adjustments](/features/model-temperature)!

**Note:** Model availability and specifications may change.
Refer to the [Mistral AI documentation](https://docs.mistral.ai/api/) and [Mistral Model Overview](https://docs.mistral.ai/getting-started/models/models_overview/) for the latest information.

## Configuration in Kilo Code

1.  **Open Kilo Code Settings:** Click the gear icon (<Codicon name="gear" />) in the Kilo Code panel.
2.  **Select Provider:** Choose "Mistral" from the "API Provider" dropdown.
3.  **Enter API Key:** Paste your Mistral API key into the "Mistral API Key" field if you're using a `mistral` model. If you intend to use `codestral-latest`, see the "Codestral" section below.
4.  **Select Model:** Choose your desired model from the "Model" dropdown.

## Using Codestral

[Codestral](https://docs.mistral.ai/capabilities/code_generation/) is a model specifically designed for code generation and interaction.
Only for Codestral you could use different endpoints (Default: codestral.mistral.ai).
For the La Platforme API Key change the **Codestral Base Url** to: https://api.mistral.ai

To use Codestral:

1.  **Select "Mistral" as the API Provider.**
2.  **Select a Codestral Model**
3.  **Enter your Codestral (codestral.mistral.ai) or La Plateforme (api.mistral.ai) API Key.**
