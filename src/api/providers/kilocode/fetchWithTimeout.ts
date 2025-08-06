import * as undici from "undici"

export function fetchWithTimeout(timeoutMs: number): typeof fetch {
	const agent = new undici.Agent({ headersTimeout: timeoutMs, bodyTimeout: timeoutMs })
	return (input, init) =>
		undici.fetch(
			input as undici.RequestInfo,
			{
				...init,
				dispatcher: agent,
			} as undici.RequestInit,
		) as unknown as Promise<Response>
}
