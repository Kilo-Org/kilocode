import type * as vscode from "vscode"
import type { ClineMessage } from "@roo-code/types"
import { SessionManager } from "../../../shared/kilocode/cli-sessions/core/SessionManager"
import { fetchSignedBlob } from "../../../shared/kilocode/cli-sessions/utils/fetchBlobFromSignedUrl"
import type { RemoteSession } from "./types"

const REMOTE_SESSIONS_FETCH_LIMIT = 50

export interface RemoteSessionServiceOptions {
	outputChannel: vscode.OutputChannel
}

export class RemoteSessionService {
	private outputChannel: vscode.OutputChannel

	constructor(options: RemoteSessionServiceOptions) {
		this.outputChannel = options.outputChannel
	}

	async fetchRemoteSessions(): Promise<RemoteSession[]> {
		const sessionClient = this.getSessionClient()
		if (!sessionClient) {
			return []
		}

		const response = await sessionClient.list({ limit: REMOTE_SESSIONS_FETCH_LIMIT })
		const remoteSessions: RemoteSession[] = response.cliSessions

		this.log(`Fetched ${remoteSessions.length} remote sessions`)

		return remoteSessions
	}

	async fetchSessionMessages(sessionId: string): Promise<ClineMessage[] | null> {
		const blobUrl = await this.getSessionMessageBlobUrl(sessionId)
		if (!blobUrl) {
			return null
		}

		return this.fetchMessagesFromBlobUrl(blobUrl)
	}

	private async getSessionMessageBlobUrl(sessionId: string): Promise<string | null> {
		const sessionClient = this.getSessionClient()
		if (!sessionClient) {
			return null
		}

		this.log(`Fetching messages for session: ${sessionId}`)

		const session = await sessionClient.get({
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

	private getSessionClient() {
		const sessionClient = SessionManager.init()?.sessionClient
		if (!sessionClient) {
			this.log("SessionClient not available")
			return null
		}
		return sessionClient
	}

	private log(message: string): void {
		this.outputChannel.appendLine(`[AgentManager] ${message}`)
	}
}
