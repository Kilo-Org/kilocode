/**
 * Extension state atoms for managing ExtensionState and related data
 */

import { atom } from "jotai"
import type {
	ExtensionState,
	ExtensionChatMessage,
	HistoryItem,
	TodoItem,
	RouterModels,
	ProviderSettings,
	McpServer,
} from "../../types/messages.js"

/**
 * Atom to hold the complete ExtensionState
 * This is the primary state object received from the extension
 */
export const extensionStateAtom = atom<ExtensionState | null>(null)

/**
 * Atom to hold the message history (chatMessages)
 * Extracted from ExtensionState for easier access
 */
export const chatMessagesAtom = atom<ExtensionChatMessage[]>([])

/**
 * Atom to track message versions (content length) for reconciliation
 * Maps message timestamp to content length to determine which version is newer
 */
export const messageVersionMapAtom = atom<Map<number, number>>(new Map<number, number>())

/**
 * Atom to track actively streaming messages
 * Messages in this set are protected from being overwritten by state updates
 */
export const streamingMessagesSetAtom = atom<Set<number>>(new Set<number>())

/**
 * Atom to hold the current task item
 */
export const currentTaskAtom = atom<HistoryItem | null>(null)

/**
 * Atom to hold the current task's todo list
 */
export const taskTodosAtom = atom<TodoItem[]>([])

/**
 * Atom to hold available router models
 */
export const routerModelsAtom = atom<RouterModels | null>(null)

/**
 * Atom to hold the current API configuration
 */
export const apiConfigurationAtom = atom<ProviderSettings | null>(null)

/**
 * Atom to hold the current mode
 */
export const extensionModeAtom = atom<string>("code")

/**
 * Atom to hold custom modes
 */
export const customModesAtom = atom<any[]>([])

/**
 * Atom to hold MCP servers configuration
 */
export const mcpServersAtom = atom<McpServer[]>([])

/**
 * Atom to hold the current working directory
 */
export const cwdAtom = atom<string | null>(null)

/**
 * Derived atom to get the extension version
 */
export const extensionVersionAtom = atom<string>((get) => {
	const state = get(extensionStateAtom)
	return state?.version || "unknown"
})

/**
 * Derived atom to get the current API config name
 */
export const currentApiConfigNameAtom = atom<string | null>((get) => {
	const state = get(extensionStateAtom)
	return state?.currentApiConfigName || null
})

/**
 * Derived atom to get the list of API config metadata
 */
export const listApiConfigMetaAtom = atom((get) => {
	const state = get(extensionStateAtom)
	return state?.listApiConfigMeta || []
})

/**
 * Derived atom to get task history length
 */
export const taskHistoryLengthAtom = atom<number>((get) => {
	const state = get(extensionStateAtom)
	return state?.taskHistoryFullLength || 0
})

/**
 * Derived atom to get the render context
 */
export const renderContextAtom = atom<"sidebar" | "editor" | "cli">((get) => {
	const state = get(extensionStateAtom)
	return state?.renderContext || "cli"
})

/**
 * Derived atom to check if there are any messages
 */
export const hasChatMessagesAtom = atom<boolean>((get) => {
	const messages = get(chatMessagesAtom)
	return messages.length > 0
})

/**
 * Derived atom to get the last message
 */
export const lastChatMessageAtom = atom<ExtensionChatMessage | null>((get) => {
	const messages = get(chatMessagesAtom)
	return messages.length > 0 ? (messages[messages.length - 1] ?? null) : null
})

/**
 * Derived atom to check if there's an active task
 */
export const hasActiveTaskAtom = atom<boolean>((get) => {
	const task = get(currentTaskAtom)
	return task !== null
})

/**
 * Derived atom to check if there's a resume_task ask pending
 * This checks if the last message is a resume_task or resume_completed_task
 */
export const hasResumeTaskAtom = atom<boolean>((get) => {
	const lastMessage = get(lastChatMessageAtom)
	return lastMessage?.ask === "resume_task" || lastMessage?.ask === "resume_completed_task"
})

/**
 * Derived atom to get pending todos count
 */
export const pendingTodosCountAtom = atom<number>((get) => {
	const todos = get(taskTodosAtom)
	return todos.filter((todo) => todo.status === "pending").length
})

/**
 * Derived atom to get completed todos count
 */
export const completedTodosCountAtom = atom<number>((get) => {
	const todos = get(taskTodosAtom)
	return todos.filter((todo) => todo.status === "completed").length
})

