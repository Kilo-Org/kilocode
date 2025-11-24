---
description: Configure the Vercel AI Gateway in Kilo Code to robustly access 100+ language models from various providers through a centralized interface.
keywords:
    - kilo code
    - vercel ai gateway
    - ai provider
    - language models
    - api configuration
    - model selection
    - prompt caching
    - usage tracking
    - byok
sidebar_label: Vercel AI Gateway
---

# Using Vercel AI Gateway With Kilo Code

The AI Gateway provides a unified API to access hundreds of models through a single endpoint. It gives you the ability to set budgets, monitor usage, load-balance requests, and manage fallbacks.

Useful links:

- Team dashboard: https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai
- Models catalog: https://vercel.com/ai-gateway/models
- Docs: https://vercel.com/docs/ai-gateway

---

## Getting an API Key

An API key is required for authentication.

1.  **Sign Up/Sign In:** Go to the [Vercel Website](https://vercel.com/) and sign in.
2.  **Get an API Key:** Go to the [API Key page](https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys&title=AI+Gateway+API+Key) in the AI Gateway tab. Create a new key.
3.  **Copy the Key:** Copy the API key.

---

## Supported Models

The Vercel AI Gateway supports a large and growing number of models. Kilo Code automatically fetches the list of available models from the `https://ai-gateway.vercel.sh/v1/models` endpoint. Only language models are shown.

The default model is `anthropic/claude-sonnet-4` if no model is selected.

Refer to the [Vercel AI Gateway Models page](https://vercel.com/ai-gateway/models) for the complete and up-to-date list.

### Model Capabilities

- **Vision Support**: Many models support image inputs.
- **Tool/Computer Use**: Select models support function calling and computer use.

Check the model description in the dropdown for specific capabilities.

---

## Configuration in Kilo Code

1.  **Open Kilo Code Settings:** Click the gear icon (<Codicon name="gear" />) in the Kilo Code panel.
2.  **Select Provider:** Choose "Vercel AI Gateway" from the "API Provider" dropdown.
3.  **Enter API Key:** Paste your Vercel AI Gateway API key into the "Vercel AI Gateway API Key" field.
4.  **Select Model:** Choose your desired model from the "Model" dropdown.

---

## Prompt Caching

Vercel AI Gateway supports automatic prompt caching for select models including Anthropic Claude and OpenAI GPT models. This reduces costs by caching frequently used prompts.

---

## Tips and Notes

- **Model Selection:** The Vercel AI Gateway offers a wide range of models. Experiment to find the best one for your needs.
- **Pricing:** The Vercel AI Gateway charges based on the underlying model's pricing, including costs for cached prompts. See the [Vercel AI Gateway Models page](https://vercel.com/ai-gateway/models) for details.
- **Temperature:** The default temperature is `0.7` and is configurable per model.
- **Bring Your Own Key (BYOK):** The Vercel AI Gateway has **no markup** if you decide to use your own key for the underlying service.
- **More info:** Vercel does not add rate limits. Upstream providers may. New accounts receive $5 credits every 30 days until the first payment.
