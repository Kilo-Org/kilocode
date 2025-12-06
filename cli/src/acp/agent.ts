/**
 * ACP Agent implementation for Kilo Code.
 *
 * This module implements the ACP Agent interface, bridging incoming ACP requests
 * to the existing CLI ExtensionService/ExtensionHost architecture.
 */

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
		return {
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
	}

	/**
	 * Create a new session.
	 */
	async newSession(_params: NewSessionRequest): Promise<NewSessionResponse> {
		const sessionId = `kilo-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`

		const session: ACPSessionState = {
			id: sessionId,
			cancelled: false,
		}

		// Initialize extension service for this session
		const extensionService = await this.createExtensionService(this.workspace)
		session.extensionService = extensionService

		// Listen for messages from the extension
		this.setupExtensionMessageHandler(session, extensionService)

		this.sessions.set(sessionId, session)

		return {
			sessionId,
		}
	}

	/**
	 * Process a prompt request.
	 */
	async prompt(params: PromptRequest): Promise<PromptResponse> {
		const session = this.sessions.get(params.sessionId)
		if (!session) {
			throw new Error(`Session not found: ${params.sessionId}`)
		}

		if (!session.extensionService) {
			throw new Error(`Session not initialized: ${params.sessionId}`)
		}

		// Extract prompt text from the prompt content blocks
		const promptText = params.prompt
			.filter((block): block is ContentBlock & { type: "text"; text: string } => block.type === "text")
			.map((block) => block.text)
			.join("\n")

		// Create a promise that will resolve when the task completes
		const taskComplete = new Promise<void>((resolve, reject) => {
			session.taskCompletionPromise = { resolve, reject }
		})

		// Send the prompt to the extension as a new task
		await session.extensionService.sendWebviewMessage({
			type: "newTask",
			text: promptText,
		})

		// Wait for task completion
		await taskComplete

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
		extensionService.on("message", async (message: ExtensionMessage) => {
			// Cast to chat message type for proper typing
			const chatMessage = message as { type: string; text?: string; say?: string; ask?: ClineAsk }

			// Handle streamed text output
			if (chatMessage.say === "text" && chatMessage.text) {
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
			}

			// Handle tool calls that need approval
			if (chatMessage.type === "ask" && chatMessage.ask) {
				const approved = await this.handleToolApproval(session, chatMessage.ask, chatMessage.text)

				// Send response back
				const response: ClineAskResponse = approved ? "yesButtonClicked" : "noButtonClicked"
				await extensionService.sendWebviewMessage({
					type: "askResponse",
					askResponse: response,
				})
			}

			// Handle task completion
			if (chatMessage.say === "completion_result" || chatMessage.say === "error") {
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
