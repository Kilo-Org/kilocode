/**
 * Session export/import functionality
 * Allows exporting sessions to JSON files and importing them back
 */

import { writeFileSync, readFileSync, existsSync } from "fs"
import { resolve } from "path"
import { SessionClient } from "../../../src/shared/kilocode/cli-sessions/core/SessionClient.js"
import { TrpcClient } from "../../../src/shared/kilocode/cli-sessions/core/TrpcClient.js"
import { loadConfig, getKiloToken } from "../config/persistence.js"
import { applyEnvOverrides } from "../config/env-config.js"

export interface ExportedSession {
	version: number
	exportedAt: string
	session: {
		id: string
		title: string
		createdAt: string
		updatedAt: string
		gitUrl: string | null
		mode: string | null
		model: string | null
	}
	data: {
		apiConversationHistory: unknown[] | null
		uiMessages: unknown[] | null
		taskMetadata: unknown | null
		gitState: unknown | null
	}
}

const EXPORT_VERSION = 1

/**
 * Create a lightweight session client for export operations
 */
async function createSessionClient(): Promise<SessionClient> {
	const { config } = await loadConfig()
	const finalConfig = applyEnvOverrides(config)
	const token = getKiloToken(finalConfig)

	if (!token) {
		throw new Error("No Kilo Code token found. Run 'kilocode config' to set your token.")
	}

	const trpcClient = new TrpcClient({
		getToken: () => Promise.resolve(token),
	})

	return new SessionClient(trpcClient)
}

/**
 * Export a session to JSON format
 */
export async function exportSession(sessionId: string): Promise<ExportedSession> {
	if (!sessionId) {
		throw new Error("Session ID is required")
	}

	const sessionClient = await createSessionClient()

	// Get session with blob URLs
	const session = await sessionClient.get({
		session_id: sessionId,
		include_blob_urls: true,
	})

	if (!session) {
		throw new Error(`Session not found: ${sessionId}`)
	}

	// Fetch blob data if available
	let apiConversationHistory: unknown[] | null = null
	let uiMessages: unknown[] | null = null
	let taskMetadata: unknown | null = null
	let gitState: unknown | null = null
	const warnings: string[] = []

	const sessionWithUrls = session as {
		api_conversation_history_blob_url?: string | null
		ui_messages_blob_url?: string | null
		task_metadata_blob_url?: string | null
		git_state_blob_url?: string | null
	}

	if (sessionWithUrls.api_conversation_history_blob_url) {
		try {
			const response = await fetch(sessionWithUrls.api_conversation_history_blob_url)
			if (response.ok) {
				apiConversationHistory = await response.json()
			} else {
				warnings.push(`Failed to fetch API conversation history: ${response.status} ${response.statusText}`)
			}
		} catch (error) {
			warnings.push(
				`Failed to fetch API conversation history: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	if (sessionWithUrls.ui_messages_blob_url) {
		try {
			const response = await fetch(sessionWithUrls.ui_messages_blob_url)
			if (response.ok) {
				uiMessages = await response.json()
			} else {
				warnings.push(`Failed to fetch UI messages: ${response.status} ${response.statusText}`)
			}
		} catch (error) {
			warnings.push(`Failed to fetch UI messages: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	if (sessionWithUrls.task_metadata_blob_url) {
		try {
			const response = await fetch(sessionWithUrls.task_metadata_blob_url)
			if (response.ok) {
				taskMetadata = await response.json()
			} else {
				warnings.push(`Failed to fetch task metadata: ${response.status} ${response.statusText}`)
			}
		} catch (error) {
			warnings.push(`Failed to fetch task metadata: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	if (sessionWithUrls.git_state_blob_url) {
		try {
			const response = await fetch(sessionWithUrls.git_state_blob_url)
			if (response.ok) {
				gitState = await response.json()
			} else {
				warnings.push(`Failed to fetch git state: ${response.status} ${response.statusText}`)
			}
		} catch (error) {
			warnings.push(`Failed to fetch git state: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	// Report warnings to stderr
	for (const warning of warnings) {
		console.error(`⚠️  Warning: ${warning}`)
	}

	return {
		version: EXPORT_VERSION,
		exportedAt: new Date().toISOString(),
		session: {
			id: session.session_id,
			title: session.title,
			createdAt: session.created_at,
			updatedAt: session.updated_at,
			gitUrl: session.git_url,
			mode: session.last_mode,
			model: session.last_model,
		},
		data: {
			apiConversationHistory,
			uiMessages,
			taskMetadata,
			gitState,
		},
	}
}

/**
 * Export session to a file
 */
export async function exportSessionToFile(sessionId: string, outputPath?: string): Promise<string> {
	const exported = await exportSession(sessionId)

	const filename = outputPath || `kilocode-session-${exported.session.id}.json`
	const fullPath = resolve(filename)

	writeFileSync(fullPath, JSON.stringify(exported, null, 2))

	return fullPath
}

/**
 * Read and validate an exported session file
 */
export function readExportedSession(filePath: string): ExportedSession {
	const fullPath = resolve(filePath)

	if (!existsSync(fullPath)) {
		throw new Error(`File not found: ${fullPath}`)
	}

	const content = readFileSync(fullPath, "utf-8")
	const data = JSON.parse(content) as ExportedSession

	// Validate structure
	if (!data.version || !data.session || !data.data) {
		throw new Error("Invalid session export format")
	}

	if (data.version > EXPORT_VERSION) {
		throw new Error(`Unsupported export version: ${data.version}. Please update kilocode CLI.`)
	}

	return data
}

/**
 * Import a session from exported data (preview only - shows what would be imported)
 * Note: Full import requires cloud API support which may not be available
 */
export function previewImport(exported: ExportedSession): string {
	const { session, data } = exported

	const lines = [
		`Session: ${session.title || "Untitled"}`,
		`Original ID: ${session.id}`,
		`Created: ${new Date(session.createdAt).toLocaleString()}`,
		`Mode: ${session.mode || "N/A"}`,
		`Model: ${session.model || "N/A"}`,
		``,
		`Data:`,
		`  - API History: ${data.apiConversationHistory?.length || 0} messages`,
		`  - UI Messages: ${data.uiMessages?.length || 0} messages`,
		`  - Task Metadata: ${data.taskMetadata ? "Yes" : "No"}`,
		`  - Git State: ${data.gitState ? "Yes" : "No"}`,
	]

	return lines.join("\n")
}
