---
title: "SDKs & Frameworks"
description: "Integrate with the Kilo AI Gateway using the Vercel AI SDK, OpenAI SDK, Python, cURL, or any OpenAI-compatible client."
---

# SDKs & Frameworks

The Kilo AI Gateway is OpenAI-compatible, meaning any SDK or framework that works with the OpenAI API can work with the Kilo Gateway by changing the base URL.

## Vercel AI SDK (Recommended)

The [Vercel AI SDK](https://ai-sdk.dev) provides a high-level TypeScript interface for building AI applications with streaming, tool calling, and structured output support.

### Installation

```bash
npm install ai @ai-sdk/openai
```

### Basic usage

```typescript
import { streamText } from "ai"
import { createOpenAI } from "@ai-sdk/openai"

const kilo = createOpenAI({
	baseURL: "https://api.kilo.ai/api/gateway",
	apiKey: process.env.KILO_API_KEY,
})

const result = streamText({
	model: kilo("anthropic/claude-sonnet-4.5"),
	prompt: "Write a haiku about programming.",
})

for await (const textPart of result.textStream) {
	process.stdout.write(textPart)
}
```

### With tool calling

```typescript
import { streamText, tool } from "ai"
import { createOpenAI } from "@ai-sdk/openai"
import { z } from "zod"

const kilo = createOpenAI({
	baseURL: "https://api.kilo.ai/api/gateway",
	apiKey: process.env.KILO_API_KEY,
})

const result = streamText({
	model: kilo("anthropic/claude-sonnet-4.5"),
	prompt: "What is the weather in San Francisco?",
	tools: {
		getWeather: tool({
			description: "Get the current weather for a location",
			parameters: z.object({
				location: z.string().describe("City name"),
			}),
			execute: async ({ location }) => {
				return { temperature: 72, condition: "sunny" }
			},
		}),
	},
})

for await (const textPart of result.textStream) {
	process.stdout.write(textPart)
}
```

### In a Next.js API route

```typescript
import { streamText } from "ai"
import { createOpenAI } from "@ai-sdk/openai"

const kilo = createOpenAI({
	baseURL: "https://api.kilo.ai/api/gateway",
	apiKey: process.env.KILO_API_KEY,
})

export async function POST(request: Request) {
	const { messages } = await request.json()

	const result = streamText({
		model: kilo("anthropic/claude-sonnet-4.5"),
		messages,
	})

	return result.toDataStreamResponse()
}
```

## OpenAI SDK

The official OpenAI SDKs work with the Kilo Gateway by setting the base URL.

### TypeScript / JavaScript

```bash
npm install openai
```

```typescript
import OpenAI from "openai"

const client = new OpenAI({
	apiKey: process.env.KILO_API_KEY,
	baseURL: "https://api.kilo.ai/api/gateway",
})

// Non-streaming
const response = await client.chat.completions.create({
	model: "anthropic/claude-sonnet-4.5",
	messages: [
		{ role: "system", content: "You are a helpful assistant." },
		{ role: "user", content: "Explain quantum entanglement simply." },
	],
})

console.log(response.choices[0].message.content)

// Streaming
const stream = await client.chat.completions.create({
	model: "anthropic/claude-sonnet-4.5",
	messages: [{ role: "user", content: "Write a poem about the ocean." }],
	stream: true,
})

for await (const chunk of stream) {
	const content = chunk.choices[0]?.delta?.content
	if (content) process.stdout.write(content)
}
```

### Python

```bash
pip install openai
```

```python
import os
from openai import OpenAI

client = OpenAI(
    api_key=os.getenv("KILO_API_KEY"),
    base_url="https://api.kilo.ai/api/gateway",
)

# Non-streaming
response = client.chat.completions.create(
    model="anthropic/claude-sonnet-4.5",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Explain quantum entanglement simply."},
    ],
)

print(response.choices[0].message.content)

# Streaming
stream = client.chat.completions.create(
    model="anthropic/claude-sonnet-4.5",
    messages=[
        {"role": "user", "content": "Write a poem about the ocean."},
    ],
    stream=True,
)

for chunk in stream:
    content = chunk.choices[0].delta.content
    if content:
        print(content, end="", flush=True)
```

## cURL

### Non-streaming request

```bash
curl -X POST "https://api.kilo.ai/api/gateway/chat/completions" \
  -H "Authorization: Bearer $KILO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "anthropic/claude-sonnet-4.5",
    "messages": [
      {"role": "user", "content": "What is the capital of France?"}
    ]
  }'
```

### Streaming request

```bash
curl -N -X POST "https://api.kilo.ai/api/gateway/chat/completions" \
  -H "Authorization: Bearer $KILO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "anthropic/claude-sonnet-4.5",
    "messages": [
      {"role": "user", "content": "Write a short story about AI."}
    ],
    "stream": true
  }'
```

The `-N` flag disables buffering so you see tokens as they arrive.

## Other languages

Any HTTP client that can send JSON POST requests and set headers can use the gateway. Here are examples in other languages:

### Go

```go
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "os"
)

func main() {
    body := map[string]interface{}{
        "model": "anthropic/claude-sonnet-4.5",
        "messages": []map[string]string{
            {"role": "user", "content": "Why is the sky blue?"},
        },
    }

    jsonBody, _ := json.Marshal(body)

    req, _ := http.NewRequest("POST",
        "https://api.kilo.ai/api/gateway/chat/completions",
        bytes.NewBuffer(jsonBody))

    req.Header.Set("Authorization", "Bearer "+os.Getenv("KILO_API_KEY"))
    req.Header.Set("Content-Type", "application/json")

    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        panic(err)
    }
    defer resp.Body.Close()

    respBody, _ := io.ReadAll(resp.Body)
    fmt.Println(string(respBody))
}
```

### Ruby

```ruby
require 'net/http'
require 'json'

uri = URI('https://api.kilo.ai/api/gateway/chat/completions')
http = Net::HTTP.new(uri.host, uri.port)
http.use_ssl = true

request = Net::HTTP::Post.new(uri)
request['Authorization'] = "Bearer #{ENV['KILO_API_KEY']}"
request['Content-Type'] = 'application/json'
request.body = {
  model: 'anthropic/claude-sonnet-4.5',
  messages: [
    { role: 'user', content: 'Why is the sky blue?' }
  ]
}.to_json

response = http.request(request)
result = JSON.parse(response.body)
puts result['choices'][0]['message']['content']
```

## Framework integrations

The Kilo AI Gateway works with any framework that supports OpenAI-compatible APIs:

| Framework                                                             | Integration                               |
| --------------------------------------------------------------------- | ----------------------------------------- |
| [Vercel AI SDK](https://ai-sdk.dev)                                   | Use `createOpenAI` with Kilo base URL     |
| [LangChain](https://langchain.com)                                    | Use `ChatOpenAI` with custom base URL     |
| [LlamaIndex](https://www.llamaindex.ai)                               | Use OpenAI-compatible configuration       |
| [Haystack](https://haystack.deepset.ai)                               | Use OpenAI generator with custom URL      |
| [Semantic Kernel](https://learn.microsoft.com/en-us/semantic-kernel/) | Use OpenAI connector with custom endpoint |

### LangChain example

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    model="anthropic/claude-sonnet-4.5",
    api_key=os.getenv("KILO_API_KEY"),
    base_url="https://api.kilo.ai/api/gateway",
)

response = llm.invoke("Explain photosynthesis in simple terms.")
print(response.content)
```

### LangChain.js example

```typescript
import { ChatOpenAI } from "@langchain/openai"

const model = new ChatOpenAI({
	modelName: "anthropic/claude-sonnet-4.5",
	openAIApiKey: process.env.KILO_API_KEY,
	configuration: {
		baseURL: "https://api.kilo.ai/api/gateway",
	},
})

const response = await model.invoke("Explain photosynthesis in simple terms.")
console.log(response.content)
```
