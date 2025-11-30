import { TrpcClient, TrpcResponse } from "./trpcClient.js"

// Type definitions matching backend schema
export interface Session {
	session_id: string
	title: string
	created_at: string
	updated_at: string
}

export interface SessionWithSignedUrls extends Session {
	api_conversation_history_blob_url: string | null
	task_metadata_blob_url: string | null
	ui_messages_blob_url: string | null
	git_state_blob_url: string | null
}

export interface GetSessionInput {
	session_id: string
	include_blob_urls?: boolean
}

export type GetSessionOutput = Session | SessionWithSignedUrls

export interface CreateSessionInput {
	title?: string
	git_url?: string
	created_on_platform: string
}

export type CreateSessionOutput = Session

export interface UpdateSessionInput {
	session_id: string
	title?: string
	git_url?: string
}

export interface UpdateSessionOutput {
	session_id: string
	title: string
	updated_at: string
}

export interface ListSessionsInput {
	cursor?: string
	limit?: number
}

export interface ListSessionsOutput {
	cliSessions: Session[]
	nextCursor: string | null
}

export interface SearchSessionInput {
	search_string: string
	limit?: number
	offset?: number
}

export interface SearchSessionOutput {
	results: Session[]
	total: number
	limit: number
	offset: number
}

// Shared state enum
export enum CliSessionSharedState {
	Public = "public",
}

export type ShareSessionInput = {
	session_id: string
	shared_state: CliSessionSharedState
}

export interface ShareSessionOutput {
	share_id: string
	session_id: string
}

export interface ForkSessionInput {
	share_id: string
}

export interface ForkSessionOutput {
	session_id: string
}

export interface DeleteSessionInput {
	session_id: string
}

export interface DeleteSessionOutput {
	success: boolean
	session_id: string
}

export class SessionClient {
	private static instance: SessionClient | null = null

	static getInstance() {
		if (!SessionClient.instance) {
			SessionClient.instance = new SessionClient()
		}

		return SessionClient.instance!
	}

	private constructor() {}

	/**
	 * Get a specific session by ID
	 */
	async get(input: GetSessionInput): Promise<GetSessionOutput> {
		const client = TrpcClient.init()
		const response = await client.request<GetSessionInput, TrpcResponse<GetSessionOutput>>(
			"cliSessions.get",
			"GET",
			input,
		)
		return response.result.data
	}

	/**
	 * Create a new session
	 */
	async create(input: CreateSessionInput): Promise<CreateSessionOutput> {
		const client = TrpcClient.init()
		const response = await client.request<CreateSessionInput, TrpcResponse<CreateSessionOutput>>(
			"cliSessions.create",
			"POST",
			input,
		)
		return response.result.data
	}

	/**
	 * Update an existing session
	 */
	async update(input: UpdateSessionInput): Promise<UpdateSessionOutput> {
		const client = TrpcClient.init()
		const response = await client.request<UpdateSessionInput, TrpcResponse<UpdateSessionOutput>>(
			"cliSessions.update",
			"POST",
			input,
		)
		return response.result.data
	}

	/**
	 * List sessions with pagination support
	 */
	async list(input?: ListSessionsInput): Promise<ListSessionsOutput> {
		const client = TrpcClient.init()
		const response = await client.request<ListSessionsInput, TrpcResponse<ListSessionsOutput>>(
			"cliSessions.list",
			"GET",
			input || {},
		)
		return response.result.data
	}

	/**
	 * Search sessions
	 */
	async search(input: SearchSessionInput): Promise<SearchSessionOutput> {
		const client = TrpcClient.init()
		const response = await client.request<SearchSessionInput, TrpcResponse<SearchSessionOutput>>(
			"cliSessions.search",
			"GET",
			input,
		)
		return response.result.data
	}

	/**
	 * Share a session
	 */
	async share(input: ShareSessionInput): Promise<ShareSessionOutput> {
		const client = TrpcClient.init()
		const response = await client.request<ShareSessionInput, TrpcResponse<ShareSessionOutput>>(
			"cliSessions.share",
			"POST",
			input,
		)
		return response.result.data
	}

	/**
	 * Fork a shared session by share ID
	 */
	async fork(input: ForkSessionInput): Promise<ForkSessionOutput> {
		const client = TrpcClient.init()
		const response = await client.request<ForkSessionInput, TrpcResponse<ForkSessionOutput>>(
			"cliSessions.fork",
			"POST",
			input,
		)
		return response.result.data
	}

	/**
	 * Delete a session
	 */
	async delete(input: DeleteSessionInput): Promise<DeleteSessionOutput> {
		const client = TrpcClient.init()
		const response = await client.request<DeleteSessionInput, TrpcResponse<DeleteSessionOutput>>(
			"cliSessions.delete",
			"POST",
			input,
		)
		return response.result.data
	}

	/**
	 * Upload a blob for a session
	 */
	async uploadBlob(
		sessionId: string,
		blobType: "api_conversation_history" | "task_metadata" | "ui_messages" | "git_state",
		blobData: unknown,
	): Promise<{ session_id: string; updated_at: string }> {
		const client = TrpcClient.init()
		const { endpoint, token } = client

		const url = new URL(`${endpoint}/api/upload-cli-session-blob`)
		url.searchParams.set("session_id", sessionId)
		url.searchParams.set("blob_type", blobType)

		const response = await fetch(url.toString(), {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify(blobData),
		})

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}))
			throw new Error(
				`Blob upload failed: ${response.status} ${response.statusText}${
					errorData.error ? ` - ${errorData.error}` : ""
				}`,
			)
		}

		return response.json()
	}
}
