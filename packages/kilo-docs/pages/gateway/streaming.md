---
title: "Streaming"
description: "Learn how to implement real-time streaming responses with the Kilo AI Gateway using Server-Sent Events (SSE)."
---

# Streaming

The Kilo AI Gateway supports streaming responses from all models using Server-Sent Events (SSE). Streaming allows your application to display tokens as they're generated, providing a more responsive user experience.

## Enabling streaming

Set `stream: true` in your request body to enable streaming:

```json
{
	"model": "anthropic/claude-sonnet-4.5",
	"messages": [{ "role": "user", "content": "Write a short story" }],
	"stream": true
}
```

{% callout type="info" %}
The gateway automatically injects `stream_options.include_usage = true` on all streaming requests, so you always receive token usage information in the final chunk.
{% /callout %}

## Streaming with the Vercel AI SDK

The Vercel AI SDK handles SSE parsing and provides a clean streaming interface:

```typescript
import { streamText } from "ai"
import { createOpenAI } from "@ai-sdk/openai"

const kilo = createOpenAI({
	baseURL: "https://api.kilo.ai/api/gateway",
	apiKey: process.env.KILO_API_KEY,
})

const result = streamText({
	model: kilo("anthropic/claude-sonnet-4.5"),
	prompt: "Write a short story about a robot.",
})

for await (const textPart of result.textStream) {
	process.stdout.write(textPart)
}

// Access usage data after streaming completes
const usage = await result.usage
console.log("Tokens used:", usage)
```

## Streaming with the OpenAI SDK

{% tabs %}
{% tab label="TypeScript" %}

```typescript
import OpenAI from "openai"

const client = new OpenAI({
	apiKey: process.env.KILO_API_KEY,
	baseURL: "https://api.kilo.ai/api/gateway",
})

const stream = await client.chat.completions.create({
	model: "anthropic/claude-sonnet-4.5",
	messages: [{ role: "user", content: "Write a short story" }],
	stream: true,
})

for await (const chunk of stream) {
	const content = chunk.choices[0]?.delta?.content
	if (content) {
		process.stdout.write(content)
	}
}
```

{% /tab %}
{% tab label="Python" %}

```python
from openai import OpenAI

client = OpenAI(
    api_key=os.getenv("KILO_API_KEY"),
    base_url="https://api.kilo.ai/api/gateway",
)

stream = client.chat.completions.create(
    model="anthropic/claude-sonnet-4.5",
    messages=[{"role": "user", "content": "Write a short story"}],
    stream=True,
)

for chunk in stream:
    content = chunk.choices[0].delta.content
    if content:
        print(content, end="", flush=True)
```

{% /tab %}
{% /tabs %}

## Raw SSE format

When streaming, the gateway returns data in SSE format. Each event is a JSON object prefixed with `data: `:

```
data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1234567890,"model":"anthropic/claude-sonnet-4.5","choices":[{"index":0,"delta":{"role":"assistant","content":"Once"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1234567890,"model":"anthropic/claude-sonnet-4.5","choices":[{"index":0,"delta":{"content":" upon"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1234567890,"model":"anthropic/claude-sonnet-4.5","choices":[{"index":0,"delta":{"content":" a"},"finish_reason":null}]}

data: [DONE]
```

### Usage in the final chunk

Token usage data is included in the final chunk before `[DONE]`, with an empty `choices` array:

```json
{
	"id": "chatcmpl-abc123",
	"object": "chat.completion.chunk",
	"usage": {
		"prompt_tokens": 12,
		"completion_tokens": 150,
		"total_tokens": 162
	},
	"choices": []
}
```

## Stream cancellation

You can cancel a streaming request by aborting the connection. This stops token generation and billing for ungenerated tokens:

```typescript
const controller = new AbortController()

const response = await fetch("https://api.kilo.ai/api/gateway/chat/completions", {
	method: "POST",
	headers: {
		Authorization: `Bearer ${process.env.KILO_API_KEY}`,
		"Content-Type": "application/json",
	},
	body: JSON.stringify({
		model: "anthropic/claude-sonnet-4.5",
		messages: [{ role: "user", content: "Write a long essay" }],
		stream: true,
	}),
	signal: controller.signal,
})

// Cancel after 5 seconds
setTimeout(() => controller.abort(), 5000)
```

{% callout type="warning" %}
Stream cancellation behavior depends on the upstream provider. Some providers stop processing immediately, while others may continue processing after disconnection. The gateway handles partial usage tracking for cancelled streams.
{% /callout %}

## Error handling during streaming

### Errors before streaming starts

If an error occurs before any tokens are sent, the gateway returns a standard JSON error response with the appropriate HTTP status code:

```json
{
	"error": {
		"message": "Insufficient balance",
		"code": 402
	}
}
```

### Errors during streaming

If an error occurs after tokens have already been sent, the HTTP status (200) cannot be changed. The error appears as an SSE event:

```
data: {"error":{"message":"Provider disconnected","code":502},"choices":[{"index":0,"delta":{"content":""},"finish_reason":"error"}]}
```

Check for `finish_reason: "error"` to detect mid-stream errors in your client code.

## Recommended SSE clients

For parsing SSE streams, we recommend these libraries:

- [eventsource-parser](https://github.com/rexxars/eventsource-parser) -- Lightweight SSE parser
- [OpenAI SDK](https://www.npmjs.com/package/openai) -- Built-in streaming support
- [Vercel AI SDK](https://www.npmjs.com/package/ai) -- High-level streaming abstractions
