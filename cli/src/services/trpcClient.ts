import { logs } from "./logs"
import { getApiUrl } from "@roo-code/types"

type HttpMethod = "GET" | "POST"

// Generic tRPC response wrapper
export type TrpcResponse<T> = { result: { data: T } }

export class TrpcClient {
	private static instance: TrpcClient | null = null

	static init(token?: string) {
		if (!token && !TrpcClient.instance) {
			throw new Error("token required to init TrpcClient service")
		}

		if (token && !TrpcClient.instance) {
			TrpcClient.instance = new TrpcClient(token)

			logs.debug("Initiated TrpcClient", "TrpcClient")
		}

		return TrpcClient.instance!
	}

	public readonly endpoint = getApiUrl()

	private constructor(public readonly token: string) {}

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
				Authorization: `Bearer ${this.token}`,
			},
			...(method === "POST" && input && { body: JSON.stringify(input) }),
		})

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}))

			throw new Error(
				`tRPC request failed: ${response.status} ${response.statusText}${
					errorData.message ? ` - ${errorData.message}` : ""
				}`,
			)
		}

		return response.json()
	}
}
