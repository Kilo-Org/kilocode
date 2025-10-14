#!/usr/bin/env tsx
// kilocode_change - new file

import http from "http"
import url from "url"
import { IncomingMessage, ServerResponse } from "http"

// Parse command line arguments
const args = process.argv.slice(2)
let errorRate = 0.1 // Default to 10% error rate

for (let i = 0; i < args.length; i++) {
	if (args[i] === "--error-rate" && args[i + 1]) {
		errorRate = parseFloat(args[i + 1])
		i++ // Skip next argument
	}
}

interface ModelResponse {
	object: string
	data: Array<{
		id: string
		object: string
		created: number
		owned_by: string
	}>
}

interface StreamChunk {
	id: string
	object: string
	created: number
	model: string
	choices: Array<{
		index: number
		delta: {
			role?: string
			content?: string
		}
		finish_reason: string | null
	}>
}

// Simple chat completion response template
const chatCompletionResponse = {
	id: "chatcmpl-34f4afff-2378-4fd1-a616-7bdd62d39d9f",
	object: "chat.completion",
	created: 1759421272,
	model: "deepseek-v3.1-terminus-thinking",
	choices: [
		{
			index: 0,
			message: {
				role: "assistant",
				content:
					"I'll calculate 15 × 23 step by step.\n\n## Method: Breaking down into simpler parts\n\n**Step 1:** Break down 23 into easier numbers\n- 23 = 20 + 3\n\n**Step 2:** Apply the distributive property\n- 15 × 23 = 15 × (20 + 3)\n- 15 × 23 = (15 × 20) + (15 × 3)\n\n**Step 3:** Calculate each part\n- 15 × 20 = 300\n- 15 × 3 = 45\n\n**Step 4:** Add the results together\n- 300 + 45 = 345\n\nTherefore, **15 × 23 = 345**",
				refusal: null,
				reasoning:
					"I need to calculate 15 * 23 step by step.\n\nLet me think about different ways to approach this:\n\nMethod 1: Break down one number\n15 * 23 = 15 * (20 + 3)\n= 15 * 20 + 15 * 3\n= 300 + 45\n= 345\n\nMethod 2: Break down the other number\n15 * 23 = (10 + 5) * 23\n= 10 * 23 + 5 * 23\n= 230 + 115\n= 345\n\nMethod 3: Standard multiplication\n    23\n  × 15\n  ----\n   115  (23 × 5)\n  230   (23 × 10)\n  ----\n  345\n\nAll methods give me 345. Let me verify once more:\n15 * 23 = 15 * 20 + 15 * 3 = 300 + 45 = 345\n\nYes, the answer is 345.",
				reasoning_details: [
					{
						type: "reasoning.text",
						text: "I need to calculate 15 * 23 step by step.\n\nLet me think about different ways to approach this:\n\nMethod 1: Break down one number\n15 * 23 = 15 * (20 + 3)\n= 15 * 20 + 15 * 3\n= 300 + 45\n= 345\n\nMethod 2: Break down the other number\n15 * 23 = (10 + 5) * 23\n= 10 * 23 + 5 * 23\n= 230 + 115\n= 345\n\nMethod 3: Standard multiplication\n    23\n  × 15\n  ----\n   115  (23 × 5)\n  230   (23 × 10)\n  ----\n  345\n\nAll methods give me 345. Let me verify once more:\n15 * 23 = 15 * 20 + 15 * 3 = 300 + 45 = 345\n\nYes, the answer is 345.",
						format: "unknown",
						index: 0,
					},
				],
			},
			finish_reason: "stop",
		},
	],
	usage: {
		prompt_tokens: 35,
		completion_tokens: 225,
		total_tokens: 260,
		completion_tokens_details: {
			reasoning_tokens: 127,
		},
	},
}

