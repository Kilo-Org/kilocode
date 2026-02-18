---
title: "Quickstart"
description: "Get started with the Kilo AI Gateway in minutes. Make your first AI model request using the Vercel AI SDK, OpenAI SDK, Python, or cURL."
---

# Quickstart

This guide walks you through making your first AI model request with the Kilo AI Gateway. While this guide focuses on the [Vercel AI SDK](https://ai-sdk.dev), you can also use the [OpenAI SDK](/docs/gateway/sdks-and-frameworks#openai-sdk), [Python](/docs/gateway/sdks-and-frameworks#python), or [cURL](/docs/gateway/sdks-and-frameworks#curl).

## Prerequisites

You need a Kilo account with API credits. Sign up at [kilo.ai](https://kilo.ai) and add credits from your account dashboard.

## Using the Vercel AI SDK

### 1. Create your project

```bash
mkdir my-ai-app
cd my-ai-app
npm init -y
```

### 2. Install dependencies

```bash
npm install ai @ai-sdk/openai dotenv
```

### 3. Set up your API key

Create a `.env` file and add your Kilo API key:

```bash
KILO_API_KEY=your_api_key_here
```

For step-by-step instructions on getting an API key, please see the [Kilo Gateway API Key instructions](/docs/getting-started/setup-authentication#kilo-gateway-api-key).

### 4. Create and run your script

Create an `index.mjs` file:

```javascript
import { streamText } from "ai"
import { createOpenAI } from "@ai-sdk/openai"
import "dotenv/config"

const kilo = createOpenAI({
	baseURL: "https://api.kilo.ai/api/gateway",
	apiKey: process.env.KILO_API_KEY,
})

async function main() {
	const result = streamText({
		model: kilo("anthropic/claude-sonnet-4.5"),
		prompt: "Invent a new holiday and describe its traditions.",
	})

	for await (const textPart of result.textStream) {
		process.stdout.write(textPart)
	}

	console.log()
	console.log("Token usage:", await result.usage)
	console.log("Finish reason:", await result.finishReason)
}

main().catch(console.error)
```

Run the script:

```bash
node index.mjs
```

You should see the model's response streamed to your terminal.

## Using the OpenAI SDK

The Kilo AI Gateway is fully OpenAI-compatible, so you can use the OpenAI SDK by pointing it to the Kilo base URL.

{% tabs %}
{% tab label="TypeScript" %}

```typescript
import OpenAI from "openai"

const client = new OpenAI({
	apiKey: process.env.KILO_API_KEY,
	baseURL: "https://api.kilo.ai/api/gateway",
})

const response = await client.chat.completions.create({
	model: "anthropic/claude-sonnet-4.5",
	messages: [{ role: "user", content: "Why is the sky blue?" }],
})

console.log(response.choices[0].message.content)
```

{% /tab %}
{% tab label="Python" %}

```python
import os
from openai import OpenAI

client = OpenAI(
    api_key=os.getenv("KILO_API_KEY"),
    base_url="https://api.kilo.ai/api/gateway",
)

response = client.chat.completions.create(
    model="anthropic/claude-sonnet-4.5",
    messages=[
        {"role": "user", "content": "Why is the sky blue?"}
    ],
)

print(response.choices[0].message.content)
```

{% /tab %}
{% /tabs %}

## Using cURL

```bash
curl -X POST "https://api.kilo.ai/api/gateway/chat/completions" \
  -H "Authorization: Bearer $KILO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "anthropic/claude-sonnet-4.5",
    "messages": [
      {
        "role": "user",
        "content": "Why is the sky blue?"
      }
    ],
    "stream": false
  }'
```

## Next steps

- [Authentication](/docs/gateway/authentication) -- Learn about API key management and BYOK
- [Models & Providers](/docs/gateway/models-and-providers) -- Browse available models and understand routing
- [Streaming](/docs/gateway/streaming) -- Implement real-time streaming responses
- [API Reference](/docs/gateway/api-reference) -- Full request and response schemas
