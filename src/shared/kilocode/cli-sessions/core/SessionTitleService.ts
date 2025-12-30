import type { ClineMessage } from "@roo-code/types"
import { DEFAULT_CONFIG, LOG_SOURCES } from "../config.js"
import type { IExtensionMessenger } from "../types/IExtensionMessenger.js"
import type { ILogger } from "../types/ILogger.js"
import type { SessionClient } from "./SessionClient.js"
import type { SessionStateManager } from "./SessionStateManager.js"

/**
 * Message emitted when a session title has been generated and updated.
 */
export interface SessionTitleGeneratedMessage {
	sessionId: string
	title: string
	timestamp: number
	event: "session_title_generated"
}

/**
 * Dependencies required by SessionTitleService.
 */
export interface SessionTitleServiceDependencies {
	sessionClient: SessionClient
	stateManager: SessionStateManager
	extensionMessenger: IExtensionMessenger
	logger: ILogger
	onSessionTitleGenerated?: (message: SessionTitleGeneratedMessage) => void
}

/**
 * SessionTitleService - Handles session title generation and management.
 *
 * This service is responsible for:
 * - Extracting the first message text from UI messages
 * - Generating session titles using LLM with fallback to truncation
 * - Updating session titles on the server
 *
 * Extracted from SessionManager as part of the refactoring effort to improve
 * maintainability and testability through separation of concerns.
 */
export class SessionTitleService {
	private readonly maxTitleLength: number
	private readonly truncatedTitleLength: number
	private readonly llmTimeoutMs: number

	private readonly sessionClient: SessionClient
	private readonly stateManager: SessionStateManager
	private readonly extensionMessenger: IExtensionMessenger
	private readonly logger: ILogger
	private readonly onSessionTitleGenerated: (message: SessionTitleGeneratedMessage) => void

	/**
	 * Creates a new SessionTitleService instance.
	 *
	 * @param dependencies - Required service dependencies
	 * @param config - Optional configuration overrides for title settings.
	 *                 Defaults to values from DEFAULT_CONFIG.
	 */
	constructor(
		dependencies: SessionTitleServiceDependencies,
		config: {
			maxLength?: number
			truncatedLength?: number
			llmTimeoutMs?: number
		} = {},
	) {
		this.sessionClient = dependencies.sessionClient
		this.stateManager = dependencies.stateManager
		this.extensionMessenger = dependencies.extensionMessenger
		this.logger = dependencies.logger
		this.onSessionTitleGenerated = dependencies.onSessionTitleGenerated ?? (() => {})

		this.maxTitleLength = config.maxLength ?? DEFAULT_CONFIG.title.maxLength
		this.truncatedTitleLength = config.truncatedLength ?? DEFAULT_CONFIG.title.truncatedLength
		this.llmTimeoutMs = config.llmTimeoutMs ?? DEFAULT_CONFIG.title.llmTimeoutMs
	}

	/**
	 * Extracts the text from the first message that contains text.
	 *
	 * @param uiMessages - Array of UI messages to search through
	 * @param truncate - Whether to truncate the text to 140 characters
	 * @returns The first message text, or null if no text is found
	 */
	getFirstMessageText(uiMessages: ClineMessage[], truncate = false): string | null {
		if (uiMessages.length === 0) {
			return null
		}

		const firstMessageWithText = uiMessages.find((msg) => msg.text)

		if (!firstMessageWithText?.text) {
			return null
		}

		let rawText = firstMessageWithText.text.trim()
		rawText = rawText.replace(/\s+/g, " ")

		if (!rawText) {
			return null
		}

		if (truncate && rawText.length > this.maxTitleLength) {
			return rawText.substring(0, this.truncatedTitleLength) + "..."
		}

		return rawText
	}