/**
 * Derived atom to get in-progress todos count
 */
export const inProgressTodosCountAtom = atom<number>((get) => {
	const todos = get(taskTodosAtom)
	return todos.filter((todo) => todo.status === "in_progress").length
})

/**
 * Action atom to update the complete extension state
 * This syncs all derived atoms with the new state
 * Uses intelligent message reconciliation to prevent flickering during streaming
 */
export const updateExtensionStateAtom = atom(null, (get, set, state: ExtensionState | null) => {
	const currentRouterModels = get(routerModelsAtom)
	const currentMessages = get(chatMessagesAtom)
	const versionMap = get(messageVersionMapAtom)
	const streamingSet = get(streamingMessagesSetAtom)

	set(extensionStateAtom, state)

	if (state) {
		// Get incoming messages from state
		const incomingMessages = state.clineMessages || state.chatMessages || []

		// Reconcile with current messages to preserve streaming state
		let reconciledMessages = reconcileMessages(currentMessages, incomingMessages, versionMap, streamingSet)

		// Auto-complete orphaned partial ask messages (CLI-only workaround for extension bug)
		reconciledMessages = autoCompleteOrphanedPartialAsks(reconciledMessages)

		set(chatMessagesAtom, reconciledMessages)

		// Update version map for all reconciled messages
		const newVersionMap = new Map<number, number>()
		reconciledMessages.forEach((msg) => {
			const version = getMessageContentLength(msg)
			newVersionMap.set(msg.ts, version)
		})
		set(messageVersionMapAtom, newVersionMap)

		// Update streaming set based on reconciled messages
		const newStreamingSet = new Set<number>()
		reconciledMessages.forEach((msg) => {
			if (msg.partial) {
				newStreamingSet.add(msg.ts)
			}
		})
		set(streamingMessagesSetAtom, newStreamingSet)

		// Sync other derived atoms
		set(currentTaskAtom, state.currentTaskItem || null)
		set(taskTodosAtom, state.currentTaskTodos || [])
		// Preserve existing routerModels if not provided in new state
		set(routerModelsAtom, state.routerModels || currentRouterModels)
		set(apiConfigurationAtom, state.apiConfiguration || null)
		set(extensionModeAtom, state.mode || "code")
		set(customModesAtom, state.customModes || [])
		set(mcpServersAtom, state.mcpServers || [])
		set(cwdAtom, state.cwd || null)
	} else {
		// Clear all derived atoms
		set(chatMessagesAtom, [])
		set(currentTaskAtom, null)
		set(taskTodosAtom, [])
		set(routerModelsAtom, null)
		set(apiConfigurationAtom, null)
		set(extensionModeAtom, "code")
		set(customModesAtom, [])
		set(mcpServersAtom, [])
		set(cwdAtom, null)
		// Clear version tracking
		set(messageVersionMapAtom, new Map<number, number>())
		set(streamingMessagesSetAtom, new Set<number>())
	}
})

/**
 * Action atom to update only the messages
 * Useful for incremental message updates
 */
export const updateChatMessagesAtom = atom(null, (get, set, messages: ExtensionChatMessage[]) => {
	set(chatMessagesAtom, messages)

	// Update the state atom if it exists
	const state = get(extensionStateAtom)
	if (state) {
		set(extensionStateAtom, {
			...state,
			chatMessages: messages,
		})
	}
})

/**
 * Action atom to add a single message
 */
export const addChatMessageAtom = atom(null, (get, set, message: ExtensionChatMessage) => {
	const messages = get(chatMessagesAtom)
	set(updateChatMessagesAtom, [...messages, message])
})

/**
 * Action atom to update a single message by timestamp
 * Used for incremental message updates during streaming
 *
 * Simplified version that trusts state as source of truth:
 * - Only updates messages that already exist in state
 * - Ignores updates for non-existent messages (they'll come via state update)
 * - Always updates partial messages to show streaming progress
 * - Only updates complete messages if they have more content
 */
