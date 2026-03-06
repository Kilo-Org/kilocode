/**
 * Energy capture module for intercepting energy data from SSE streams.
 *
 * Supports two formats:
 * 1. Neuralwatt: SSE comments like `: energy {"energy_joules":1632,...}`
 * 2. GreenPT: `impact` field in response data chunks
 *
 * Energy data is captured via a TransformStream that snoops on the response
 * body without modifying the stream that the AI SDK consumes.
 */

import { type Energy, parseNeuralwatt, parseGreenPT } from "./energy"

// Kilo Code processes one LLM request at a time, so a single variable
// is sufficient to hold the pending energy capture.
let pending: Energy | undefined

/**
 * Store captured energy data for later retrieval by the provider handler.
 * If called multiple times per request (e.g., multiple energy lines in one
 * stream), the last value wins — the final measurement is typically the
 * most accurate.
 */
export function store(energy: Energy) {
	pending = energy
}

/**
 * Consume (read and clear) captured energy data.
 * Returns undefined if no energy was captured.
 */
export function consume(): Energy | undefined {
	const energy = pending
	pending = undefined
	return energy
}

/**
 * Discard any pending energy data. Call this on request failure or abort
 * to prevent stale entries from leaking to a future request.
 */
export function discard() {
	pending = undefined
}

/**
 * Create a Response wrapper that captures energy data from the SSE stream
 * without modifying the bytes that flow to the downstream consumer (AI SDK).
 *
 * This uses a TransformStream as a passthrough sniffer: all bytes are
 * forwarded unchanged, but we also decode and inspect SSE lines for
 * energy-related content.
 */
export function wrapResponse(response: Response): Response {
	const body = response.body
	if (!body) return response

	const decoder = new TextDecoder()
	let buffer = ""

	const transform = new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			// Pass through unchanged
			controller.enqueue(chunk)

			// Decode and inspect for energy data
			const decoded = decoder.decode(chunk, { stream: true })
			buffer += decoded
			const lines = buffer.split("\n")
			buffer = lines.pop() || ""

			for (const line of lines) {
				// Neuralwatt: SSE comment with energy data
				if (line.startsWith(": energy ")) {
					try {
						const data = JSON.parse(line.slice(9))
						store(parseNeuralwatt(data))
					} catch {
						// Ignore malformed energy comments
					}
					continue
				}

				// GreenPT: impact field in data lines (quick string check avoids
				// JSON.parse on every SSE data line for non-GreenPT providers)
				if (line.startsWith("data: ") && line !== "data: [DONE]" && line.includes('"impact"')) {
					try {
						const parsed = JSON.parse(line.slice(6))
						if (parsed.impact && typeof parsed.impact === "object") {
							store(parseGreenPT(parsed.impact))
						}
					} catch {
						// Ignore malformed data lines
					}
				}
			}
		},
		flush() {
			// Check any remaining buffer for energy data
			if (buffer.startsWith(": energy ")) {
				try {
					const data = JSON.parse(buffer.slice(9))
					store(parseNeuralwatt(data))
				} catch {
					// Ignore
				}
			} else if (buffer.startsWith("data: ") && buffer !== "data: [DONE]" && buffer.includes('"impact"')) {
				try {
					const parsed = JSON.parse(buffer.slice(6))
					if (parsed.impact && typeof parsed.impact === "object") {
						store(parseGreenPT(parsed.impact))
					}
				} catch {
					// Ignore
				}
			}
			buffer = ""
		},
	})

	return new Response(body.pipeThrough(transform), {
		headers: response.headers,
		status: response.status,
		statusText: response.statusText,
	})
}
