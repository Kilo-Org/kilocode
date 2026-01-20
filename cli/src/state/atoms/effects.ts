/**
 * Effect atoms for message handling and service initialization
 * These atoms handle side effects like processing messages and initializing the service
 */

import { atom } from "jotai"
import type { ExtensionMessage, ExtensionChatMessage, RouterModels } from "../../types/messages.js"
import type { HistoryItem, CommandExecutionStatus } from "@roo-code/types"
import { extensionServiceAtom, setServiceReadyAtom, setServiceErrorAtom, setIsInitializingAtom } from "./service.js"
import {
	updateExtensionStateAtom,
	updateChatMessageByTsAtom,
	updateRouterModelsAtom,
	chatMessagesAtom,
	updateChatMessagesAtom,
	taskResumedViaContinueOrSessionAtom,
} from "./extension.js"
import { ciCompletionDetectedAtom, ciCompletionIgnoreBeforeTimestampAtom } from "./ci.js"
import {
	updateProfileDataAtom,
	updateBalanceDataAtom,
	setProfileLoadingAtom,
	setBalanceLoadingAtom,
	setProfileErrorAtom,
	setBalanceErrorAtom,
	type ProfileData,
	type BalanceData,
} from "./profile.js"
import {
	taskHistoryDataAtom,
	taskHistoryLoadingAtom,
	taskHistoryErrorAtom,
	resolveTaskHistoryRequestAtom,
} from "./taskHistory.js"
import { validateModelOnRouterModelsUpdateAtom } from "./modelValidation.js"
import { validateModeOnCustomModesUpdateAtom } from "./modeValidation.js"
import { logs } from "../../services/logs.js"
import { SessionManager } from "../../../../src/shared/kilocode/cli-sessions/core/SessionManager.js"

/**
 * Message buffer to handle race conditions during initialization
 * Messages received before state is ready are buffered and processed later
 */
const messageBufferAtom = atom<ExtensionMessage[]>([])

/**
 * Flag to track if we're currently processing buffered messages
 */
const isProcessingBufferAtom = atom<boolean>(false)

/**
 * Map to store pending output updates for command_output asks
 * Key: executionId, Value: latest output data
 * Exported so extension.ts can apply pending updates when asks appear
 */
export const pendingOutputUpdatesAtom = atom<Map<string, { output: string; command?: string; completed?: boolean }>>(
	new Map<string, { output: string; command?: string; completed?: boolean }>(),
)

/**
 * Map to track which commands have shown a command_output ask
 * Key: executionId, Value: true if ask was shown
 * Exported for testing
 */
export const commandOutputAskShownAtom = atom<Map<string, boolean>>(new Map<string, boolean>())

// Indexing status types
export interface IndexingStatus {
	systemStatus: string
	message?: string
	processedItems: number
	totalItems: number
	currentItemUnit?: string
	workspacePath?: string
	gitBranch?: string // Current git branch being indexed
	manifest?: {
		totalFiles: number
		totalChunks: number
		lastUpdated: string
	}
}

/**
 * Effect atom to initialize the ExtensionService
 * This sets up event listeners and activates the service
 */
