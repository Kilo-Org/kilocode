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

// Define types for our responses
interface ChatCompletionResponse {
	id: string
	object: string
	created: number
	model: string
	choices: Array<{
		index: number
		message: {
			role: string
			content: string
		}
		finish_reason: string
	}>
	usage: {
		prompt_tokens: number
		completion_tokens: number
		total_tokens: number
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
const chatCompletionResponse: ChatCompletionResponse = {
	id: "chatcmpl-123",
	object: "chat.completion",
	created: Math.floor(Date.now() / 1000),
	model: "gpt-3.5-turbo",
	choices: [
		{
			index: 0,
			message: {
				role: "assistant",
				content: "This is a test response from the OpenAI compatible server.",
			},
			finish_reason: "stop",
		},
	],
	usage: {
		prompt_tokens: 10,
		completion_tokens: 20,
		total_tokens: 30,
	},
}

// SSE stream response template
const streamResponseTemplate = `
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694616620,"model":"gpt-3.5-turbo","choices":[{"index":0,"delta":{"role":"assistant","content":"This "},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694616620,"model":"gpt-3.5-turbo","choices":[{"index":0,"delta":{"content":"is "},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694616620,"model":"gpt-3.5-turbo","choices":[{"index":0,"delta":{"content":"a "},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694616620,"model":"gpt-3.5-turbo","choices":[{"index":0,"delta":{"content":"test "},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694616620,"model":"gpt-3.5-turbo","choices":[{"index":0,"delta":{"content":"response."},"finish_reason":"stop"}]}
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
