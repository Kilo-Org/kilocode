/**
 * ACP Agent implementation for Kilo Code.
 *
 * This module implements the ACP Agent interface, bridging incoming ACP requests
 * to the existing CLI ExtensionService/ExtensionHost architecture.
 */

import { acpDebug } from "./index.js"
import type {
	Agent,
	AgentSideConnection,
	InitializeRequest,
	InitializeResponse,
	NewSessionRequest,
	NewSessionResponse,
	PromptRequest,
	PromptResponse,
	CancelNotification,
	AuthenticateRequest,
	AuthenticateResponse,
	SetSessionModeRequest,
	SetSessionModeResponse,
	ToolCallUpdate,
	PermissionOption,
	ToolKind,
	ContentBlock,
} from "@agentclientprotocol/sdk"
import type { ExtensionService } from "../services/extension.js"
import type { ExtensionMessage, ClineAskResponse } from "../types/messages.js"
import type { ClineAsk } from "@roo-code/types"

/**
 * Session state for an ACP session
 */
interface ACPSessionState {
	id: string
	cancelled: boolean
	extensionService?: ExtensionService
	taskCompletionPromise?: {
		resolve: (value: void) => void
		reject: (error: Error) => void
	}
	/** Track which message timestamps we've already sent to avoid duplicates */
	sentMessageTimestamps: Set<number>
	/** Track the last text we sent to avoid sending duplicates */
	lastSentText?: string
	/** Track if we've sent any assistant response (not just thinking indicator) */
	hasReceivedAssistantResponse: boolean
	/** Track if we've sent the thinking indicator */
	sentThinkingIndicator: boolean
}

/**
 * KiloCodeAgent implements the ACP Agent interface.
 *
 * It receives ACP protocol calls (initialize, newSession, prompt, etc.) and
 * translates them into actions on the ExtensionService.
 */
export class KiloCodeAgent implements Agent {
	private connection: AgentSideConnection
	private sessions: Map<string, ACPSessionState> = new Map()
	private createExtensionService: (workspace: string) => Promise<ExtensionService>
	private workspace: string

	constructor(
		connection: AgentSideConnection,
		createExtensionService: (workspace: string) => Promise<ExtensionService>,
		workspace: string,
	) {
		this.connection = connection
		this.createExtensionService = createExtensionService
		this.workspace = workspace
	}

	/**
	 * Initialize the agent connection.
	 */
	async initialize(params: InitializeRequest): Promise<InitializeResponse> {
		acpDebug("initialize() called", { protocolVersion: params.protocolVersion })
		const response = {
			protocolVersion: params.protocolVersion,
			agentInfo: {
				name: "Kilo Code",
				version: "1.0.0",
			},
			agentCapabilities: {
				promptCapabilities: {
					image: false,
					embeddedContext: true,
				},
			},
		}
		acpDebug("initialize() response", response)
		return response
	}