export const initializeServiceEffectAtom = atom(null, async (get, set, store?: { set: typeof set }) => {
	const service = get(extensionServiceAtom)

	if (!service) {
		const error = new Error("ExtensionService not available for initialization")
		set(setServiceErrorAtom, error)
		throw error
	}

	// Get the store reference - if not passed, we can't update atoms from event listeners
	const atomStore = store || (get as { store?: { set: typeof set } }).store
	if (!atomStore) {
		logs.error("No store available for event listeners", "effects")
	}

	try {
		set(setIsInitializingAtom, true)
		logs.info("Initializing ExtensionService...", "effects")

		// Set up event listeners before initialization
		// IMPORTANT: Use atomStore.set() instead of set() for async event handlers
		service.on("ready", (api) => {
			logs.info("Extension ready", "effects")
			if (atomStore) {
				atomStore.set(setServiceReadyAtom, true)

				// Get initial state
				const state = api.getState()
				if (state) {
					atomStore.set(updateExtensionStateAtom, state)
				}

				// Process any buffered messages
				atomStore.set(processMessageBufferAtom)
			}
		})

		service.on("stateChange", (state) => {
			if (atomStore) {
				atomStore.set(updateExtensionStateAtom, state)
				// Trigger mode validation after state update (which includes customModes)
				void atomStore.set(validateModeOnCustomModesUpdateAtom)
			}
		})

		service.on("message", (message) => {
			if (atomStore) {
				atomStore.set(messageHandlerEffectAtom, message)
			}
		})

		service.on("error", (error) => {
			logs.error("Extension service error", "effects", { error })
			if (atomStore) {
				atomStore.set(setServiceErrorAtom, error)
			}
		})

		service.on("disposed", () => {
			logs.info("Extension service disposed", "effects")
			if (atomStore) {
				atomStore.set(setServiceReadyAtom, false)
			}
		})

		// Initialize the service
		await service.initialize()

		logs.info("ExtensionService initialized successfully", "effects")
	} catch (error) {
		logs.error("Failed to initialize ExtensionService", "effects", { error })
		const err = error instanceof Error ? error : new Error(String(error))
		set(setServiceErrorAtom, err)
		set(setIsInitializingAtom, false)
		throw err
	}
})

/**
 * Effect atom to handle incoming extension messages
 * This processes messages and updates state accordingly
 */