// SSE stream response template
const streamResponseTemplate = `
data: {"id":"gen-1759420128-LjBsuYJf6lKeyy66nQs9","provider":"DeepInfra","model":"z-ai/glm-4.5","object":"chat.completion.chunk","created":1759420128,"choices":[{"index":0,"delta":{"role":"assistant","content":"","reasoning":"\n","reasoning_details":[{"type":"reasoning.text","text":"\n","format":"unknown","index":0}]},"finish_reason":null,"native_finish_reason":null,"logprobs":null}]}

data: {"id":"gen-1759420128-LjBsuYJf6lKeyy66nQs9","provider":"DeepInfra","model":"z-ai/glm-4.5","object":"chat.completion.chunk","created":1759420128,"choices":[{"index":0,"delta":{"role":"assistant","content":"","reasoning":"Okay","reasoning_details":[{"type":"reasoning.text","text":"Okay","format":"unknown","index":0}]},"finish_reason":null,"native_finish_reason":null,"logprobs":null}]}

data: {"id":"gen-1759420128-LjBsuYJf6lKeyy66nQs9","provider":"DeepInfra","model":"z-ai/glm-4.5","object":"chat.completion.chunk","created":1759420128,"choices":[{"index":0,"delta":{"role":"assistant","content":"","reasoning":", the","reasoning_details":[{"type":"reasoning.text","text":", the","format":"unknown","index":0}]},"finish_reason":null,"native_finish_reason":null,"logprobs":null}]}

data: {"id":"gen-1759420128-LjBsuYJf6lKeyy66nQs9","provider":"DeepInfra","model":"z-ai/glm-4.5","object":"chat.completion.chunk","created":1759420128,"choices":[{"index":0,"delta":{"role":"assistant","content":"","reasoning":" user asked","reasoning_details":[{"type":"reasoning.text","text":" user asked","format":"unknown","index":0}]},"finish_reason":null,"native_finish_reason":null,"logprobs":null}]}

data: {"id":"gen-1759420128-LjBsuYJf6lKeyy66nQs9","provider":"DeepInfra","model":"z-ai/glm-4.5","object":"chat.completion.chunk","created":1759420128,"choices":[{"index":0,"delta":{"role":"assistant","content":"","reasoning":", \"","reasoning_details":[{"type":"reasoning.text","text":", \"","format":"unknown","index":0}]},"finish_reason":null,"native_finish_reason":null,"logprobs":null}]}

data: {"id":"gen-1759420128-LjBsuYJf6lKeyy66nQs9","provider":"DeepInfra","model":"z-ai/glm-4.5","object":"chat.completion.chunk","created":1759420128,"choices":[{"index":0,"delta":{"role":"assistant","content":"","reasoning":"What is","reasoning_details":[{"type":"reasoning.text","text":"What is","format":"unknown","index":0}]},"finish_reason":null,"native_finish_reason":null,"logprobs":null}]}

data: {"id":"gen-1759420128-LjBsuYJf6lKeyy66nQs9","provider":"DeepInfra","model":"z-ai/glm-4.5","object":"chat.completion.chunk","created":1759420128,"choices":[{"index":0,"delta":{"role":"assistant","content":" is","reasoning":null,"reasoning_details":[]},"finish_reason":null,"native_finish_reason":null,"logprobs":null}]}

data: {"id":"gen-1759420128-LjBsuYJf6lKeyy66nQs9","provider":"DeepInfra","model":"z-ai/glm-4.5","object":"chat.completion.chunk","created":1759420128,"choices":[{"index":0,"delta":{"role":"assistant","content":" uniquely yours","reasoning":null,"reasoning_details":[]},"finish_reason":null,"native_finish_reason":null,"logprobs":null}]}

data: {"id":"gen-1759420128-LjBsuYJf6lKeyy66nQs9","provider":"DeepInfra","model":"z-ai/glm-4.5","object":"chat.completion.chunk","created":1759420128,"choices":[{"index":0,"delta":{"role":"assistant","content":".","reasoning":null,"reasoning_details":[]},"finish_reason":null,"native_finish_reason":null,"logprobs":null}]}

data: {"id":"gen-1759420128-LjBsuYJf6lKeyy66nQs9","provider":"DeepInfra","model":"z-ai/glm-4.5","object":"chat.completion.chunk","created":1759420128,"choices":[{"index":0,"delta":{"role":"assistant","content":"","reasoning":null,"reasoning_details":[]},"finish_reason":"stop","native_finish_reason":"stop","logprobs":null}]}

data: {"id":"gen-1759420128-LjBsuYJf6lKeyy66nQs9","provider":"DeepInfra","model":"z-ai/glm-4.5","object":"chat.completion.chunk","created":1759420128,"choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null,"native_finish_reason":null,"logprobs":null}],"usage":{"prompt_tokens":12,"completion_tokens":1280,"total_tokens":1292,"prompt_tokens_details":null}}

data: [DONE]
`

