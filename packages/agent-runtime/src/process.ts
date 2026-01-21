/**
 * Agent Process Entry Point
 *
 * This file is designed to be forked by the Agent Manager to run agents
 * in separate processes. Each agent process is fully isolated with its own:
 * - Configuration
 * - State
 * - Extension instance
 * - No shared memory with other agents
 *
 * Configuration is passed via AGENT_CONFIG environment variable as JSON.
 *
 * IPC Communication:
 * - Parent sends: { type: 'sendMessage', payload: WebviewMessage }
 * - Parent sends: { type: 'shutdown' }
 * - Child sends: { type: 'ready' }
 * - Child sends: { type: 'message', payload: ExtensionMessage }
 * - Child sends: { type: 'stateChange', state: ExtensionState }
 * - Child sends: { type: 'error', error: { message: string, stack?: string } }
 *
 * @example
 * ```typescript
 * import { fork } from "child_process"
 *
 * const agentProcess = fork(
 *   require.resolve("@kilocode/agent-runtime/process"),
 *   [],
 *   {
 *     env: {
 *       AGENT_CONFIG: JSON.stringify({
 *         workspace: "/path/to/workspace",
 *         providerSettings: { apiProvider: "anthropic", apiKey: "..." },
 *         mode: "code",
 *         autoApprove: false,
 *       }),
 *     },
 *     stdio: ["pipe", "pipe", "pipe", "ipc"]
 *   }
 * )
 *
 * agentProcess.on("message", (msg) => {
 *   if (msg.type === "ready") {
 *     agentProcess.send({ type: "sendMessage", payload: { type: "newTask", text: "Hello" } })
 *   }
 * })
 * ```
 */

import { createExtensionService, type ExtensionService } from "./services/extension.js"
import { logs, setLogger, createIPCLogger } from "./utils/logger.js"
import type { ExtensionMessage, WebviewMessage, ExtensionState, ModeConfig, ProviderSettings } from "./types/index.js"

/**
 * Agent configuration passed via AGENT_CONFIG environment variable
 */
interface AgentConfig {
	// Workspace
	workspace: string

	// Provider settings (passed in, not read from files)
	providerSettings: ProviderSettings

	// Mode configuration
	mode?: string
	customModes?: ModeConfig[]

	// Behavior
	autoApprove?: boolean // replaces --yolo

	// Session management
	sessionId?: string // for resuming sessions

	// Identity (for telemetry)
	identity?: {
		machineId: string
		sessionId: string
		cliUserId?: string
	}

	// Extension paths (optional, defaults to auto-resolve)
	extensionBundlePath?: string
	extensionRootPath?: string

	// VS Code app root path (for finding bundled binaries like ripgrep)
	vscodeAppRoot?: string

	// Custom system prompt text
	appendSystemPrompt?: string

	// App name for API identification (e.g., 'wrapper|agent-manager|cli|1.0.0')
	appName?: string

	// Resume data for pre-seeding task history before extension activation
	// This ensures the extension can find the task when showTaskWithId is called
	resumeData?: {
		sessionId: string
		prompt: string
		images?: string[]
		uiMessages: unknown[]
		apiConversationHistory: unknown[]
		metadata: {
			sessionId: string
			title: string
			createdAt: string
			mode: string | null
		}
	}
}

/**
 * Session metadata for constructing a HistoryItem
 */
interface SessionMetadata {
	sessionId: string
	title: string
	createdAt: string
	mode: string | null
}

/**
 * Session data for resuming a session with history
 */
interface ResumeSessionData {
	sessionId: string
	prompt: string
	images?: string[]
	uiMessages: unknown[] // ClineMessage[]
	apiConversationHistory: unknown[] // Anthropic.MessageParam[]
	metadata: SessionMetadata
}

/**
 * IPC message types from parent
 */
interface ParentMessage {
	type: "sendMessage" | "shutdown" | "injectConfig" | "resumeWithHistory"
	payload?: WebviewMessage | Partial<ExtensionState> | ResumeSessionData
}