export const messageHandlerEffectAtom = atom(null, (get, set, message: ExtensionMessage) => {
	try {
		// Check if service is ready
		const service = get(extensionServiceAtom)
		if (!service) {
			logs.warn("Message received but service not available, buffering", "effects")
			const buffer = get(messageBufferAtom)
			set(messageBufferAtom, [...buffer, message])
			return
		}

		// NOTE: Copied from ClineProvider - make sure the two match.
		if (message.type === "apiMessagesSaved" && message.payload) {
			const [taskId, filePath] = message.payload as [string, string]

			SessionManager.init()?.handleFileUpdate(taskId, "apiConversationHistoryPath", filePath)
		} else if (message.type === "taskMessagesSaved" && message.payload) {
			const [taskId, filePath] = message.payload as [string, string]

			SessionManager.init()?.handleFileUpdate(taskId, "uiMessagesPath", filePath)
		} else if (message.type === "taskMetadataSaved" && message.payload) {
			const [taskId, filePath] = message.payload as [string, string]

			SessionManager.init()?.handleFileUpdate(taskId, "taskMetadataPath", filePath)
		} else if (message.type === "currentCheckpointUpdated") {
			SessionManager.init()?.doSync()
		}

		// Handle different message types
		switch (message.type) {
			case "state":
				// State messages are handled by the stateChange event listener
				// Skip processing here to avoid duplication

				// Track command_output asks that appear in state updates
				// Also filter out duplicate asks that conflict with our synthetic ones
				if (message.state?.chatMessages) {
					const askShownMap = get(commandOutputAskShownAtom)
					const newAskShownMap = new Map(askShownMap)
					const filteredMessages: typeof message.state.chatMessages = []

					for (const msg of message.state.chatMessages) {
						if (msg.type === "ask" && msg.ask === "command_output" && msg.text) {
							try {
								const data = JSON.parse(msg.text)
								const executionId = data.executionId

								if (executionId) {
									// Check if we already have a synthetic ask for this execution
									if (askShownMap.has(executionId) && !msg.isAnswered) {
										// Skip this message - we already have a synthetic ask
										continue
									}

									// Track this ask
									newAskShownMap.set(executionId, true)
								}
							} catch {
								// Ignore parse errors
							}
						}

						filteredMessages.push(msg)
					}

					// Update the state with filtered messages
					if (filteredMessages.length !== message.state.chatMessages.length) {
						message.state.chatMessages = filteredMessages
					}

					if (newAskShownMap.size !== askShownMap.size) {
						set(commandOutputAskShownAtom, newAskShownMap)
					}
				}
				break

			case "messageUpdated": {
				const chatMessage = message.chatMessage as ExtensionChatMessage | undefined
				if (chatMessage) {
					// Special handling for command_output asks to prevent conflicts
					if (chatMessage.type === "ask" && chatMessage.ask === "command_output") {
						logs.info(
							`[messageUpdated] Received command_output ask, ts: ${chatMessage.ts}, isAnswered: ${chatMessage.isAnswered}`,
							"effects",
						)

						// Check if we already have a synthetic ask for this execution
						const currentMessages = get(chatMessagesAtom)
						const askShownMap = get(commandOutputAskShownAtom)

						logs.info(
							`[messageUpdated] Current tracking map has ${askShownMap.size} entries, current messages: ${currentMessages.length}`,
							"effects",
						)

						// Try to extract executionId from the incoming message
						let incomingExecutionId: string | undefined
						try {
							if (chatMessage.text) {
								const data = JSON.parse(chatMessage.text)
								incomingExecutionId = data.executionId
								logs.info(`[messageUpdated] Extracted executionId: ${incomingExecutionId}`, "effects")
							}
						} catch (error) {
							logs.warn(`[messageUpdated] Failed to parse command_output ask text: ${error}`, "effects")
						}

						// Check if we already have a synthetic ask for this executionId
						const hasSyntheticAsk = incomingExecutionId && askShownMap.has(incomingExecutionId)

						if (hasSyntheticAsk) {
							// We already have a synthetic ask for this execution
							// The backend is trying to create its own ask, but we should ignore it
							// since our synthetic ask is already handling user interaction
							logs.info(
								`[messageUpdated] IGNORING duplicate command_output ask for executionId: ${incomingExecutionId}`,
								"effects",
							)
							// Don't update the message - keep our synthetic one
							break
						}

						// Track this ask if it has an executionId
						if (incomingExecutionId) {
							logs.info(
								`[messageUpdated] Tracking new command_output ask for executionId: ${incomingExecutionId}`,
								"effects",
							)
							const newAskShownMap = new Map(askShownMap)
							newAskShownMap.set(incomingExecutionId, true)
							set(commandOutputAskShownAtom, newAskShownMap)
						}
					}

					set(updateChatMessageByTsAtom, chatMessage)
				}
				break
			}

			case "routerModels": {
				const routerModels = message.routerModels as RouterModels | undefined
				if (routerModels) {
					set(updateRouterModelsAtom, routerModels)
					// Trigger model validation after router models are updated
					void set(validateModelOnRouterModelsUpdateAtom)
				}
				break
			}

			case "profileDataResponse": {
				set(setProfileLoadingAtom, false)
				const payload = message.payload as { success: boolean; data?: unknown; error?: string } | undefined
				if (payload?.success) {
					set(updateProfileDataAtom, payload.data as ProfileData)
				} else {
					set(setProfileErrorAtom, payload?.error || "Failed to fetch profile")
				}
				break
			}

			case "balanceDataResponse": {
				// Handle balance data response
				set(setBalanceLoadingAtom, false)
				const payload = message.payload as { success: boolean; data?: unknown; error?: string } | undefined
				if (payload?.success) {
					set(updateBalanceDataAtom, payload.data as BalanceData)
				} else {
					set(setBalanceErrorAtom, payload?.error || "Failed to fetch balance")
				}
				break
			}

			case "taskHistoryResponse": {
				// Handle task history response
				set(taskHistoryLoadingAtom, false)
				const payload = message.payload as
					| {
							historyItems?: HistoryItem[]
							pageIndex?: number
							pageCount?: number
							requestId?: string
					  }
					| undefined
				if (payload) {
					const { historyItems, pageIndex, pageCount, requestId } = payload
					const data = {
						historyItems: historyItems || [],
						pageIndex: pageIndex || 0,
						pageCount: pageCount || 1,
					}
					set(taskHistoryDataAtom, data)
					set(taskHistoryErrorAtom, null)

					// Resolve any pending request with this requestId
					if (requestId) {
						set(resolveTaskHistoryRequestAtom, { requestId, data })
					}
				} else {
					set(taskHistoryErrorAtom, "Failed to fetch task history")
					// Reject any pending requests
					const payloadWithRequestId = message.payload as { requestId?: string } | undefined
					if (payloadWithRequestId?.requestId) {
						set(resolveTaskHistoryRequestAtom, {
							requestId: payloadWithRequestId.requestId,
							error: "Failed to fetch task history",
						})
					}
				}
				break
			}

			case "action":
				// Action messages are typically handled by the UI
				break

			case "partialMessage":
				// Partial messages update the current message being streamed
				break

			case "invoke":
				// Invoke messages trigger specific UI actions
				break

			case "indexingStatusUpdate": {
				// this message fires rapidly as the scanner is progressing and we don't have a UI for it in the
				// CLI at this point, so just quietly ignore it. Eventually we can add more CLI info about indexing.
				break
			}

			case "condenseTaskContextResponse": {
				const taskId = message.text
				logs.info(`Context condensation completed for task: ${taskId || "current task"}`, "effects")
				break
			}

			case "commandExecutionStatus": {
				// Handle command execution status messages
				// Store output updates and apply them when the ask appears
				try {
					const statusData = JSON.parse(message.text || "{}") as CommandExecutionStatus
					const pendingUpdates = get(pendingOutputUpdatesAtom)
					const newPendingUpdates = new Map(pendingUpdates)

					if (statusData.status === "started") {
						logs.info(
							`[commandExecutionStatus] Command started: ${statusData.executionId}, command: ${statusData.command}`,
							"effects",
						)

						// Initialize with command info
						// IMPORTANT: Store the command immediately so it's available even if no output is produced
						const command = "command" in statusData ? (statusData.command as string) : undefined
						const updateData: { output: string; command?: string; completed?: boolean } = {
							output: "",
							command: command || "", // Always set command, even if empty
						}
						newPendingUpdates.set(statusData.executionId, updateData)

						// CLI-ONLY WORKAROUND: Immediately create a synthetic command_output ask
						// This allows users to abort the command even before any output is produced
						const syntheticAsk: ExtensionChatMessage = {
							ts: Date.now(),
							type: "ask",
							ask: "command_output",
							text: JSON.stringify({
								executionId: statusData.executionId,
								command: command || "",
								output: "",
							}),
							partial: true, // Mark as partial since command is still running
							isAnswered: false,
						}

						// Add the synthetic message to chat messages
						const currentMessages = get(chatMessagesAtom)
						set(updateChatMessagesAtom, [...currentMessages, syntheticAsk])

						logs.info(
							`[commandExecutionStatus] Created synthetic ask for ${statusData.executionId}, ts: ${syntheticAsk.ts}`,
							"effects",
						)

						// Mark that we've shown an ask for this execution
						const askShownMap = get(commandOutputAskShownAtom)
						const newAskShownMap = new Map(askShownMap)
						newAskShownMap.set(statusData.executionId, true)
						set(commandOutputAskShownAtom, newAskShownMap)

						logs.info(
							`[commandExecutionStatus] Tracking map now has ${newAskShownMap.size} entries`,
							"effects",
						)
					} else if (statusData.status === "output") {
						logs.debug(
							`[commandExecutionStatus] Output received for ${statusData.executionId}, length: ${statusData.output?.length || 0}`,
							"effects",
						)

						// Update with new output
						const existing = newPendingUpdates.get(statusData.executionId) || { output: "" }
						const command = "command" in statusData ? (statusData.command as string) : existing.command
						const updateData: { output: string; command?: string; completed?: boolean } = {
							output: statusData.output || "",
						}
						if (command) {
							updateData.command = command
						}
						if (existing.completed !== undefined) {
							updateData.completed = existing.completed
						}
						newPendingUpdates.set(statusData.executionId, updateData)

						// Update the synthetic ask with the new output
						// Find and update the synthetic message we created
						const currentMessages = get(chatMessagesAtom)
						const messageIndex = currentMessages.findIndex((msg) => {
							if (msg.type === "ask" && msg.ask === "command_output" && msg.text) {
								try {
									const data = JSON.parse(msg.text)
									return data.executionId === statusData.executionId
								} catch {
									return false
								}
							}
							return false
						})

						if (messageIndex !== -1) {
							const updatedAsk: ExtensionChatMessage = {
								...currentMessages[messageIndex]!,
								text: JSON.stringify({
									executionId: statusData.executionId,
									command: command || "",
									output: statusData.output || "",
								}),
								partial: true, // Still running
							}

							const newMessages = [...currentMessages]
							newMessages[messageIndex] = updatedAsk
							set(updateChatMessagesAtom, newMessages)

							logs.debug(
								`[commandExecutionStatus] Updated synthetic ask at index ${messageIndex}`,
								"effects",
							)
						} else {
							logs.warn(
								`[commandExecutionStatus] Could not find synthetic ask for ${statusData.executionId}`,
								"effects",
							)
						}
					} else if (statusData.status === "exited" || statusData.status === "timeout") {
						const exitCodeInfo =
							statusData.status === "exited" && "exitCode" in statusData
								? `, exitCode: ${statusData.exitCode}`
								: ""
						logs.info(
							`[commandExecutionStatus] Command ${statusData.status} for ${statusData.executionId}${exitCodeInfo}`,
							"effects",
						)

						// Mark as completed and ensure command is preserved
						const existing = newPendingUpdates.get(statusData.executionId) || { output: "", command: "" }
						// If command wasn't set yet (shouldn't happen but defensive), try to get it from statusData
						const command =
							existing.command || ("command" in statusData ? (statusData.command as string) : "")
						const finalUpdate = {
							...existing,
							command: command,
							completed: true,
						}
						newPendingUpdates.set(statusData.executionId, finalUpdate)
					}

					set(pendingOutputUpdatesAtom, newPendingUpdates)

					// CLI-ONLY WORKAROUND: Mark synthetic ask as complete when command exits
					if (statusData.status === "exited" || statusData.status === "timeout") {
						// Find and update the synthetic ask to mark it as complete
						const currentMessages = get(chatMessagesAtom)

						logs.info(
							`[commandExecutionStatus] Looking for synthetic ask among ${currentMessages.length} messages`,
							"effects",
						)

						const messageIndex = currentMessages.findIndex((msg) => {
							if (msg.type === "ask" && msg.ask === "command_output" && msg.text) {
								try {
									const data = JSON.parse(msg.text)
									return data.executionId === statusData.executionId
								} catch {
									return false
								}
							}
							return false
						})

						if (messageIndex !== -1) {
							const pendingUpdate = newPendingUpdates.get(statusData.executionId)
							const exitCode =
								statusData.status === "exited" && "exitCode" in statusData
									? statusData.exitCode
									: undefined
							const updatedAsk: ExtensionChatMessage = {
								...currentMessages[messageIndex]!,
								text: JSON.stringify({
									executionId: statusData.executionId,
									command: pendingUpdate?.command || "",
									output: pendingUpdate?.output || "",
									...(exitCode !== undefined && { exitCode }),
								}),
								partial: false, // Command completed
								isAnswered: false, // Still needs user response
							}

							const newMessages = [...currentMessages]
							newMessages[messageIndex] = updatedAsk
							set(updateChatMessagesAtom, newMessages)

							logs.info(
								`[commandExecutionStatus] Marked synthetic ask as complete at index ${messageIndex}`,
								"effects",
							)
						} else {
							logs.warn(
								`[commandExecutionStatus] Could not find synthetic ask to mark complete for ${statusData.executionId}`,
								"effects",
							)
						}
					}
				} catch (error) {
					logs.error("Error handling commandExecutionStatus", "effects", { error })
				}
				break
			}

			default:
				logs.debug(`Unhandled message type: ${message.type}`, "effects")
		}

		// Check for completion_result in chatMessages (for CI mode)
		if (message.state?.chatMessages) {
			const lastMessage = message.state.chatMessages[message.state.chatMessages.length - 1]
			if (lastMessage?.type === "ask" && lastMessage?.ask === "completion_result") {
				const completionIgnoreBeforeTimestamp = get(ciCompletionIgnoreBeforeTimestampAtom)
				const taskResumedViaSession = get(taskResumedViaContinueOrSessionAtom)
				const isHistoricalCompletion =
					lastMessage.ts !== undefined && lastMessage.ts <= completionIgnoreBeforeTimestamp

				// Skip completion detection if session was just restored via --session or --continue
				// The historical completion_result from the previous task should not trigger CI exit
				if (taskResumedViaSession || isHistoricalCompletion) {
					logs.debug("Skipping completion_result detection - historical completion_result", "effects")
				} else {
					logs.info("Completion result detected in state update", "effects")

					set(ciCompletionDetectedAtom, true)

					SessionManager.init()?.doSync(true)
				}
			}
		}
	} catch (error) {
		logs.error("Error handling extension message", "effects", { error, message })
	}
})

