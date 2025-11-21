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
	sessionId: string
	includeBlobs?: boolean
}

export type GetSessionOutput = Session | SessionWithSignedUrls

export interface CreateSessionInput {
	title?: string
	api_conversation_history?: unknown
	task_metadata?: unknown
	ui_messages?: unknown
	git_state?: unknown
}

export type CreateSessionOutput = Session

export interface UpdateSessionInput {
	sessionId: string
	title?: string
	api_conversation_history?: unknown
	task_metadata?: unknown
	ui_messages?: unknown
	git_state?: unknown
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
	searchString: string
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

export type SetSharedStateInput = {
	sessionId: string
	sharedState: CliSessionSharedState
	gitState: {
		repoUrl: string
		head: string
		patch: string
	}
}

export interface SetSharedStateOutput {
	success: boolean
	session: {
		session_id: string
		shared_state: string
	}
}

export interface ForkSessionInput {
	sessionId: string
}

export type ForkSessionOutput = SessionWithSignedUrls

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
	 * Set session sharing state
	 */
	async setSharedState(input: SetSharedStateInput): Promise<SetSharedStateOutput> {
		const client = TrpcClient.init()
		const response = await client.request<SetSharedStateInput, TrpcResponse<SetSharedStateOutput>>(
			"cliSessions.setSharedState",
			"POST",
			input,
		)
		return response.result.data
	}

	/**
	 * Fork an existing session
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
}