/**
 * IPC message types to parent
 */
interface ChildMessage {
	type: "ready" | "message" | "stateChange" | "error" | "warning"
	payload?: ExtensionMessage
	state?: ExtensionState
	error?: { message: string; stack?: string; context?: string }
}

/**
 * Summarize message payload for logging
 */
function summarizeMessage(message: ChildMessage): string {
	if (message.type === "message" && message.payload) {
		const p = message.payload as {
			type?: string
			state?: { clineMessages?: Array<{ type?: string; say?: string; ask?: string; text?: string }> }
		}
		if (p.type === "state" && p.state?.clineMessages) {
			const msgs = p.state.clineMessages
			const lastMsg = msgs[msgs.length - 1]
			const lastMsgType = lastMsg ? `${lastMsg.type}:${lastMsg.say || lastMsg.ask || "?"}` : ""
			const lastMsgText = lastMsg?.text?.slice(0, 30) || ""
			return `(state: ${msgs.length} msgs, last=${lastMsgType} "${lastMsgText}")`
		}
		return `(${p.type || "unknown"})`
	}
	if (message.type === "stateChange" && message.state) {
		const s = message.state as { clineMessages?: Array<{ type?: string; say?: string; ask?: string; text?: string }> }
		if (s.clineMessages) {
			const msgs = s.clineMessages
			const lastMsg = msgs[msgs.length - 1]
			const lastMsgType = lastMsg ? `${lastMsg.type}:${lastMsg.say || lastMsg.ask || "?"}` : ""
			const lastMsgText = lastMsg?.text?.slice(0, 30) || ""
			return `(${msgs.length} msgs, last=${lastMsgType} "${lastMsgText}")`
		}
	}
	if (message.type === "error" && message.error) {
		return `(${message.error.message?.slice(0, 50)})`
	}
	return ""
}

/**
 * Send message to parent process
 */
function sendToParent(message: ChildMessage): void {
	if (process.send) {
		// Log outgoing message to parent (except verbose ones)
		if (message.type !== "stateChange" || !message.state) {
			logs.debug(`[IPC→Parent] ${message.type} ${summarizeMessage(message)}`, "AgentProcess")
		}
		process.send(message)
	} else {
		// Not running as a child process - use standard logger
		logs.debug("IPC message (no parent)", "AgentProcess", { message })
	}
}

/**
 * Main agent process function
 */
