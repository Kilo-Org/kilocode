import type { TrpcClient } from "./TrpcClient.js"

export interface Session {
	session_id: string
	title: string
	created_at: string
	updated_at: string
	git_url: string | null
	version: number
	cloud_agent_session_id: string | null
	created_on_platform: string
	organization_id: string | null
	last_mode: string | null
	last_model: string | null
	parent_session_id: string | null
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
	version?: number
	last_mode?: string | null | undefined
	last_model?: string | null | undefined
	organization_id?: string | undefined
	parent_session_id?: string | null | undefined
}

export type CreateSessionOutput = Session

export interface UpdateSessionInput {
	session_id: string
	title?: string
	git_url?: string
	version?: number
	last_mode?: string | null | undefined
	last_model?: string | null | undefined
	organization_id?: string | null | undefined
}

export type UpdateSessionOutput = Session

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
	share_or_session_id: string
	created_on_platform: string
}

export type ForkSessionOutput = Session

export interface DeleteSessionInput {
	session_id: string
}

export interface DeleteSessionOutput {
	success: boolean
	session_id: string
}

/**
 * Client for interacting with session-related API endpoints.
 * Provides methods for CRUD operations on sessions.
 */
export class SessionClient {
	constructor(private readonly trpcClient: TrpcClient) {}

	/**
	 * Get a specific session by ID
	 */
	async get(input: GetSessionInput): Promise<GetSessionOutput> {
		return await this.trpcClient.request<GetSessionInput, GetSessionOutput>("cliSessions.get", "GET", input)
	}

	/**
	 * Create a new session
	 */
	async create(input: CreateSessionInput): Promise<CreateSessionOutput> {
		return await this.trpcClient.request<CreateSessionInput, CreateSessionOutput>("cliSessions.createV2", "POST", {
			...input,
			created_on_platform: process.env.KILO_PLATFORM || input.created_on_platform,
		})
	}

	/**
	 * Update an existing session
	 */
	async update(input: UpdateSessionInput): Promise<UpdateSessionOutput> {
		return await this.trpcClient.request<UpdateSessionInput, UpdateSessionOutput>(
			"cliSessions.update",
			"POST",
			input,
		)
	}

	/**
	 * List sessions with pagination support
	 */
	async list(input?: ListSessionsInput): Promise<ListSessionsOutput> {
		return await this.trpcClient.request<ListSessionsInput, ListSessionsOutput>(
			"cliSessions.list",
			"GET",
			input || {},
		)
	}

	/**
	 * Search sessions
	 */
	async search(input: SearchSessionInput): Promise<SearchSessionOutput> {
		return await this.trpcClient.request<SearchSessionInput, SearchSessionOutput>(
			"cliSessions.search",
			"GET",
			input,
		)
	}

	/**
	 * Share a session
	 */
	async share(input: ShareSessionInput): Promise<ShareSessionOutput> {
		return await this.trpcClient.request<ShareSessionInput, ShareSessionOutput>("cliSessions.share", "POST", input)
	}

	/**
	 * Fork a shared session by share ID
	 */
	async fork(input: ForkSessionInput): Promise<ForkSessionOutput> {
		return await this.trpcClient.request<ForkSessionInput, ForkSessionOutput>("cliSessions.fork", "POST", input)
	}

	/**
	 * Delete a session
	 */
	async delete(input: DeleteSessionInput): Promise<DeleteSessionOutput> {
		return await this.trpcClient.request<DeleteSessionInput, DeleteSessionOutput>(
			"cliSessions.delete",
			"POST",
			input,
		)
	}

	/**
	 * Upload a blob for a session using signed URL
	 */
	async uploadBlob(
		sessionId: string,
		blobType: "api_conversation_history" | "task_metadata" | "ui_messages" | "git_state",
		blobData: unknown,
	): Promise<{ updated_at: string }> {
		const blobBody = JSON.stringify(blobData)
		const contentLength = new TextEncoder().encode(blobBody).length

		const signedUrlResponse = await this.getSignedUploadUrl(sessionId, blobType, contentLength)

		const uploadResponse = await fetch(signedUrlResponse.signed_url, {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
			},
			body: blobBody,
		})

		if (!uploadResponse.ok) {
			throw new Error(`uploadBlob failed: upload to signed URL returned ${uploadResponse.status}`)
		}

		return { updated_at: signedUrlResponse.updated_at }
	}

	/**
	 * Get a signed URL for uploading a blob
	 */
	private async getSignedUploadUrl(
		sessionId: string,
		blobType: "api_conversation_history" | "task_metadata" | "ui_messages" | "git_state",
		contentLength: number,
	): Promise<{ signed_url: string; updated_at: string }> {
		const { endpoint, getToken } = this.trpcClient

		const url = new URL("/api/upload-cli-session-blob-v2", endpoint)

		const response = await fetch(url.toString(), {
			method: "POST",
			headers: {
				Authorization: `Bearer ${await getToken()}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				session_id: sessionId,
				blob_type: blobType,
				content_length: contentLength,
			}),
		})

		if (!response.ok) {
			throw new Error(`getSignedUploadUrl failed: ${url.toString()} ${response.status}`)
		}

		const signedUrlResponse = (await response.json()) as { signed_url?: string; updated_at?: string }

		if (!signedUrlResponse.signed_url) {
			throw new Error("getSignedUploadUrl failed: missing signed_url in response")
		}

		if (!signedUrlResponse.updated_at) {
			throw new Error("getSignedUploadUrl failed: missing updated_at in response")
		}

		return {
			signed_url: signedUrlResponse.signed_url,
			updated_at: signedUrlResponse.updated_at,
		}
	}

	async tokenValid() {
		const { endpoint, getToken } = this.trpcClient

		const token = await getToken()

		if (!this.isTokenValidLocally(token)) {
			return false
		}

		const url = new URL("/api/user", endpoint)

		const response = await fetch(url.toString(), {
			method: "GET",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
		})

		return response.ok
	}

	private isTokenValidLocally(token: string): boolean {
		try {
			const parts = token.split(".")

			if (parts.length !== 3) {
				return false
			}

			const payloadBase64 = parts[1]

			if (!payloadBase64) {
				return false
			}

			const payloadJson = Buffer.from(payloadBase64, "base64").toString("utf-8")
			const payload = JSON.parse(payloadJson) as {
				kiloUserId?: string
				version?: number
				exp?: number
			}

			if (typeof payload.kiloUserId !== "string" || payload.kiloUserId.length === 0) {
				return false
			}

			if (typeof payload.version !== "number") {
				return false
			}

			if (typeof payload.exp === "number") {
				const nowInSeconds = Math.floor(Date.now() / 1000)
				if (payload.exp < nowInSeconds) {
					return false
				}
			}

			return true
		} catch {
			return false
		}
	}
}
