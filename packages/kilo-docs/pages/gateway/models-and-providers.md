---
title: "Models & Providers"
description: "Learn about the AI models available through the Kilo AI Gateway, including model IDs and how to use them."
---

# Models & Providers

The Kilo AI Gateway provides access to hundreds of AI models through a single unified API. You can switch between models by changing the model ID string -- no code changes required.

## Specifying a model

Models are identified using the format `provider/model-name`. Pass this as the `model` parameter in your request:

```typescript
const result = streamText({
  model: kilo.chat("anthropic/claude-sonnet-4.6"),
  prompt: "Hello!",
})
```

Or in a raw API request:

```json
{
  "model": "anthropic/claude-sonnet-4.6",
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
| `anthropic/claude-opus-4.7`     | Anthropic | Most capable Claude model for complex reasoning |
| `anthropic/claude-sonnet-4.6`   | Anthropic | Balanced performance and cost                   |
| `anthropic/claude-haiku-4.5`    | Anthropic | Fast and cost-effective                         |
| `openai/gpt-5.4`                | OpenAI    | Latest GPT model                                |
| `openai/gpt-5.4-mini`           | OpenAI    | Fast and efficient                              |
| `google/gemini-3.1-pro-preview` | Google    | Advanced reasoning                              |
| `google/gemini-2.5-flash`       | Google    | Fast and efficient                              |
| `x-ai/grok-4`                   | xAI       | Most capable Grok model                         |
| `x-ai/grok-code-fast-1`         | xAI       | Optimized for code tasks                        |
| `deepseek/deepseek-v3.2`        | DeepSeek  | Strong coding and reasoning model               |
| `moonshotai/kimi-k2.5`          | Moonshot  | Strong coding and multilingual model            |
| `minimax/minimax-m2.7`          | MiniMax   | High-performance MoE model                      |

### Free models

Several models are available at no cost, subject to rate limits:

| Model ID                                 | Description                    |
| ---------------------------------------- | ------------------------------ |
| `bytedance-seed/dola-seed-2.0-pro:free`  | ByteDance Dola Seed 2.0 Pro    |
| `x-ai/grok-code-fast-1:optimized:free`   | xAI Grok Code Fast 1 Optimized |
| `nvidia/nemotron-3-super-120b-a12b:free` | NVIDIA Nemotron 3 Super 120B   |
| `arcee-ai/trinity-large-thinking:free`   | Arcee Trinity Large            |
| `openrouter/free`                        | Best available free model      |

Free models are available to both authenticated and anonymous users. Anonymous users are rate-limited to 200 requests per hour per IP address.

{% callout type="warning" title="Nemotron 3 Super Free (NVIDIA free endpoints)" %}
Provided under the [NVIDIA API Trial Terms of Service](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf). Trial use only — not for production or sensitive data. Prompts and outputs are logged by NVIDIA to improve its models and services. Do not submit personal or confidential data.
{% /callout %}

## Auto models

Kilo Auto virtual models automatically select the best underlying model based on the task type. The selection is controlled by the `x-kilocode-mode` request header.

{% callout type="info" title="Underlying models can change" %}
The mappings below reflect the current routing. The underlying models behind each `kilo-auto/*` tier are updated server-side as better options become available or as providers change pricing and availability — the tier IDs themselves remain stable.
{% /callout %}

### `kilo-auto/frontier`

Highest performance and capability for any task. Frontier requests are sent with medium reasoning effort and medium verbosity.

| Mode                                                           | Resolved Model                |
| -------------------------------------------------------------- | ----------------------------- |
| `plan`, `general`, `architect`, `orchestrator`, `ask`, `debug` | `anthropic/claude-opus-4.7`   |
| `build`, `explore`, `code`                                     | `anthropic/claude-sonnet-4.6` |
| Default (no / unknown mode)                                    | `anthropic/claude-sonnet-4.6` |

### `kilo-auto/balanced`

Great balance of price and capability. The resolved model depends on the API interface used by the client.

| API interface         | Resolved Model               | Reasoning effort |
| --------------------- | ---------------------------- | ---------------- |
| Completions (default) | `qwen/qwen3.6-plus`          | enabled          |
| Responses API         | `openai/gpt-5.3-codex`       | low              |
| Messages API          | `anthropic/claude-haiku-4.5` | medium           |

### `kilo-auto/free`

Free with limited capability. No credits required. The resolved model is selected dynamically per session from a curated set of available free models; the mapping updates server-side as free model availability shifts.

### `kilo-auto/small`

Automatically routes to a small, fast model for lightweight background tasks (session titles, commit messages, summaries).

| Condition                 | Resolved Model                   |
| ------------------------- | -------------------------------- |
| Account has paid balance  | `google/gemma-4-31b-it`          |
| No balance / free account | `google/gemma-4-26b-a4b-it:free` |

### Example usage

```json
{
  "model": "kilo-auto/frontier",
  "messages": [{ "role": "user", "content": "Help me design a database schema" }]
}
```

With the mode header:

```bash
curl -X POST "https://api.kilo.ai/api/gateway/chat/completions" \
  -H "Authorization: Bearer $KILO_API_KEY" \
  -H "x-kilocode-mode: plan" \
  -H "Content-Type: application/json" \
  -d '{"model": "kilo-auto/balanced", "messages": [{"role": "user", "content": "Design a database schema"}]}'
```
