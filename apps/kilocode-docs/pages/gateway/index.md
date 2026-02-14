---
title: "AI Gateway"
description: "A unified API to access hundreds of AI models through a single endpoint, with built-in usage tracking, BYOK support, and organization controls."
---

# AI Gateway

The Kilo AI Gateway provides a unified, OpenAI-compatible API to access hundreds of AI models through a single endpoint at `https://api.kilo.ai/api/gateway`. It gives you the ability to track usage, manage costs, bring your own API keys, and enforce organization-level controls.

The gateway works seamlessly with the [Vercel AI SDK](https://ai-sdk.dev), the [OpenAI SDK](/docs/gateway/sdks-and-frameworks#openai-sdk), or any OpenAI-compatible client in any language.

## Key features

- **One key, hundreds of models**: Access models from Anthropic, OpenAI, Google, xAI, Mistral, MiniMax, and more with a single API key
- **OpenAI-compatible API**: Drop-in replacement for OpenAI's `/chat/completions` endpoint -- switch models by changing a single string
- **Streaming support**: Full Server-Sent Events (SSE) streaming with time-to-first-token tracking
- **BYOK (Bring Your Own Key)**: Use your own provider API keys with encrypted-at-rest storage
- **Usage tracking**: Per-request cost and token tracking with microdollar precision
- **Organization controls**: Model allow lists, provider restrictions, per-user daily spending limits, and balance management
- **Tool calling**: Robust function/tool calling with automatic repair for deduplication and orphan cleanup
- **FIM completions**: Fill-in-the-middle code completions via Mistral Codestral

```typescript
import { streamText } from "ai"
import { createOpenAI } from "@ai-sdk/openai"

const kilo = createOpenAI({
	baseURL: "https://api.kilo.ai/api/gateway",
	apiKey: process.env.KILO_API_KEY,
})

const result = streamText({
	model: kilo("anthropic/claude-sonnet-4.5"),
	prompt: "Why is the sky blue?",
})
```

## Base URL

All gateway API requests use the following base URL:

```
https://api.kilo.ai/api/gateway
```

## More resources

- [Quickstart](/docs/gateway/quickstart) -- Get up and running in minutes
- [Authentication](/docs/gateway/authentication) -- API keys, sessions, and BYOK
- [Models & Providers](/docs/gateway/models-and-providers) -- Available models and routing behavior
- [Streaming](/docs/gateway/streaming) -- Real-time SSE streaming
- [API Reference](/docs/gateway/api-reference) -- Full request/response schemas
- [Usage & Billing](/docs/gateway/usage-and-billing) -- Cost tracking and organization controls
- [SDKs & Frameworks](/docs/gateway/sdks-and-frameworks) -- Integration guides for popular SDKs
