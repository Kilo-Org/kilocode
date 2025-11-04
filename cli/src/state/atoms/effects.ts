/**
 * Effect atoms for message handling and service initialization
 * These atoms handle side effects like processing messages and initializing the service
 */

import { atom } from "jotai"
import type { ExtensionMessage } from "../../types/messages.js"
import { extensionServiceAtom, setServiceReadyAtom, setServiceErrorAtom, setIsInitializingAtom } from "./service.js"
import { updateExtensionStateAtom, updateChatMessageByTsAtom, updateRouterModelsAtom } from "./extension.js"
import { ciCompletionDetectedAtom } from "./ci.js"
import {
	updateProfileDataAtom,
	updateBalanceDataAtom,
	setProfileLoadingAtom,
	setBalanceLoadingAtom,
	setProfileErrorAtom,
	setBalanceErrorAtom,
} from "./profile.js"
import {
	taskHistoryDataAtom,
	taskHistoryLoadingAtom,
	taskHistoryErrorAtom,
	resolveTaskHistoryRequestAtom,
} from "./taskHistory.js"
import { logs } from "../../services/logs.js"

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
 * Effect atom to initialize the ExtensionService
 * This sets up event listeners and activates the service
 */
export const initializeServiceEffectAtom = atom(null, async (get, set, store?: any) => {
	const service = get(extensionServiceAtom)

	if (!service) {
		const error = new Error("ExtensionService not available for initialization")
		set(setServiceErrorAtom, error)
		throw error
	}

	// Get the store reference - if not passed, we can't update atoms from event listeners
	const atomStore = store || (get as any).store
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

		// Handle different message types
		switch (message.type) {
			case "state":
				// State messages are handled by the stateChange event listener
				// Skip processing here to avoid duplication
				break

			case "messageUpdated":
				if (message.chatMessage) {
					set(updateChatMessageByTsAtom, message.chatMessage)
				}
				break

			case "routerModels":
				if (message.routerModels) {
					set(updateRouterModelsAtom, message.routerModels)
				}
				break

			case "profileDataResponse":
				set(setProfileLoadingAtom, false)
				if (message.payload?.success) {
					set(updateProfileDataAtom, message.payload.data)
				} else {
					set(setProfileErrorAtom, message.payload?.error || "Failed to fetch profile")
				}
				break

			case "balanceDataResponse":
				// Handle balance data response
				set(setBalanceLoadingAtom, false)
				if (message.payload?.success) {
					set(updateBalanceDataAtom, message.payload.data)
				} else {
					set(setBalanceErrorAtom, message.payload?.error || "Failed to fetch balance")
				}
				break

			case "taskHistoryResponse":
				// Handle task history response
				set(taskHistoryLoadingAtom, false)
				if (message.payload) {
					const { historyItems, pageIndex, pageCount, requestId } = message.payload as any
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
					if (message.payload?.requestId) {
						set(resolveTaskHistoryRequestAtom, {
							requestId: message.payload.requestId,
							error: "Failed to fetch task history",
						})
					}
				}
				break

			case "action":
				// Action messages are typically handled by the UI
				break

			case "partialMessage":
				// Partial messages update the current message being streamed
				break

			case "invoke":
				// Invoke messages trigger specific UI actions
				break

			default:
				logs.debug(`Unhandled message type: ${message.type}`, "effects")
		}

		// Check for completion_result in chatMessages (for CI mode)
		if (message.state?.chatMessages) {
			const lastMessage = message.state.chatMessages[message.state.chatMessages.length - 1]
			if (lastMessage?.type === "ask" && lastMessage?.ask === "completion_result") {
				logs.info("Completion result detected in state update", "effects")
				set(ciCompletionDetectedAtom, true)
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