export const updateChatMessageByTsAtom = atom(null, (get, set, updatedMessage: ExtensionChatMessage) => {
	const messages = get(chatMessagesAtom)
	const versionMap = get(messageVersionMapAtom)
	const streamingSet = get(streamingMessagesSetAtom)

	// Find the message by timestamp
	let messageIndex = -1
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i]?.ts === updatedMessage.ts) {
			messageIndex = i
			break
		}
	}

	// If message doesn't exist, ignore it - it will come through state update
	if (messageIndex === -1) {
		return
	}

	// Update existing message
	const existingMessage = messages[messageIndex]!
	const currentVersion = versionMap.get(existingMessage.ts) || 0
	const newVersion = getMessageContentLength(updatedMessage)

	// Always update if:
	// 1. Message is partial (streaming update)
	// 2. New version has more content
	// 3. Partial flag changed (partial=true -> partial=false transition)
	const partialFlagChanged = existingMessage.partial !== updatedMessage.partial

	if (updatedMessage.partial || newVersion > currentVersion || partialFlagChanged) {
		const newMessages = [...messages]
		newMessages[messageIndex] = updatedMessage
		set(updateChatMessagesAtom, newMessages)

		// Update version tracking
		const newVersionMap = new Map(versionMap)
		newVersionMap.set(updatedMessage.ts, newVersion)
		set(messageVersionMapAtom, newVersionMap)

		// Update streaming state
		const newStreamingSet = new Set(streamingSet)
		if (updatedMessage.partial) {
			newStreamingSet.add(updatedMessage.ts)
		} else {
			newStreamingSet.delete(updatedMessage.ts)
		}
		set(streamingMessagesSetAtom, newStreamingSet)
	}
})

/**
 * Action atom to update the current task
 */
export const updateCurrentTaskAtom = atom(null, (get, set, task: HistoryItem | null) => {
	set(currentTaskAtom, task)

	// Update the state atom if it exists
	const state = get(extensionStateAtom)
	if (state) {
		const updatedState: ExtensionState = {
			...state,
		}
		if (task) {
			updatedState.currentTaskItem = task
		} else {
			delete updatedState.currentTaskItem
		}
		set(extensionStateAtom, updatedState)
	}
})

/**
 * Action atom to update task todos
 */
export const updateTaskTodosAtom = atom(null, (get, set, todos: TodoItem[]) => {
	set(taskTodosAtom, todos)

	// Update the state atom if it exists
	const state = get(extensionStateAtom)
	if (state) {
		set(extensionStateAtom, {
			...state,
			currentTaskTodos: todos,
		})
	}
})

/**
 * Action atom to update router models
 */
export const updateRouterModelsAtom = atom(null, (get, set, models: RouterModels | null) => {
	set(routerModelsAtom, models)

	// Update the state atom if it exists
	const state = get(extensionStateAtom)
	if (state) {
		const updatedState: ExtensionState = {
			...state,
		}
		if (models) {
			updatedState.routerModels = models
		} else {
			delete updatedState.routerModels
		}
		set(extensionStateAtom, updatedState)
	}
})

/**
 * Action atom to update the mode
 */
export const updateExtensionModeAtom = atom(null, (get, set, mode: string) => {
	set(extensionModeAtom, mode)

	// Update the state atom if it exists
	const state = get(extensionStateAtom)
	if (state) {
		set(extensionStateAtom, {
			...state,
			mode,
		})
	}
})

/**
 * Action atom to update extension state with partial updates
 * Merges the partial state with the current state
 */
export const updatePartialExtensionStateAtom = atom(null, (get, set, partialState: Partial<ExtensionState>) => {
	const currentState = get(extensionStateAtom)
	if (currentState) {
		set(updateExtensionStateAtom, {
			...currentState,
			...partialState,
		})
	} else {
		// If no current state, we need to create a minimal valid state
		const minimalState: ExtensionState = {
			version: "1.0.0",
			apiConfiguration: {},
			chatMessages: [],
			mode: "code",
			customModes: [],
			taskHistoryFullLength: 0,
			taskHistoryVersion: 0,
			renderContext: "cli",
			telemetrySetting: "disabled",
			...partialState,
		}
		set(updateExtensionStateAtom, minimalState)
	}
})

/**
 * Action atom to clear all extension state
 */
export const clearExtensionStateAtom = atom(null, (get, set) => {
	set(updateExtensionStateAtom, null)
	// Clear version tracking
	set(messageVersionMapAtom, new Map<number, number>())
	set(streamingMessagesSetAtom, new Set<number>())
})

/**
 * Helper function to calculate message content length for versioning
 * Used to determine which version of a message is newer
 */
function getMessageContentLength(msg: ExtensionChatMessage): number {
	let length = 0
	if (msg.text) length += msg.text.length
	if (msg.say) length += msg.say.length
	if (msg.ask) length += msg.ask.length
	return length
}