	/**
	 * Generates a title for a session using LLM summarization.
	 * Falls back to truncation if LLM generation fails.
	 *
	 * @param uiMessages - Array of UI messages to generate title from
	 * @returns The generated title, or null if no text is available
	 */
	async generateTitle(uiMessages: ClineMessage[]): Promise<string | null> {
		const rawText = this.getFirstMessageText(uiMessages)

		if (!rawText) {
			return null
		}

		try {
			const prompt = `Summarize the following user request in 140 characters or less. Be concise and capture the main intent. Do not use quotes or add any prefix like "Summary:" - just provide the summary text directly. Strip out any sensitive information. Your result will be used as the conversation title.

User request:
${rawText}

Summary:`

			const summary = await this.extensionMessenger.requestSingleCompletion(prompt, this.llmTimeoutMs)

			let cleanedSummary = summary.trim()

			// Remove surrounding quotes if present
			cleanedSummary = cleanedSummary.replace(/^["']|["']$/g, "")

			if (cleanedSummary) {
				return cleanedSummary
			}

			throw new Error("Empty summary generated")
		} catch (error) {
			this.logger.warn(
				"Failed to generate title using LLM, falling back to truncation",
				LOG_SOURCES.SESSION_TITLE,
				{
					error: error instanceof Error ? error.message : String(error),
				},
			)

			if (rawText.length > this.maxTitleLength) {
				return rawText.substring(0, this.truncatedTitleLength) + "..."
			}

			return rawText
		}
	}

	/**
	 * Updates the session title on the server.
	 * Also updates the local state manager with the new title and timestamp.
	 *
	 * @param sessionId - The session ID to update
	 * @param title - The new title to set
	 */
	async updateTitle(sessionId: string, title: string): Promise<void> {
		const trimmedTitle = title.trim()
		if (!trimmedTitle) {
			throw new Error("Session title cannot be empty")
		}

		const updateResult = await this.sessionClient.update({
			session_id: sessionId,
			title: trimmedTitle,
		})

		this.stateManager.setTitle(sessionId, trimmedTitle)
		this.stateManager.updateTimestamp(sessionId, updateResult.updated_at)

		this.logger.info("Session title updated successfully", LOG_SOURCES.SESSION_TITLE, {
			sessionId,
			title: trimmedTitle,
		})

		// Emit session_title_generated event
		this.onSessionTitleGenerated({
			sessionId,
			title: trimmedTitle,
			timestamp: Date.now(),
			event: "session_title_generated",
		})
	}

	/**
	 * Generates and updates the session title if one doesn't already exist.
	 * This method handles the full title generation workflow:
	 * 1. Marks the session as having a pending title to prevent duplicate generation
	 * 2. Checks if the session already has a title on the server
	 * 3. Generates a new title using LLM if needed
	 * 4. Falls back to truncated first message if LLM fails
	 *
	 * @param sessionId - The session ID to update
	 * @param uiMessages - Array of UI messages to generate title from
	 */
	async generateAndUpdateTitle(sessionId: string, uiMessages: ClineMessage[]): Promise<void> {
		try {
			// Mark as pending to prevent duplicate generation attempts
			this.stateManager.setTitle(sessionId, "Pending title")

			// Check if session already has a title on the server
			const session = await this.sessionClient.get({ session_id: sessionId })

			if (session.title) {
				this.stateManager.setTitle(sessionId, session.title)

				this.logger.debug("Found existing session title", LOG_SOURCES.SESSION_TITLE, {
					sessionId,
					title: session.title,
				})

				return
			}

			// Generate a new title
			const generatedTitle = await this.generateTitle(uiMessages)

			if (!generatedTitle) {
				throw new Error("Failed to generate session title")
			}

			// Update the session with the generated title
			await this.updateTitle(sessionId, generatedTitle)

			this.logger.debug("Generated and updated session title", LOG_SOURCES.SESSION_TITLE, {
				sessionId,
				generatedTitle,
			})
		} catch (error) {
			this.logger.error("Failed to generate session title", LOG_SOURCES.SESSION_TITLE, {
				sessionId,
				error: error instanceof Error ? error.message : String(error),
			})

			// Fall back to using the first message text as the title
			const localTitle = this.getFirstMessageText(uiMessages, true) || ""

			if (!localTitle) {
				return
			}

			try {
				await this.updateTitle(sessionId, localTitle)
			} catch (updateError) {
				this.logger.error("Failed to update session title using local title", LOG_SOURCES.SESSION_TITLE, {
					sessionId,
					error: updateError instanceof Error ? updateError.message : String(updateError),
				})
			}
		}
	}
}