const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
	const parsedUrl = url.parse(req.url!, true)
	const requestStartTime = Date.now()

	// Handle CORS
	res.setHeader("Access-Control-Allow-Origin", "*")
	res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")

	// Handle preflight requests
	if (req.method === "OPTIONS") {
		res.writeHead(200)
		res.end()
		console.log(`[${new Date().toISOString()}] OPTIONS ${req.url} -> 200 OK (${Date.now() - requestStartTime}ms)`)
		return
	}

	// Handle chat completions endpoint
	if (parsedUrl.pathname === "/v1/chat/completions" && req.method === "POST") {
		// Check if we should return a 429 error
		if (Math.random() < errorRate) {
			res.writeHead(429, { "Content-Type": "application/json" })
			res.end(JSON.stringify({ error: { message: "Rate limit exceeded", type: "rate_limit_exceeded" } }))
			console.log(
				`[${new Date().toISOString()}] POST ${req.url} -> 429 Rate Limit Exceeded (${Date.now() - requestStartTime}ms)`,
			)
			return
		}

		// Parse request body to check for stream parameter
		let body = ""
		req.on("data", (chunk) => {
			body += chunk.toString()
		})

		req.on("end", () => {
			try {
				const requestData = JSON.parse(body)
				const isStream = requestData.stream === true

				if (isStream) {
					// Stream response
					res.writeHead(200, {
						"Content-Type": "text/event-stream",
						"Cache-Control": "no-cache",
						Connection: "keep-alive",
					})

					// Send stream response with delays to simulate real streaming
					const responses = streamResponseTemplate.trim().split("\n\n")
					let index = 0

					const sendNext = () => {
						if (index < responses.length) {
							res.write(responses[index] + "\n\n")
							index++
							setTimeout(sendNext, 100) // 100ms delay between chunks
						} else {
							res.end()
							console.log(
								`[${new Date().toISOString()}] POST ${req.url} (stream) -> 200 OK (${Date.now() - requestStartTime}ms)`,
							)
						}
					}

					sendNext()
				} else {
					// Regular response
					res.writeHead(200, { "Content-Type": "application/json" })
					res.end(JSON.stringify(chatCompletionResponse))
					console.log(
						`[${new Date().toISOString()}] POST ${req.url} -> 200 OK (${Date.now() - requestStartTime}ms)`,
					)
				}
			} catch (error) {
				res.writeHead(400, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ error: { message: "Invalid JSON in request body" } }))
				console.log(
					`[${new Date().toISOString()}] POST ${req.url} -> 400 Bad Request (${Date.now() - requestStartTime}ms)`,
				)
			}
		})

		return
	}

	// Handle models endpoint
	if (parsedUrl.pathname === "/v1/models" && req.method === "GET") {
		const modelsResponse: ModelResponse = {
			object: "list",
			data: [
				{
					id: "gpt-3.5-turbo",
					object: "model",
					created: 1677610602,
					owned_by: "openai",
				},
			],
		}

		res.writeHead(200, { "Content-Type": "application/json" })
		res.end(JSON.stringify(modelsResponse))
		console.log(`[${new Date().toISOString()}] GET ${req.url} -> 200 OK (${Date.now() - requestStartTime}ms)`)
		return
	}

	// Handle root endpoint
	if (parsedUrl.pathname === "/" && req.method === "GET") {
		res.writeHead(200, { "Content-Type": "text/plain" })
		res.end("OpenAI Compatible Test Server Running\n")
		console.log(`[${new Date().toISOString()}] GET ${req.url} -> 200 OK (${Date.now() - requestStartTime}ms)`)
		return
	}

	// Handle 404 for all other routes
	res.writeHead(404, { "Content-Type": "application/json" })
	res.end(JSON.stringify({ error: { message: "Endpoint not found" } }))
	console.log(
		`[${new Date().toISOString()}] ${req.method} ${req.url} -> 404 Not Found (${Date.now() - requestStartTime}ms)`,
	)
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
	console.log(`OpenAI Compatible Test Server running on port ${PORT}`)
	console.log(`Error rate configured to ${errorRate * 100}%`)
	console.log(`Endpoints available:`)
	console.log(`  GET  / - Server status`)
	console.log(`  GET  /v1/models - List models`)
	console.log(`  POST /v1/chat/completions - Chat completions (with streaming support)`)
})
