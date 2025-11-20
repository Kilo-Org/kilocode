---
sidebar_label: Fireworks AI
---

# Using Fireworks AI With Kilo Code

Fireworks AI is a high-performance platform for running AI models that offers fast access to a wide range of open-source and proprietary language models. Built for speed and reliability, Fireworks AI provides both serverless and dedicated deployment options with OpenAI-compatible APIs.

**Website:** [https://fireworks.ai/](https://fireworks.ai/)

---

## Getting an API Key

1. **Sign Up/Sign In:** Go to [Fireworks AI](https://fireworks.ai/) and create an account or sign in.
2. **Navigate to API Keys:** After logging in, go to the [API Keys page](https://app.fireworks.ai/settings/users/api-keys) in the account settings.
3. **Create a Key:** Click "Create API key" and give your key a descriptive name (e.g., "Kilo Code").
4. **Copy the Key:** Copy the API key _immediately_ and store it securely. You will not be able to see it again.

---

## Supported Models

Kilo Code supports the following Fireworks AI models:

- `accounts/fireworks/models/kimi-k2-instruct` - Kimi K2 instruction-tuned model
- `accounts/fireworks/models/qwen3-235b-a22b-instruct-2507` - Qwen 3 235B instruction-tuned model
- `accounts/fireworks/models/qwen3-coder-480b-a35b-instruct` - Qwen 3 Coder 480B for code generation
- `accounts/fireworks/models/deepseek-r1-0528` - DeepSeek R1 reasoning model
- `accounts/fireworks/models/deepseek-v3` - DeepSeek V3 latest generation model

---

## Configuration in Kilo Code

1. **Open Kilo Code Settings:** Click the gear icon (<Codicon name="gear" />) in the Kilo Code panel.
2. **Select Provider:** Choose "Fireworks AI" from the "API Provider" dropdown.
3. **Enter API Key:** Paste your Fireworks AI API key into the "Fireworks AI API Key" field.
4. **Select Model:** Choose your desired model from the "Model" dropdown.

---

## Tips and Notes

- **Performance:** Fireworks AI is optimized for speed and offers excellent performance for both chat and completion tasks.
- **Pricing:** Refer to the [Fireworks AI Pricing](https://fireworks.ai/pricing) page for current pricing information.
- **Rate Limits:** Fireworks AI has usage-based rate limits. Monitor your usage in the dashboard and consider upgrading your plan if needed.
