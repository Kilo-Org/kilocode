---
title: "API Reference"
description: "Complete API reference for the Kilo AI Gateway, including chat completions, FIM completions, and model listing endpoints."
---

# API Reference

The Kilo AI Gateway provides an OpenAI-compatible API. All endpoints use the base URL:

```
https://api.kilo.ai/api/gateway
```

## Chat completions

Create a chat completion. This is the primary endpoint for interacting with AI models.

```
POST /chat/completions
```

### Request body

```typescript
type ChatCompletionRequest = {
	// Required
	model: string // Model ID (e.g., "anthropic/claude-sonnet-4.5")
	messages: Message[] // Array of conversation messages

	// Streaming
	stream?: boolean // Enable SSE streaming (default: false)

	// Generation parameters
	max_tokens?: number // Maximum tokens to generate
	temperature?: number // Sampling temperature (0-2)
	top_p?: number // Nucleus sampling (0-1)
	stop?: string | string[] // Stop sequences
	frequency_penalty?: number // Frequency penalty (-2 to 2)
	presence_penalty?: number // Presence penalty (-2 to 2)

	// Tool calling
	tools?: Tool[] // Available tools/functions
	tool_choice?: ToolChoice // Tool selection strategy

	// Structured output
	response_format?: ResponseFormat

	// Other
	user?: string // End-user identifier for safety
	seed?: number // Deterministic sampling seed
}
```

### Message types

```typescript
type Message =
	| { role: "system"; content: string }
	| { role: "user"; content: string | ContentPart[] }
	| { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
	| { role: "tool"; content: string; tool_call_id: string }

type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail?: string } }

type Tool = {
	type: "function"
	function: {
		name: string
		description?: string
		parameters: object // JSON Schema
	}
}

type ToolChoice = "none" | "auto" | "required" | { type: "function"; function: { name: string } }
```

### Response (non-streaming)

```typescript
type ChatCompletionResponse = {
	id: string
	object: "chat.completion"
	created: number
	model: string
	choices: Array<{
		index: number
		message: {
			role: "assistant"
			content: string | null
			tool_calls?: ToolCall[]
		}
		finish_reason: "stop" | "length" | "tool_calls" | "content_filter"
	}>
	usage: {
		prompt_tokens: number
		completion_tokens: number
		total_tokens: number
	}
}
```

### Response (streaming)

When `stream: true`, the response is a series of SSE events:

```typescript
type ChatCompletionChunk = {
	id: string
	object: "chat.completion.chunk"
	created: number
	model: string
	choices: Array<{
		index: number
		delta: {
			role?: "assistant"
			content?: string
			tool_calls?: ToolCall[]
		}
		finish_reason: string | null
	}>
	// Only in the final chunk
	usage?: {
		prompt_tokens: number
		completion_tokens: number
		total_tokens: number
	}
}
```

### Example request

```bash
curl -X POST "https://api.kilo.ai/api/gateway/chat/completions" \
  -H "Authorization: Bearer $KILO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "anthropic/claude-sonnet-4.5",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "What is quantum computing?"}
    ],
    "max_tokens": 500,
    "temperature": 0.7
  }'
```

### Example response

```json
{
	"id": "gen-abc123",
	"object": "chat.completion",
	"created": 1739000000,
	"model": "anthropic/claude-sonnet-4.5",
	"choices": [
		{
			"index": 0,
			"message": {
				"role": "assistant",
				"content": "Quantum computing is a type of computation that uses quantum mechanics..."
			},
			"finish_reason": "stop"
		}
	],
	"usage": {
		"prompt_tokens": 25,
		"completion_tokens": 150,
		"total_tokens": 175
	}
}
```

## Tool calling

The gateway supports function/tool calling with automatic repair for common issues like duplicate tool calls and orphan cleanup.

### Request with tools

