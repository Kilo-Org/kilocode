import type * as vscode from "vscode"
import type { ClineMessage } from "@roo-code/types"
import { SessionManager } from "../../../shared/kilocode/cli-sessions/core/SessionManager"
import { fetchSignedBlob } from "../../../shared/kilocode/cli-sessions/utils/fetchBlobFromSignedUrl"
import type { RemoteSession } from "./types"

const REMOTE_SESSIONS_FETCH_LIMIT = 50

export interface RemoteSessionServiceOptions {
	outputChannel: vscode.OutputChannel
}

/**
 * Service for fetching remote session data from the cloud.
 * Uses SessionManager facade methods for all session operations.
 */
export class RemoteSessionService {
	private outputChannel: vscode.OutputChannel

	constructor(options: RemoteSessionServiceOptions) {
		this.outputChannel = options.outputChannel
	}

	/**
	 * Fetches a list of remote sessions from the cloud.
	 * @returns Array of remote sessions, or empty array if SessionManager is not initialized
	 */
	async fetchRemoteSessions(): Promise<RemoteSession[]> {
		const sessionManager = this.getSessionManager()
		if (!sessionManager) {
			return []
		}

		const response = await sessionManager.listSessions({ limit: REMOTE_SESSIONS_FETCH_LIMIT })
		const remoteSessions: RemoteSession[] = response.cliSessions

		this.log(`Fetched ${remoteSessions.length} remote sessions`)

		return remoteSessions
	}

	/**
	 * Fetches messages for a specific session.
	 * @param sessionId - The session ID to fetch messages for
	 * @returns Array of messages, or null if not available
	 */
	async fetchSessionMessages(sessionId: string): Promise<ClineMessage[] | null> {
		const blobUrl = await this.getSessionMessageBlobUrl(sessionId)
		if (!blobUrl) {
			return null
		}

		return this.fetchMessagesFromBlobUrl(blobUrl)
	}

	private async getSessionMessageBlobUrl(sessionId: string): Promise<string | null> {
		const sessionManager = this.getSessionManager()
		if (!sessionManager) {
			return null
		}

		this.log(`Fetching messages for session: ${sessionId}`)

		const session = await sessionManager.getSession({
			session_id: sessionId,
			include_blob_urls: true,
		})

		const blobUrl = (session as { ui_messages_blob_url?: string | null }).ui_messages_blob_url
		if (!blobUrl) {
			this.log(`No messages blob URL for session: ${sessionId}`)
			return null
		}

		return blobUrl
	}

	private async fetchMessagesFromBlobUrl(blobUrl: string): Promise<ClineMessage[]> {
		const messages = (await fetchSignedBlob(blobUrl, "ui_messages_blob_url")) as ClineMessage[]
		return messages.filter((message) => message.say !== "checkpoint_saved")
	}

	private getSessionManager(): SessionManager | null {
		const sessionManager = SessionManager.init()
		if (!sessionManager) {
			this.log("SessionManager not available")
			return null
		}
		return sessionManager
	}

	private log(message: string): void {
		this.outputChannel.appendLine(`[AgentManager] ${message}`)
	}
}
