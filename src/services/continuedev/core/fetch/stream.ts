/**
 * Parses a single line from an SSE (Server-Sent Events) stream.
 */
function parseSseLine(line: string): { done: boolean; data: unknown } {
	if (line.startsWith("data:[DONE]") || line.startsWith("data: [DONE]")) {
		return { done: true, data: undefined }
	}
	if (line.startsWith("data:")) {
		const jsonStr = line.slice(5).trim()
		try {
			return { done: false, data: JSON.parse(jsonStr) }
		} catch {
			return { done: false, data: undefined }
		}
	}
	if (line.startsWith(": ping")) {
		return { done: true, data: undefined }
	}
	return { done: false, data: undefined }
}

/**
 * Streams a Response body as UTF-8 text chunks.
 *
 * Modern implementation using native ReadableStream and TextDecoderStream APIs.
 * Requires Node.js 18+ or modern browsers.
 */
export async function* streamResponse(response: Response): AsyncGenerator<string> {
	// Handle client-side cancellation
	if (response.status === 499) {
		return
	}

	// Check for error responses
	if (response.status !== 200) {
		throw new Error(await response.text())
	}

	if (!response.body) {
		throw new Error("No response body returned.")
	}

	let chunks = 0

	try {
		// Modern API: Use TextDecoderStream to decode the response body
		const textStream = response.body.pipeThrough(new TextDecoderStream("utf-8"))
		const reader = textStream.getReader()

		try {
			while (true) {
				const { done, value } = await reader.read()
				if (done) break
				yield value
				chunks++
			}
		} finally {
			reader.releaseLock()
		}
	} catch (e) {
		if (e instanceof Error) {
			// Handle graceful cancellation
			if (e.name.startsWith("AbortError")) {
				return
			}

			// Handle premature close errors
			if (e.message.toLowerCase().includes("premature close")) {
				if (chunks === 0) {
					throw new Error("Stream was closed before any data was received. Try again. (Premature Close)")
				} else {
					throw new Error("The response was cancelled mid-stream. Try again. (Premature Close).")
				}
			}
		}
		throw e
	}
}
/**
 * Streams Server-Sent Events (SSE) from a Response.
 * Parses SSE format and yields parsed data objects.
 */
export async function* streamSse(response: Response): AsyncGenerator<any> {
	let buffer = ""

	for await (const value of streamResponse(response)) {
		buffer += value

		let position: number
		while ((position = buffer.indexOf("\n")) >= 0) {
			const line = buffer.slice(0, position)
			buffer = buffer.slice(position + 1)

			const { done, data } = parseSseLine(line)
			if (done) {
				break
			}
			if (data) {
				yield data
			}
		}
	}

	// Process any remaining buffered content
	if (buffer.length > 0) {
		const { done, data } = parseSseLine(buffer)
		if (!done && data) {
			yield data
		}
	}
}

/**
 * Streams newline-delimited JSON from a Response.
 * Each line should be a complete JSON object.
 */
export async function* streamJSON(response: Response): AsyncGenerator<any> {
	let buffer = ""

	for await (const value of streamResponse(response)) {
		buffer += value

		let position: number
		while ((position = buffer.indexOf("\n")) >= 0) {
			const line = buffer.slice(0, position)
			buffer = buffer.slice(position + 1)

			if (line.trim()) {
				try {
					const data = JSON.parse(line)
					yield data
				} catch {
					throw new Error(`Malformed JSON sent from server: ${line}`)
				}
			}
		}
	}
}
