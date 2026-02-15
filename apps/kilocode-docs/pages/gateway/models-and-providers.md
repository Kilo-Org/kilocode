---
title: "Models & Providers"
description: "Learn about the AI models and providers available through the Kilo AI Gateway, including model IDs, routing behavior, and provider-specific features."
---

# Models & Providers

The Kilo AI Gateway provides access to hundreds of AI models from multiple providers through a single unified API. You can switch between models by changing the model ID string -- no code changes required.

## Specifying a model

Models are identified using the format `provider/model-name`. Pass this as the `model` parameter in your request:

```typescript
const result = streamText({
	model: kilo("anthropic/claude-sonnet-4.5"),
	prompt: "Hello!",
})
```

Or in a raw API request:

```json
{
	"model": "anthropic/claude-sonnet-4.5",
	"messages": [{ "role": "user", "content": "Hello!" }]
}
```

## Available models

You can browse the full list of available models via the models endpoint:

```
GET https://api.kilo.ai/api/gateway/models
```

This returns model information including pricing, context window, and supported features. No authentication is required.

### Popular models

| Model ID                        | Provider  | Description                                     |
| ------------------------------- | --------- | ----------------------------------------------- |
| `anthropic/claude-opus-4.6`     | Anthropic | Most capable Claude model for complex reasoning |
| `anthropic/claude-sonnet-4.5`   | Anthropic | Balanced performance and cost                   |
| `anthropic/claude-haiku-4.5`    | Anthropic | Fast and cost-effective                         |
| `openai/gpt-5.2`                | OpenAI    | Latest GPT model                                |
| `google/gemini-3-pro-preview`   | Google    | Advanced reasoning with 1M context              |
| `google/gemini-3-flash-preview` | Google    | Fast and efficient                              |
| `x-ai/grok-code-fast-1`         | xAI       | Optimized for code tasks                        |
| `moonshotai/kimi-k2.5`          | Moonshot  | Strong multilingual model                       |

### Free models

Several models are available at no cost, subject to rate limits:

| Model ID                              | Description               |
| ------------------------------------- | ------------------------- |
| `minimax/minimax-m2.1:free`           | MiniMax M2.1              |
| `z-ai/glm-5:free`                     | Z.AI GLM-5                |
| `giga-potato`                         | Community model           |
| `corethink:free`                      | CoreThink reasoning model |
| `arcee-ai/trinity-large-preview:free` | Arcee Trinity             |

Free models are available to both authenticated and anonymous users. Anonymous users are rate-limited to 200 requests per hour per IP address.

## The `kilo/auto` model

The `kilo/auto` virtual model automatically selects the best model based on the task type. The selection is controlled by the `x-kilocode-mode` request header:

| Mode                                                           | Resolved Model                |
| -------------------------------------------------------------- | ----------------------------- |
| `plan`, `general`, `architect`, `orchestrator`, `ask`, `debug` | `anthropic/claude-opus-4.6`   |
| `build`, `explore`, `code`                                     | `anthropic/claude-sonnet-4.5` |
| Default (no mode specified)                                    | `anthropic/claude-sonnet-4.5` |

```json
{
	"model": "kilo/auto",
	"messages": [{ "role": "user", "content": "Help me design a database schema" }]
}
```

With the mode header:

```bash
curl -X POST "https://api.kilo.ai/api/gateway/chat/completions" \
  -H "Authorization: Bearer $KILO_API_KEY" \
  -H "x-kilocode-mode: plan" \
  -H "Content-Type: application/json" \
  -d '{"model": "kilo/auto", "messages": [{"role": "user", "content": "Design a database schema"}]}'
```

## Providers

The gateway routes requests to the appropriate provider based on the model and your configuration:

| Provider          | Slug         | Description                         |
| ----------------- | ------------ | ----------------------------------- |
| OpenRouter        | `openrouter` | Primary gateway for most models     |
| Vercel AI Gateway | `vercel`     | BYOK routing and select A/B testing |
| Mistral           | `mistral`    | FIM completions (Codestral)         |
| xAI               | `x-ai`       | Grok models (direct)                |
| MiniMax           | `minimax`    | MiniMax models (direct)             |
| CoreThink         | `corethink`  | CoreThink reasoning model           |
| Inception         | `inception`  | InceptionLabs models                |
| Martian           | `martian`    | Optimized xAI models                |
| StreamLake        | `streamlake` | KAT-Coder models                    |

## Provider routing

The gateway uses the following priority for routing requests:

1. **BYOK check**: If you have a BYOK key for the model's provider, the request is routed through Vercel AI Gateway using your key
2. **Free model routing**: If the model is a Kilo-hosted free model, it's routed to its designated provider
3. **Default routing**: All other requests go through OpenRouter

### Preferred inference providers

For models available through multiple providers, the gateway may use a preferred provider for better performance:

| Model Family     | Preferred Provider   |
| ---------------- | -------------------- |
| Anthropic models | Amazon Bedrock       |
| MiniMax models   | MiniMax (direct)     |
| Mistral models   | Mistral (direct)     |
| Moonshot models  | Moonshot AI (direct) |

These preferences are sent as hints to OpenRouter, which may override them based on availability and load.

## Listing models

### Models endpoint

```
GET https://api.kilo.ai/api/gateway/models
```

Returns an OpenAI-compatible list of all available models with metadata including pricing, context window, and capabilities.

### Providers endpoint

```
GET https://api.kilo.ai/api/gateway/providers
```

Returns a list of all available inference providers.

### Models by provider

```
GET https://api.kilo.ai/api/gateway/models-by-provider
```

Returns models grouped by their provider, useful for building model selection interfaces.