/**
 * Auto-complete orphaned partial ask messages (CLI-only workaround)
 *
 * This handles the extension bug where ask messages can get stuck with partial=true
 * when other messages (like checkpoint_saved) are added between the partial message
 * and its completion, causing the extension to create a new message instead of updating.
 *
 * Detection logic:
 * - If an ask message has partial=true
 * - AND there's a subsequent message with a later timestamp
 * - AND that subsequent message is NOT command_output (which is expected during command execution)
 * - THEN mark the partial ask as complete (partial=false)
 *
 * This ensures messages don't get stuck in partial state indefinitely.
 */
function autoCompleteOrphanedPartialAsks(messages: ExtensionChatMessage[]): ExtensionChatMessage[] {
	const result = [...messages]

	for (let i = 0; i < result.length; i++) {
		const msg = result[i]

		// Only process partial ask messages
		if (!msg || msg.type !== "ask" || !msg.partial) {
			continue
		}

		// Check if there's a subsequent message (not command_output)
		let hasSubsequentMessage = false
		for (let j = i + 1; j < result.length; j++) {
			const nextMsg = result[j]
			if (!nextMsg) continue

			// Skip command_output messages as they're expected during command execution
			if (nextMsg.ask === "command_output") {
				continue
			}

			// Found a subsequent non-command_output message
			hasSubsequentMessage = true
			break
		}

		// If there's a subsequent message, this partial ask is orphaned - mark it complete
		if (hasSubsequentMessage) {
			result[i] = { ...msg, partial: false }
		}
	}

	return result
}

/**
 * Helper function to reconcile messages from state updates with existing messages
 * Strategy:
 * - State is the source of truth for WHICH messages exist (count/list)
 * - Real-time updates are the source of truth for CONTENT of partial messages
 * - Only preserve content of actively streaming messages if they have more data
 */
function reconcileMessages(
	current: ExtensionChatMessage[],
	incoming: ExtensionChatMessage[],
	versionMap: Map<number, number>,
	streamingSet: Set<number>,
): ExtensionChatMessage[] {
	// Create lookup map for current messages
	const currentMap = new Map<number, ExtensionChatMessage>()
	current.forEach((msg) => {
		currentMap.set(msg.ts, msg)
	})

	// Process ALL incoming messages - state determines which messages exist
	const resultMessages: ExtensionChatMessage[] = incoming.map((incomingMsg) => {
		const existingMsg = currentMap.get(incomingMsg.ts)

		// PRIORITY 1: Prevent completed messages from being overwritten by stale partial updates
		// This handles the race condition where:
		// 1. Extension sends messageUpdated with partial=false (removes from streamingSet)
		// 2. Extension sends state update with stale partial=true version
		// We should keep the completed version if incoming is partial with less/equal content
		// NOTE: This must come BEFORE streaming protection check since the message
		// is no longer in streamingSet after being marked complete
		if (existingMsg && !existingMsg.partial && incomingMsg.partial) {
			const currentVersion = versionMap.get(incomingMsg.ts) || 0
			const incomingVersion = getMessageContentLength(incomingMsg)

			// Reject if incoming has less or equal content (stale update)
			// This includes the case where content is identical (race condition bug)
			if (incomingVersion <= currentVersion) {
				return existingMsg
			}
			// If incoming has MORE content, accept it (might be a new streaming session)
		}

		// PRIORITY 2: If message is actively streaming, protect it from ALL rollbacks
		// This handles both partial and non-partial state updates that might have stale content
		if (existingMsg && streamingSet.has(incomingMsg.ts) && existingMsg.partial) {
			const currentVersion = versionMap.get(incomingMsg.ts) || 0
			const incomingVersion = getMessageContentLength(incomingMsg)

			// If incoming message is no longer partial AND has more/equal content, accept it (completion)
			// This ensures messages properly transition from partial=true to partial=false
			if (!incomingMsg.partial && incomingVersion >= currentVersion) {
				return incomingMsg
			}

			// For any other case (partial incoming OR shorter non-partial), keep current if it has more content
			if (currentVersion > incomingVersion) {
				return existingMsg
			}
		}

		// Default: accept the incoming message
		return incomingMsg
	})

	// Return sorted array by timestamp
	return resultMessages.sort((a, b) => a.ts - b.ts)
}
