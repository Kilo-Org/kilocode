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
| `anthropic/claude-opus-4.6`     | Anthropic | Most capable Claude model for complex reasoning |
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

### `kilo-auto/frontier`

Highest performance and capability for any task.

| Mode                                                           | Resolved Model                |
| -------------------------------------------------------------- | ----------------------------- |
| `plan`, `general`, `architect`, `orchestrator`, `ask`, `debug` | `anthropic/claude-opus-4.6`   |
| `build`, `explore`, `code`                                     | `anthropic/claude-sonnet-4.6` |
| Default (no mode specified)                                    | `anthropic/claude-sonnet-4.6` |

### `kilo-auto/balanced`

Great balance of price and capability.

| Mode                                                           | Resolved Model         |
| -------------------------------------------------------------- | ---------------------- |
| `plan`, `general`, `architect`, `orchestrator`, `ask`, `debug` | `openai/gpt-5.3-codex` |
| `build`, `explore`, `code`                                     | `openai/gpt-5.3-codex` |
| Default (no mode specified)                                    | `openai/gpt-5.3-codex` |

### `kilo-auto/free`

Free with limited capability. No credits required.

| Mode      | Resolved Model         |
| --------- | ---------------------- |
| All modes | `minimax/minimax-m2.5` |

### `kilo-auto/small`

Automatically routes to a small, fast model.

| Mode          | Resolved Model       |
| ------------- | -------------------- |
| Default       | `openai/gpt-5-nano`  |
| Free fallback | `openai/gpt-oss-20b` |

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
