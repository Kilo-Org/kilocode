---
sidebar_label: FastRouter
---

# Using FastRouter With Kilo Code

FastRouter is an LLM gateway that provides access to 150+ language models from providers like Anthropic, OpenAI, Google, and more — all through a single OpenAI-compatible API. It adds smart routing, observability, cost tracking, and fallback handling on top of the underlying providers.

**Website:** [https://fastrouter.ai/](https://fastrouter.ai/)

## Getting an API Key

1.  **Sign Up/Sign In:** Go to the [FastRouter website](https://fastrouter.ai/) and create an account.
2.  **Get an API Key:** Navigate to your dashboard and generate a new API key.
3.  **Copy the Key:** Copy the displayed API key.

## Supported Models

Kilo Code automatically fetches the full list of available models from the FastRouter API. FastRouter provides access to models from:

- **Anthropic:** Claude 4, Claude 3.5 Sonnet, Claude Haiku, and more
- **OpenAI:** GPT-4o, GPT-4.1, o3, o4-mini, and more
- **Google:** Gemini 2.5 Pro, Gemini 2.5 Flash, and more
- **Meta, Mistral, DeepSeek, and many other open-source and proprietary models**

Refer to the [FastRouter models page](https://go.fastrouter.ai/api/v1/models) for the full up-to-date list.

## Configuration in Kilo Code

1.  **Open Kilo Code Settings:** Click the gear icon ({% codicon name="gear" /%}) in the Kilo Code panel.
2.  **Select Provider:** Choose "FastRouter" from the "API Provider" dropdown.
3.  **Enter API Key:** Paste your FastRouter API key into the "FastRouter API Key" field.
4.  **Select Model:** Choose your desired model from the "Model" dropdown. Models are grouped by the underlying provider.

Alternatively, set the `FASTROUTER_API_KEY` environment variable before launching Kilo Code and the provider will be configured automatically.

## Smart Routing

FastRouter routes each request to the best available inference backend based on availability, latency, and cost. This means:

- **Automatic failover** — if one backend is down, FastRouter retries on another
- **Lower latency** — requests are routed to the fastest available provider for the chosen model
- **Cost optimization** — routing can be tuned to prefer lower-cost backends

## Tips and Notes

- **Model IDs:** FastRouter uses the format `provider/model-name` (e.g., `anthropic/claude-haiku-4.5`, `openai/gpt-4o`), the same convention as OpenRouter.
- **Pricing:** Pricing follows the underlying model's cost. See the [FastRouter documentation](https://docs.fastrouter.ai) for details.
- **Multimodal support:** Many FastRouter models support image, audio, and video inputs in addition to text. Model capabilities are detected automatically.
- **Streaming:** FastRouter fully supports streaming responses, which Kilo Code uses by default.