	/**
	 * Create a new session.
	 */
	async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
		acpDebug("newSession() called", { cwd: params.cwd })
		const sessionId = `kilo-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
		acpDebug("Creating session:", sessionId)

		// Use the cwd from the session request, falling back to CLI workspace
		const sessionWorkspace = params.cwd || this.workspace
		acpDebug("Session workspace:", sessionWorkspace)

		const session: ACPSessionState = {
			id: sessionId,
			cancelled: false,
			sentMessageTimestamps: new Set(),
			hasReceivedAssistantResponse: false,
			sentThinkingIndicator: false,
		}

		// Initialize extension service for this session using the session's cwd
		acpDebug("Initializing extension service for session...")
		let extensionService: ExtensionService
		try {
			extensionService = await this.createExtensionService(sessionWorkspace)
			session.extensionService = extensionService
			acpDebug("Extension service ready for session:", sessionId)

			// TEMPORARY: Enable yoloMode to test if this unblocks LLM calls
			// TODO: Remove this and properly handle approvals through ACP
			const extensionHost = extensionService.getExtensionHost()
			extensionHost.sendWebviewMessage({
				type: "yoloMode",
				bool: true,
			})
			acpDebug("yoloMode enabled for testing")
		} catch (error) {
			const err = error as Error
			acpDebug("Failed to create extension service:", err.message, err.stack)
			throw error
		}

		// Listen for messages from the extension
		this.setupExtensionMessageHandler(session, extensionService)

		this.sessions.set(sessionId, session)

		acpDebug("newSession() response:", { sessionId })
		return {
			sessionId,
		}
	}

	/**
	 * Process a prompt request.
	 */
	async prompt(params: PromptRequest): Promise<PromptResponse> {
		acpDebug("prompt() called", { sessionId: params.sessionId, promptBlocks: params.prompt.length })
		const session = this.sessions.get(params.sessionId)
		if (!session) {
			acpDebug("Session not found:", params.sessionId)
			throw new Error(`Session not found: ${params.sessionId}`)
		}

		if (!session.extensionService) {
			acpDebug("Session not initialized:", params.sessionId)
			throw new Error(`Session not initialized: ${params.sessionId}`)
		}

		// Extract prompt text from the prompt content blocks
		const promptText = params.prompt
			.filter(
				(block: ContentBlock): block is ContentBlock & { type: "text"; text: string } => block.type === "text",
			)
			.map((block: ContentBlock & { type: "text"; text: string }) => block.text)
			.join("\n")

		acpDebug("Extracted prompt text:", promptText.substring(0, 200) + (promptText.length > 200 ? "..." : ""))

		// Create a promise that will resolve when the task completes
		const taskComplete = new Promise<void>((resolve, reject) => {
			session.taskCompletionPromise = { resolve, reject }
		})

		// Send the prompt to the extension as a new task
		acpDebug("Sending newTask to extension service...")
		try {
			await session.extensionService.sendWebviewMessage({
				type: "newTask",
				text: promptText,
			})
			acpDebug("newTask sent successfully")
		} catch (error) {
			const err = error as Error
			acpDebug("Failed to send newTask:", err.message, err.stack)
			throw error
		}

		// Wait for task completion
		acpDebug("Waiting for task completion...")
		await taskComplete
		acpDebug("Task completed, cancelled:", session.cancelled)

		return {
			stopReason: session.cancelled ? "cancelled" : "end_turn",
		}
	}

	/**
	 * Cancel a session's current operation.
	 */
	async cancel(params: CancelNotification): Promise<void> {
		const session = this.sessions.get(params.sessionId)
		if (session) {
			session.cancelled = true
			// Resolve the task completion promise to unblock prompt()
			if (session.taskCompletionPromise) {
				session.taskCompletionPromise.resolve()
			}
		}
	}

	/**
	 * Authenticate (no-op for now).
	 */
	async authenticate(_params: AuthenticateRequest): Promise<AuthenticateResponse> {
		return {}
	}

	/**
	 * Set session mode (optional).
	 */
	async setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse> {
		const session = this.sessions.get(params.sessionId)
		if (!session?.extensionService) {
			throw new Error(`Session not found: ${params.sessionId}`)
		}

		// Switch mode via the extension service
		await session.extensionService.sendWebviewMessage({
			type: "mode",
			text: params.modeId,
		})

		return {}
	}

	/**
	 * Set up the message handler for extension messages.
	 */
	private setupExtensionMessageHandler(session: ACPSessionState, extensionService: ExtensionService): void {
		acpDebug("Setting up extension message handler for session:", session.id)
		extensionService.on("message", async (message: ExtensionMessage) => {
			// Log the full message for debugging (more chars for larger states)
			const msgStr = JSON.stringify(message)
			acpDebug("Extension message received (full):", msgStr.substring(0, 2000))

			// Cast to chat message type for proper typing
			const chatMessage = message as {
				type: string
				text?: string
				say?: string
				ask?: ClineAsk
				state?: {
					clineMessages?: Array<{
						ts?: number
						type: string
						say?: string
						text?: string
						partial?: boolean
					}>
				}
			}

			// Handle state messages - extract and stream any NEW assistant content
			if (chatMessage.type === "state" && chatMessage.state?.clineMessages) {
				const messages = chatMessage.state.clineMessages

				// Check if we have an api_req_started - send thinking indicator
				// This keeps the connection alive while the LLM is processing
				const hasApiReqStarted = messages.some((m) => m?.say === "api_req_started")
				const hasApiReqFinished = messages.some((m) => m?.say === "api_req_finished")

				if (hasApiReqStarted && !hasApiReqFinished && !session.sentThinkingIndicator) {
					acpDebug("LLM is processing, sending thinking indicator...")
					session.sentThinkingIndicator = true
					try {
						await this.connection.sessionUpdate({
							sessionId: session.id,
							update: {
								sessionUpdate: "agent_message_chunk",
								content: {
									type: "text",
									text: "Analyzing your request...\n\n",
								},
							},
						})
						acpDebug("Thinking indicator sent")
					} catch (error) {
						const err = error as Error
						acpDebug("Failed to send thinking indicator:", err.message)
					}
				}

				for (let i = 0; i < messages.length; i++) {
					const msg = messages[i]
					if (!msg) continue

					// Look for assistant text responses
					// Assistant text messages have say="text" and come AFTER user messages
					// The first message is always the user's prompt, so we skip index 0
					// Also skip messages that look like API requests or tools
					if (msg.say === "text" && msg.text && msg.ts) {
						// Skip the first message in the conversation (user's initial prompt)
						// User prompts are at the start of the conversation
						if (i === 0) {
							acpDebug("Skipping first message (user prompt):", msg.text.substring(0, 50))
							continue
						}

						// Skip if we've already sent this message
						if (session.sentMessageTimestamps.has(msg.ts)) {
							continue
						}

						// Skip if this is the same text we just sent (duplicate detection)
						if (session.lastSentText === msg.text) {
							continue
						}

						acpDebug(
							"Found NEW assistant text at index",
							i,
							":",
							msg.text.substring(0, 100),
							"partial:",
							msg.partial,
						)
						session.sentMessageTimestamps.add(msg.ts)
						session.lastSentText = msg.text
						session.hasReceivedAssistantResponse = true

						try {
							await this.connection.sessionUpdate({
								sessionId: session.id,
								update: {
									sessionUpdate: "agent_message_chunk",
									content: {
										type: "text",
										text: msg.text,
									},
								},
							})
							acpDebug("Sent assistant text to client")
						} catch (error) {
							const err = error as Error
							acpDebug("Failed to send text from state:", err.message)
						}
					}

					// Also handle tool usage messages for progress feedback
					if (msg.say === "tool" && msg.text && msg.ts && !session.sentMessageTimestamps.has(msg.ts)) {
						acpDebug("Tool usage detected:", msg.text.substring(0, 100))
						session.sentMessageTimestamps.add(msg.ts)

						// Send a brief tool status update
						try {
							await this.connection.sessionUpdate({
								sessionId: session.id,
								update: {
									sessionUpdate: "agent_message_chunk",
									content: {
										type: "text",
										text: `\n[Using tool...]\n`,
									},
								},
							})
						} catch (error) {
							const err = error as Error
							acpDebug("Failed to send tool status:", err.message)
						}
					}
				}
			}

			// Handle streamed text output (direct say messages from extension)
			if (chatMessage.say === "text" && chatMessage.text) {
				// Avoid sending duplicates
				if (session.lastSentText !== chatMessage.text) {
					acpDebug("Sending direct text chunk to client:", chatMessage.text.substring(0, 100))
					session.lastSentText = chatMessage.text
					try {
						await this.connection.sessionUpdate({
							sessionId: session.id,
							update: {
								sessionUpdate: "agent_message_chunk",
								content: {
									type: "text",
									text: chatMessage.text,
								},
							},
						})
						acpDebug("Text chunk sent successfully")
					} catch (error) {
						const err = error as Error
						acpDebug("Failed to send text chunk:", err.message)
					}
				}
			}

			// Handle tool calls that need approval
			if (chatMessage.type === "ask" && chatMessage.ask) {
				acpDebug("Tool approval needed:", chatMessage.ask)
				const approved = await this.handleToolApproval(session, chatMessage.ask, chatMessage.text)
				acpDebug("Tool approval result:", approved)

				// Send response back
				const response: ClineAskResponse = approved ? "yesButtonClicked" : "noButtonClicked"
				await extensionService.sendWebviewMessage({
					type: "askResponse",
					askResponse: response,
				})
			}

			// Handle task completion
			if (chatMessage.say === "completion_result" || chatMessage.say === "error") {
				acpDebug("Task completed with:", chatMessage.say, "text:", chatMessage.text?.substring(0, 100))

				// Send the completion result text to the client before completing
				if (chatMessage.text && session.lastSentText !== chatMessage.text) {
					session.lastSentText = chatMessage.text
					session.hasReceivedAssistantResponse = true
					try {
						await this.connection.sessionUpdate({
							sessionId: session.id,
							update: {
								sessionUpdate: "agent_message_chunk",
								content: {
									type: "text",
									text: chatMessage.text,
								},
							},
						})
						acpDebug("Sent completion result text to client")
					} catch (error) {
						const err = error as Error
						acpDebug("Failed to send completion text:", err.message)
					}
				}

				if (session.taskCompletionPromise) {
					session.taskCompletionPromise.resolve()
				}
			}
		})
	}

	/**
	 * Handle tool approval by requesting permission from the ACP client.
	 */
	private async handleToolApproval(
		session: ACPSessionState,
		askType: ClineAsk,
		description?: string,
	): Promise<boolean> {
		// Map ClineAsk types to appropriate tool kinds
		const toolKindMap: Record<string, ToolKind> = {
			tool: "other",
			command: "execute",
			browser_action: "fetch",
			write_to_file: "edit",
			apply_diff: "edit",
			read_file: "read",
			execute_command: "execute",
		}

		const toolCallId = `tool-${Date.now()}`
		const toolCall: ToolCallUpdate = {
			toolCallId,
			title: description || `Tool: ${askType}`,
			kind: toolKindMap[askType] || "other",
			status: "in_progress",
		}

		const options: PermissionOption[] = [
			{
				optionId: "allow",
				name: "Allow",
				kind: "allow_once",
			},
			{
				optionId: "deny",
				name: "Deny",
				kind: "reject_once",
			},
		]

		try {
			const response = await this.connection.requestPermission({
				sessionId: session.id,
				toolCall,
				options,
			})

			return response.outcome.outcome === "selected" && response.outcome.optionId === "allow"
		} catch {
			return false
		}
	}
}

/**
 * Factory function to create a KiloCodeAgent.
 */
export function createKiloCodeAgent(
	createExtensionService: (workspace: string) => Promise<ExtensionService>,
	workspace: string,
): (conn: AgentSideConnection) => Agent {
	return (conn: AgentSideConnection) => new KiloCodeAgent(conn, createExtensionService, workspace)
}
