---
sidebar_label: OpenAI
---

# Using OpenAI With Kilo Code

Kilo Code supports accessing models directly through the official OpenAI API.

**Website:** [https://openai.com/](https://openai.com/)

## Getting an API Key

1.  **Sign Up/Sign In:** Go to the [OpenAI Platform](https://platform.openai.com/). Create an account or sign in.
2.  **Navigate to API Keys:** Go to the [API keys](https://platform.openai.com/api-keys) page.
3.  **Create a Key:** Click "Create new secret key". Give your key a descriptive name (e.g., "Kilo Code").
4.  **Copy the Key:** **Important:** Copy the API key _immediately_. You will not be able to see it again. Store it securely.

## Supported Models

Kilo Code supports a variety of OpenAI models, including:

- `o3-mini` (medium reasoning effort)
- `o3-mini-high` (high reasoning effort)
- `o3-mini-low` (low reasoning effort)
- `o1`
- `o1-preview`
- `o1-mini`
- `gpt-4.5-preview`
- `gpt-4o`
- `gpt-4o-mini`

Refer to the [OpenAI Models documentation](https://platform.openai.com/docs/models) for the most up-to-date list of models and capabilities.

## Configuration in Kilo Code

1.  **Open Kilo Code Settings:** Click the gear icon (<Codicon name="gear" />) in the Kilo Code panel.
2.  **Select Provider:** Choose "OpenAI" from the "API Provider" dropdown.
3.  **Enter API Key:** Paste your OpenAI API key into the "OpenAI API Key" field.
4.  **Select Model:** Choose your desired model from the "Model" dropdown.

## Tips and Notes

- **Pricing:** Refer to the [OpenAI Pricing](https://openai.com/pricing) page for details on model costs.
- **Azure OpenAI Service:** If you'd like to use the Azure OpenAI service, please see our section on [OpenAI-compatible](/providers/openai-compatible) providers.