async function main(): Promise<void> {
	// Set up IPC logger
	if (process.send) {
		setLogger(createIPCLogger())
	}

	// Parse configuration from environment
	const configJson = process.env.AGENT_CONFIG
	if (!configJson) {
		sendToParent({
			type: "error",
			error: { message: "AGENT_CONFIG environment variable is required" },
		})
		process.exit(1)
	}

	let config: AgentConfig
	try {
		config = JSON.parse(configJson)
	} catch (error) {
		sendToParent({
			type: "error",
			error: { message: `Failed to parse AGENT_CONFIG: ${error}` },
		})
		process.exit(1)
	}

	// Validate required fields
	if (!config.workspace) {
		sendToParent({
			type: "error",
			error: { message: "workspace is required in AGENT_CONFIG" },
		})
		process.exit(1)
	}

	if (!config.providerSettings) {
		sendToParent({
			type: "error",
			error: { message: "providerSettings is required in AGENT_CONFIG" },
		})
		process.exit(1)
	}

	logs.info("Starting agent process", "AgentProcess", { workspace: config.workspace })

	let agent: ExtensionService | null = null

	try {
		// Create extension service with configuration
		// Pass providerSettings at creation time to avoid race conditions
		agent = createExtensionService({
			workspace: config.workspace,
			mode: config.mode,
			customModes: config.customModes,
			identity: config.identity,
			extensionBundlePath: config.extensionBundlePath,
			extensionRootPath: config.extensionRootPath,
			vscodeAppRoot: config.vscodeAppRoot,
			appendSystemPrompt: config.appendSystemPrompt,
			appName: config.appName,
			providerSettings: config.providerSettings,
		})

		// Set up event handlers
		agent.on("ready", async () => {
			logs.info("Agent extension ready", "AgentProcess")

			// Inject provider configuration
			try {
				const extensionHost = agent!.getExtensionHost()
				const stateConfig: Partial<ExtensionState> = {
					apiConfiguration: config.providerSettings,
					currentApiConfigName: "default",
					mode: config.mode || "code",
				}

				// Handle auto-approve settings
				// TODO: Once approval UI is implemented in Agent Manager, remove the blanket
				// auto-approve and instead forward approval requests to the parent process
				// via IPC, allowing the user to approve/deny individual operations.
				if (config.autoApprove) {
					stateConfig.autoApprovalEnabled = true
					stateConfig.alwaysAllowReadOnly = true
					stateConfig.alwaysAllowReadOnlyOutsideWorkspace = true
					stateConfig.alwaysAllowWrite = true
					stateConfig.alwaysAllowWriteOutsideWorkspace = true
					stateConfig.alwaysAllowExecute = true
					stateConfig.allowedCommands = ["*"] // Wildcard to allow all commands
					stateConfig.alwaysAllowBrowser = true
					stateConfig.alwaysAllowMcp = true
					stateConfig.alwaysAllowModeSwitch = true
					stateConfig.alwaysAllowSubtasks = true
				}

				await extensionHost.injectConfiguration(stateConfig)
				logs.info("Configuration injected", "AgentProcess")
			} catch (error) {
				logs.error("Failed to inject configuration", "AgentProcess", { error })
			}

			// If this is a resume, load the task (but don't send askResponse yet)
			// The askResponse will be sent by the parent process after it sees
			// the extension is in ask:resume_task or ask:resume_completed_task state
			if (config.resumeData) {
				try {
					logs.info("Resuming session after activation", "AgentProcess", {
						sessionId: config.resumeData.sessionId,
						uiMessagesCount: config.resumeData.uiMessages?.length,
						apiHistoryCount: config.resumeData.apiConversationHistory?.length,
						prompt: config.resumeData.prompt?.slice(0, 50),
					})

					// Load the task using showTaskWithId (history was pre-seeded during activation)
					// This triggers resumeTaskFromHistory() which ends with await this.ask(askType)
					logs.debug(`[Ext→] showTaskWithId(${config.resumeData.sessionId})`, "AgentProcess")
					await agent!.sendWebviewMessage({
						type: "showTaskWithId",
						text: config.resumeData.sessionId,
					})
					logs.debug(`[Ext←] showTaskWithId completed`, "AgentProcess")

					// NOTE: We do NOT send askResponse here because the extension's
					// resumeTaskFromHistory() is async and calls await this.ask() which
					// waits for user input. If we send askResponse before ask() is waiting,
					// the response gets lost. The parent process will send askResponse
					// when it sees ask:resume_task or ask:resume_completed_task in the state.
					logs.info("Task loaded, waiting for extension to reach ask state", "AgentProcess")
				} catch (error) {
					logs.error("Failed to resume session", "AgentProcess", { error })
					sendToParent({
						type: "error",
						error: {
							message: error instanceof Error ? error.message : String(error),
							stack: error instanceof Error ? error.stack : undefined,
						},
					})
				}
			}

			logs.debug("[IPC→Parent] ready", "AgentProcess")
			sendToParent({ type: "ready" })
		})

		agent.on("message", (message: ExtensionMessage) => {
			sendToParent({ type: "message", payload: message })
		})

		agent.on("stateChange", (state: ExtensionState) => {
			sendToParent({ type: "stateChange", state })
		})

		agent.on("error", (error: Error) => {
			sendToParent({
				type: "error",
				error: { message: error.message, stack: error.stack },
			})
		})

		agent.on("warning", (warning: { context: string; error: Error }) => {
			sendToParent({
				type: "warning",
				error: {
					message: warning.error.message,
					stack: warning.error.stack,
					context: warning.context,
				},
			})
		})

		// Initialize the agent (with optional resume data for pre-seeding)
		await agent.initialize(config.resumeData)

		// Set up message handler from parent
		process.on("message", async (msg: ParentMessage) => {
			// Log incoming message from parent
			const payloadType = (msg.payload as { type?: string } | undefined)?.type || ""
			const payloadText = (msg.payload as { text?: string } | undefined)?.text?.slice(0, 50) || ""
			logs.debug(
				`[IPC←Parent] ${msg.type}${payloadType ? `(${payloadType})` : ""} ${payloadText ? `"${payloadText}..."` : ""}`,
				"AgentProcess",
			)

			try {
				switch (msg.type) {
					case "sendMessage":
						if (msg.payload && agent) {
							logs.debug(`[Ext→] sendWebviewMessage(${payloadType})`, "AgentProcess")
							await agent.sendWebviewMessage(msg.payload as WebviewMessage)
						}
						break

					case "injectConfig":
						if (msg.payload && agent) {
							const extensionHost = agent.getExtensionHost()
							await extensionHost.injectConfiguration(msg.payload as Partial<ExtensionState>)
						}
						break

					case "resumeWithHistory":
						if (msg.payload && agent) {
							const resumeData = msg.payload as ResumeSessionData
							logs.info("Resuming session with history", "AgentProcess", {
								sessionId: resumeData.sessionId,
								uiMessagesCount: resumeData.uiMessages.length,
								apiHistoryCount: resumeData.apiConversationHistory.length,
							})

							try {
								const extensionHost = agent.getExtensionHost()

								// 1. Add HistoryItem to taskHistory global state (required for showTaskWithId)
								await extensionHost.addHistoryItemForResume(
									resumeData.sessionId,
									resumeData.metadata.title,
									new Date(resumeData.metadata.createdAt).getTime(),
									resumeData.metadata.mode || "code",
								)

								// 2. Write session data to local task directory so showTaskWithId can load it
								await extensionHost.writeTaskHistory(
									resumeData.sessionId,
									resumeData.uiMessages,
									resumeData.apiConversationHistory,
								)

								// 3. Load the task using showTaskWithId
								// This is awaited, so the task is fully loaded when it completes
								await agent.sendWebviewMessage({
									type: "showTaskWithId",
									text: resumeData.sessionId,
								})

								// 4. Send the continuation message to resume the conversation
								// The task is now loaded and ready to accept user input
								await agent.sendWebviewMessage({
									type: "askResponse",
									askResponse: "messageResponse",
									text: resumeData.prompt,
									images: resumeData.images,
								})
							} catch (error) {
								logs.error("Failed to resume session with history", "AgentProcess", { error })
								sendToParent({
									type: "error",
									error: {
										message: error instanceof Error ? error.message : String(error),
										stack: error instanceof Error ? error.stack : undefined,
									},
								})
							}
						}
						break

					case "shutdown":
						logs.info("Received shutdown signal", "AgentProcess")
						if (agent) {
							await agent.dispose()
						}
						process.exit(0)
						break

					default:
						logs.warn(`Unknown message type: ${msg.type}`, "AgentProcess")
				}
			} catch (error) {
				logs.error("Error handling parent message", "AgentProcess", { error })
				sendToParent({
					type: "error",
					error: {
						message: error instanceof Error ? error.message : String(error),
						stack: error instanceof Error ? error.stack : undefined,
					},
				})
			}
		})

		// Handle process termination
		process.on("SIGTERM", async () => {
			logs.info("Received SIGTERM", "AgentProcess")
			if (agent) {
				await agent.dispose()
			}
			process.exit(0)
		})

		process.on("SIGINT", async () => {
			logs.info("Received SIGINT", "AgentProcess")
			if (agent) {
				await agent.dispose()
			}
			process.exit(0)
		})
	} catch (error) {
		logs.error("Failed to start agent", "AgentProcess", { error })
		sendToParent({
			type: "error",
			error: {
				message: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			},
		})
		process.exit(1)
	}
}

// Run main function
main().catch((error) => {
	console.error("Fatal error in agent process:", error)
	process.exit(1)
})
