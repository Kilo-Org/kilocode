import { getApiUrl } from "@roo-code/types"

type HttpMethod = "GET" | "POST"

/**
 * Generic tRPC response wrapper
 */
export type TrpcResponse<T> = { result: { data: T } }

export interface TrpcClientDependencies {
	getToken: () => Promise<string>
}

/**
 * Client for making tRPC requests to the KiloCode API.
 * Handles authentication and request formatting.
 */
export class TrpcClient {
	public readonly endpoint: string

	public readonly getToken: () => Promise<string>

	constructor(dependencies: TrpcClientDependencies) {
		this.endpoint = getApiUrl()
		this.getToken = dependencies.getToken
	}

	/**
	 * Make a tRPC request to the API.
	 * @param procedure The tRPC procedure name (e.g., "cliSessions.get")
	 * @param method The HTTP method to use
	 * @param input Optional input data for the request
	 * @returns The unwrapped response data
	 */
	async request<TInput = void, TOutput = unknown>(
		procedure: string,
		method: HttpMethod,
		input?: TInput,
	): Promise<TOutput> {
		const url = new URL(`${this.endpoint}/api/trpc/${procedure}`)

		if (method === "GET" && input) {
			url.searchParams.set("input", JSON.stringify(input))
		}

		const response = await fetch(url, {
			method,
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${await this.getToken()}`,
			},
			...(method === "POST" && input && { body: JSON.stringify(input) }),
		})

		if (!response.ok) {
			throw new Error(`tRPC request failed: ${response.status}`)
		}

		const trpcResponse = (await response.json()) as TrpcResponse<TOutput>
		return trpcResponse.result.data
	}
}
