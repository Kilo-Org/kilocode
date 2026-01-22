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
	ModeConfig,
} from "../../types/messages.js"
import { pendingOutputUpdatesAtom } from "./effects.js"

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
export const customModesAtom = atom<ModeConfig[]>([])

/**
 * Atom to hold MCP servers configuration
 */
export const mcpServersAtom = atom<McpServer[]>([])

/**
 * Atom to hold the current working directory
 */
export const cwdAtom = atom<string | null>(null)

/**
 * Atom to track if we're in parallel mode
 */
export const isParallelModeAtom = atom(false)

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
 * Atom to track if the task was resumed via --continue flag
 * Prevents showing "Task ready to resume" message when already resumed
 */
export const taskResumedViaContinueOrSessionAtom = atom<boolean>(false)

/**
 * Derived atom to check if there's a resume_task ask pending
 * This checks if the last message is a resume_task or resume_completed_task
 * But doesn't show the message if the task was already resumed via --continue
 */
export const hasResumeTaskAtom = atom<boolean>((get) => {
	const taskResumedViaContinue = get(taskResumedViaContinueOrSessionAtom)
	if (taskResumedViaContinue) {
		return false
	}

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
	const pendingUpdates = get(pendingOutputUpdatesAtom)

	set(extensionStateAtom, state)

	if (state) {
		// Get incoming messages from state
		const incomingMessages = state.clineMessages || state.chatMessages || []

		// Reconcile with current messages to preserve streaming state
		// Pass pending updates to apply them to new command_output asks
		let reconciledMessages = reconcileMessages(
			currentMessages,
			incomingMessages,
			versionMap,
			streamingSet,
			pendingUpdates,
		)

		// Auto-complete orphaned partial ask messages (CLI-only workaround for extension bug)
		reconciledMessages = autoCompleteOrphanedPartialAsks(reconciledMessages)

		// Auto-complete orphaned partial tool messages (CLI-only workaround for extension bug)
		// This fixes the issue where list_files and search_files show "Total: 0 items"
		reconciledMessages = autoCompleteOrphanedPartialTools(reconciledMessages)

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

	// Detect content changes that may not affect length (e.g. numeric JSON fields like costs)
	const contentChanged =
		existingMessage.text !== updatedMessage.text ||
		existingMessage.say !== updatedMessage.say ||
		existingMessage.ask !== updatedMessage.ask ||
		existingMessage.isAnswered !== updatedMessage.isAnswered ||
		existingMessage.metadata !== updatedMessage.metadata

	// Always update if:
	// 1. Message is partial (streaming update) - BUT NOT if existing message is already complete
	// 2. New version has more content
	// 3. Partial flag changed from partial=true -> partial=false (completion)
	// 4. Content changed but length stayed the same (e.g. cost updated from 0.0010 -> 0.0020)
	const partialFlagChanged = existingMessage.partial !== updatedMessage.partial

	// BUG FIX: Don't allow stale partial updates to overwrite completed messages
	// This prevents context drops when delayed IPC messages arrive after a message has completed
	const isStalePartialUpdate = existingMessage.partial === false && updatedMessage.partial === true

	// Skip stale partial updates that would revert a completed message back to partial
	if (isStalePartialUpdate && newVersion <= currentVersion) {
		return
	}

	if (
		(updatedMessage.partial && !isStalePartialUpdate) ||
		newVersion > currentVersion ||
		partialFlagChanged ||
		(contentChanged && newVersion === currentVersion)
	) {
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
 * Auto-complete orphaned partial tool messages (CLI-only workaround)
 *
 * This handles the case where tool messages (ask type with ask="tool") can get stuck
 * with partial=true when the complete message update is missed or arrives out of order.
 *
 * Detection logic (mark as complete if ANY of these conditions are true):
 * 1. If a tool message has partial=true AND there's a subsequent message
 *    → The tool has completed but the complete message was missed
 * 2. If a tool message has partial=true AND has non-empty text content
 *    → The tool has content but the partial flag wasn't cleared
 *
 * This ensures tool messages don't get stuck in partial state indefinitely,
 * which would cause them to be filtered out by hidePartialMessages and show
 * "Total: 0 items" or "Found: 0 matches" in the CLI.
 */
function autoCompleteOrphanedPartialTools(messages: ExtensionChatMessage[]): ExtensionChatMessage[] {
	const result = [...messages]

	for (let i = 0; i < result.length; i++) {
		const msg = result[i]

		// Only process partial tool messages (ask type with ask="tool")
		if (!msg || msg.type !== "ask" || msg.ask !== "tool" || !msg.partial) {
			continue
		}

		// Condition 1: Check if there's a subsequent message
		let hasSubsequentMessage = false
		for (let j = i + 1; j < result.length; j++) {
			const nextMsg = result[j]
			if (!nextMsg) continue

			// Found a subsequent message
			hasSubsequentMessage = true
			break
		}

		// Condition 2: Check if the tool message has non-empty content
		// Tool messages store their content as JSON in the 'text' field with a 'content' property
		let hasContent = false
		try {
			const parsed = JSON.parse(msg.text || "{}")
			hasContent = parsed.content && parsed.content.trim().length > 0
		} catch {
			// If parsing fails, fall back to checking text directly
			hasContent = Boolean(msg.text && msg.text.trim().length > 0)
		}

		// If either condition is true, mark the partial tool as complete
		if (hasSubsequentMessage || hasContent) {
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
 * - Merge duplicate command_output asks with the same executionId
 */
function reconcileMessages(
	current: ExtensionChatMessage[],
	incoming: ExtensionChatMessage[],
	versionMap: Map<number, number>,
	streamingSet: Set<number>,
	pendingUpdates?: Map<string, { output: string; command?: string; completed?: boolean }>,
): ExtensionChatMessage[] {
	// Create lookup map for current messages
	const currentMap = new Map<number, ExtensionChatMessage>()
	current.forEach((msg) => {
		currentMap.set(msg.ts, msg)
	})

	// Identify synthetic command_output asks (CLI-created, not from extension)
	// These have executionId in their text and don't exist in incoming messages
	const syntheticAsks: ExtensionChatMessage[] = []
	current.forEach((msg) => {
		if (msg.type === "ask" && msg.ask === "command_output" && msg.text) {
			try {
				const data = JSON.parse(msg.text)
				if (data.executionId) {
					// Check if this message exists in incoming
					const existsInIncoming = incoming.some((incomingMsg) => incomingMsg.ts === msg.ts)
					if (!existsInIncoming) {
						// This is a synthetic ask created by CLI
						syntheticAsks.push(msg)
					}
				}
			} catch {
				// Ignore parse errors
			}
		}
	})

	// First, deduplicate command_output asks
	// Since extension creates asks with empty text, we keep only the first unanswered one
	const deduplicatedIncoming = deduplicateCommandOutputAsks(incoming, pendingUpdates)

	// Process ALL incoming messages - state determines which messages exist
	const resultMessages: ExtensionChatMessage[] = deduplicatedIncoming.map((incomingMsg) => {
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

	// Add synthetic asks back to the result
	// These are CLI-created asks that the extension doesn't know about
	const finalMessages = [...resultMessages, ...syntheticAsks]

	// Return sorted array by timestamp
	return finalMessages.sort((a, b) => a.ts - b.ts)
}

/**
 * Deduplicate command_output asks
 * Since the extension creates asks with empty text (no executionId), we can't match by executionId
 * Instead, keep only the MOST RECENT unanswered command_output ask and discard older ones
 * This allows multiple sequential commands to work correctly
 * The component will read from pendingOutputUpdatesAtom for real-time output
 */
function deduplicateCommandOutputAsks(
	messages: ExtensionChatMessage[],
	pendingUpdates?: Map<string, { output: string; command?: string; completed?: boolean }>,
): ExtensionChatMessage[] {
	const result: ExtensionChatMessage[] = []
	let mostRecentUnansweredAsk: ExtensionChatMessage | null = null
	let mostRecentUnansweredAskIndex = -1

	// First pass: find the most recent unanswered command_output ask
	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i]
		if (msg && msg.type === "ask" && msg.ask === "command_output" && !msg.isAnswered) {
			if (!mostRecentUnansweredAsk || msg.ts > mostRecentUnansweredAsk.ts) {
				mostRecentUnansweredAsk = msg
				mostRecentUnansweredAskIndex = i
			}
		}
	}

	// Second pass: build result, keeping only the most recent unanswered ask
	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i]

		if (msg && msg.type === "ask" && msg.ask === "command_output" && !msg.isAnswered) {
			if (i === mostRecentUnansweredAskIndex) {
				// This is the most recent unanswered ask - keep it with pending updates
				let processedMsg = msg

				// If we have pending updates, find the one that's NOT completed (the active command)
				if (pendingUpdates && pendingUpdates.size > 0) {
					// Find the active (non-completed) pending update
					let activeExecutionId: string | null = null
					let activeUpdate: { output: string; command?: string; completed?: boolean } | null = null

					for (const [execId, update] of pendingUpdates.entries()) {
						if (!update.completed) {
							activeExecutionId = execId
							activeUpdate = update
							break
						}
					}

					// If no active update found, use the most recent one (fallback)
					if (!activeExecutionId && pendingUpdates.size > 0) {
						const entries = Array.from(pendingUpdates.entries())
						;[activeExecutionId, activeUpdate] = entries[entries.length - 1]!
					}

					if (activeExecutionId && activeUpdate) {
						processedMsg = {
							...msg,
							text: JSON.stringify({
								executionId: activeExecutionId,
								command: activeUpdate.command || "",
								output: activeUpdate.output || "",
							}),
							partial: !activeUpdate.completed,
							isAnswered: activeUpdate.completed || false,
						}
					}
				}

				result.push(processedMsg)
			}
			// Discard older unanswered command_output asks (no logging needed)
		} else if (msg) {
			// Not an unanswered command_output ask, keep as-is
			result.push(msg)
		}
	}

	return result
}
