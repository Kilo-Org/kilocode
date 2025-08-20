import * as undici from "undici"

export function fetchWithTimeout(timeoutMs: number, headers?: Record<string, string>): typeof fetch {
	const agent = new undici.Agent({ headersTimeout: timeoutMs, bodyTimeout: timeoutMs })
	return async (input, init) => {
		const mergedHeaders = {
			...headers, // Persistent headers from function parameter
			...(init?.headers || {}), // Request-specific headers (can override persistent ones)
		}
		const response = (await undici.fetch(
			input as undici.RequestInfo,
			{
				...init,
				headers: mergedHeaders,
				dispatcher: agent,
			} as undici.RequestInit,
		)) as unknown as Response
		return response
	}
}
