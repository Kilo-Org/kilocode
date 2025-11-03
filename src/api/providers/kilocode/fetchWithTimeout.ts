import * as undici from "undici"

export const HeadersTimeoutError = undici.errors.HeadersTimeoutError

export function fetchWithTimeout(timeoutMs: number, headers?: Record<string, string>): typeof fetch {
	const agent = new undici.EnvHttpProxyAgent({
		headersTimeout: timeoutMs,
		bodyTimeout: timeoutMs,
	})
	return (input, init) => {
		const requestInit: undici.RequestInit = {
			...(init as undici.RequestInit),
			dispatcher: agent,
		}

		if (headers) {
			requestInit.headers = {
				...(init?.headers || {}),
				...headers,
			}
		}

		return undici.fetch(input as undici.RequestInfo, requestInit) as unknown as Promise<Response>
	}
}