/**
 * Effect atom to process buffered messages
 * This is called after the service becomes ready
 */
export const processMessageBufferAtom = atom(null, (get, set) => {
	// Prevent concurrent processing
	if (get(isProcessingBufferAtom)) {
		return
	}

	const buffer = get(messageBufferAtom)
	if (buffer.length === 0) {
		return
	}

	try {
		set(isProcessingBufferAtom, true)
		logs.info(`Processing ${buffer.length} buffered messages`, "effects")

		// Process each buffered message
		for (const message of buffer) {
			set(messageHandlerEffectAtom, message)
		}

		// Clear the buffer
		set(messageBufferAtom, [])
		logs.info("Buffered messages processed", "effects")
	} catch (error) {
		logs.error("Error processing message buffer", "effects", { error })
	} finally {
		set(isProcessingBufferAtom, false)
	}
})

/**
 * Effect atom to dispose the service
 * This cleans up resources and removes event listeners
 */
export const disposeServiceEffectAtom = atom(null, async (get, set) => {
	const service = get(extensionServiceAtom)

	if (!service) {
		logs.warn("No service to dispose", "effects")
		return
	}

	try {
		logs.info("Disposing ExtensionService...", "effects")

		// Clear any buffered messages
		set(messageBufferAtom, [])

		// Clear pending output updates
		set(pendingOutputUpdatesAtom, new Map<string, { output: string; command?: string; completed?: boolean }>())

		// Clear command output ask tracking
		set(commandOutputAskShownAtom, new Map<string, boolean>())

		// Dispose the service
		await service.dispose()

		// Clear state
		set(updateExtensionStateAtom, null)
		set(setServiceReadyAtom, false)

		logs.info("ExtensionService disposed successfully", "effects")
	} catch (error) {
		logs.error("Error disposing ExtensionService", "effects", { error })
		const err = error instanceof Error ? error : new Error(String(error))
		set(setServiceErrorAtom, err)
		throw err
	}
})

/**
 * Derived atom to get the message buffer size
 * Useful for debugging and monitoring
 */
export const messageBufferSizeAtom = atom<number>((get) => {
	const buffer = get(messageBufferAtom)
	return buffer.length
})

/**
 * Derived atom to check if there are buffered messages
 */
export const hasBufferedMessagesAtom = atom<boolean>((get) => {
	return get(messageBufferSizeAtom) > 0
})

/**
 * Action atom to clear the message buffer
 * Useful for error recovery
 */
export const clearMessageBufferAtom = atom(null, (get, set) => {
	const bufferSize = get(messageBufferSizeAtom)
	if (bufferSize > 0) {
		logs.warn(`Clearing ${bufferSize} buffered messages`, "effects")
		set(messageBufferAtom, [])
	}
})