```json
{
	"model": "anthropic/claude-sonnet-4.5",
	"messages": [{ "role": "user", "content": "What's the weather in San Francisco?" }],
	"tools": [
		{
			"type": "function",
			"function": {
				"name": "get_weather",
				"description": "Get the current weather for a location",
				"parameters": {
					"type": "object",
					"properties": {
						"location": {
							"type": "string",
							"description": "City name"
						}
					},
					"required": ["location"]
				}
			}
		}
	],
	"tool_choice": "auto"
}
```

### Tool call response

```json
{
	"choices": [
		{
			"message": {
				"role": "assistant",
				"content": null,
				"tool_calls": [
					{
						"id": "call_abc123",
						"type": "function",
						"function": {
							"name": "get_weather",
							"arguments": "{\"location\":\"San Francisco\"}"
						}
					}
				]
			},
			"finish_reason": "tool_calls"
		}
	]
}
```

### Tool call repair

The gateway automatically handles common tool calling issues:

- **Deduplication**: Removes duplicate tool calls with the same ID
- **Orphan cleanup**: Removes tool result messages without matching tool calls
- **Missing results**: Inserts placeholder results for tool calls without responses
- **ID normalization**: Normalizes tool call IDs per provider requirements (Anthropic, Mistral)

## FIM completions

Fill-in-the-middle completions for code generation, powered by Mistral Codestral.

```
POST /api/fim/completions
```

### Request body

```typescript
type FIMRequest = {
	model: string // Must be a Mistral model (e.g., "mistralai/codestral-2508")
	prompt: string // Code before the cursor
	suffix?: string // Code after the cursor
	max_tokens?: number // Maximum tokens (capped at 1000)
	temperature?: number
	stop?: string[]
	stream?: boolean
}
```

### Example request

```bash
curl -X POST "https://api.kilo.ai/api/fim/completions" \
  -H "Authorization: Bearer $KILO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mistralai/codestral-2508",
    "prompt": "def fibonacci(n):\n    if n <= 1:\n        return n\n    ",
    "suffix": "\n\nprint(fibonacci(10))",
    "max_tokens": 200,
    "stream": false
  }'
```

{% callout type="info" %}
FIM completions are limited to Mistral models (model IDs starting with `mistralai/`). BYOK is supported with the `codestral` key type.
{% /callout %}

## List models

Retrieve the list of available models.

```
GET /models
```

No authentication required.

### Response

Returns an OpenAI-compatible model list:

```json
{
	"data": [
		{
			"id": "anthropic/claude-sonnet-4.5",
			"object": "model",
			"created": 1739000000,
			"owned_by": "anthropic",
			"name": "Claude Sonnet 4.5",
			"context_length": 200000,
			"pricing": {
				"prompt": "0.000003",
				"completion": "0.000015"
			}
		}
	]
}
```

## List providers

Retrieve the list of available providers.

```
GET /providers
```

No authentication required.

## Error codes

| HTTP Status | Description                                             |
| ----------- | ------------------------------------------------------- |
| 400         | Bad request -- invalid parameters or model ID           |
| 401         | Unauthorized -- invalid or missing API key              |
| 402         | Insufficient balance -- add credits to continue         |
| 403         | Forbidden -- model not allowed by organization policy   |
| 429         | Rate limited -- too many requests                       |
| 500         | Internal server error                                   |
| 502         | Provider error -- upstream provider returned an error   |
| 503         | Service unavailable -- provider temporarily unavailable |

### Error response format

```json
{
	"error": {
		"message": "Human-readable error description",
		"code": 400
	}
}
```

{% callout type="info" %}
When the gateway receives a 402 (Payment Required) from an upstream provider, it returns 503 to the client to avoid exposing internal billing details.
{% /callout %}

### Context length errors

If your request exceeds the model's context window, you'll receive a descriptive error:

```json
{
	"error": {
		"message": "This request exceeds the model's context window of 200000 tokens. Your request contains approximately 250000 tokens.",
		"code": 400
	}
}
```
