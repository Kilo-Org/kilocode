import { useCallback, useRef } from "react"
import type { ExtensionMessage, ClineMessage, ClineAsk, ClineSay, TodoItem } from "@roo-code/types"
import { consolidateTokenUsage, consolidateApiRequests, consolidateCommands } from "@roo-code/core/cli"

import type { TUIMessage, ToolData } from "../types.js"
import type { FileResult, SlashCommandResult, ModeResult } from "../components/autocomplete/index.js"
import { useCLIStore } from "../store.js"
import { extractToolData, formatToolOutput, formatToolAskMessage, parseTodosFromToolInfo } from "../utils/tools.js"

export interface UseMessageHandlersOptions {
	nonInteractive: boolean
}

export interface UseMessageHandlersReturn {
	handleExtensionMessage: (msg: ExtensionMessage) => void
	seenMessageIds: React.MutableRefObject<Set<string>>
	pendingCommandRef: React.MutableRefObject<string | null>
	firstTextMessageSkipped: React.MutableRefObject<boolean>
}

/**
 * Hook to handle messages from the extension.
 *
 * Processes three types of messages:
 * 1. "say" messages - Information from the agent (text, tool output, reasoning)
 * 2. "ask" messages - Requests for user input (approvals, followup questions)
 * 3. Extension state updates - Mode changes, task history, file search results
 *
 * Transforms ClineMessage format to TUIMessage format and updates the store.
 */
export function useMessageHandlers({ nonInteractive }: UseMessageHandlersOptions): UseMessageHandlersReturn {
	const {
		addMessage,
		setPendingAsk,
		setComplete,
		setLoading,
		setHasStartedTask,
		setFileSearchResults,
		setAllSlashCommands,
		setAvailableModes,
		setCurrentMode,
		setTokenUsage,
		setRouterModels,
		setTaskHistory,
		currentTodos,
		setTodos,
	} = useCLIStore()

	// Track seen message timestamps to filter duplicates and the prompt echo
	const seenMessageIds = useRef<Set<string>>(new Set())
	const firstTextMessageSkipped = useRef(false)

	// Track pending command for injecting into command_output toolData
	const pendingCommandRef = useRef<string | null>(null)

	/**
	 * Map extension "say" messages to TUI messages
	 */
	const handleSayMessage = useCallback(
		(ts: number, say: ClineSay, text: string, partial: boolean) => {
			const messageId = ts.toString()
			const isResuming = useCLIStore.getState().isResumingTask

			if (say === "checkpoint_saved") {
				return
			}

			if (say === "api_req_started") {
				return
			}

			if (say === "user_feedback") {
				seenMessageIds.current.add(messageId)
				return
			}

			// Skip first text message ONLY for new tasks, not resumed tasks
			// When resuming, we want to show all historical messages including the first one
			if (say === "text" && !firstTextMessageSkipped.current && !isResuming) {
				firstTextMessageSkipped.current = true
				seenMessageIds.current.add(messageId)
				return
			}

			if (seenMessageIds.current.has(messageId) && !partial) {
				return
			}

			let role: TUIMessage["role"] = "assistant"
			let toolName: string | undefined
			let toolDisplayName: string | undefined
			let toolDisplayOutput: string | undefined
			let toolData: ToolData | undefined

			if (say === "command_output") {
				role = "tool"
				toolName = "execute_command"
				toolDisplayName = "bash"
				toolDisplayOutput = text
				const trackedCommand = pendingCommandRef.current
				toolData = { tool: "execute_command", command: trackedCommand || undefined, output: text }
				pendingCommandRef.current = null
			} else if (say === "reasoning") {
				role = "thinking"
			}

			seenMessageIds.current.add(messageId)

			addMessage({
				id: messageId,
				role,
				content: text || "",
				toolName,
				toolDisplayName,
				toolDisplayOutput,
				partial,
				originalType: say,
				toolData,
			})
		},
		[addMessage],
	)

	/**
	 * Handle extension "ask" messages
	 */
	const handleAskMessage = useCallback(
		(ts: number, ask: ClineAsk, text: string, partial: boolean) => {
			const messageId = ts.toString()

			if (partial) {
				return
			}

			if (seenMessageIds.current.has(messageId)) {
				return
			}

			if (ask === "command_output") {
				seenMessageIds.current.add(messageId)
				return
			}

			// Handle resume_task and resume_completed_task - stop loading and show text input
			// Do not set pendingAsk - just stop loading so user sees normal input to type new message
			if (ask === "resume_task" || ask === "resume_completed_task") {
				seenMessageIds.current.add(messageId)
				setLoading(false)
				// Mark that a task has been started so subsequent messages continue the task
				// (instead of starting a brand new task via runTask)
				setHasStartedTask(true)
				// Clear the resuming flag since we're now ready for interaction
				// Historical messages should already be displayed from state processing
				useCLIStore.getState().setIsResumingTask(false)
				// Do not set pendingAsk - let the normal text input appear
				return
			}

			if (ask === "completion_result") {
				seenMessageIds.current.add(messageId)
				setComplete(true)
				setLoading(false)

				// Parse the completion result and add a message for CompletionTool to render
				try {
					const completionInfo = JSON.parse(text) as Record<string, unknown>
					const toolData: ToolData = {
						tool: "attempt_completion",
						result: completionInfo.result as string | undefined,
						content: completionInfo.result as string | undefined,
					}

					addMessage({
						id: messageId,
						role: "tool",
						content: text,
						toolName: "attempt_completion",
						toolDisplayName: "Task Complete",
						toolDisplayOutput: formatToolOutput({ tool: "attempt_completion", ...completionInfo }),
						originalType: ask,
						toolData,
					})
				} catch {
					// If parsing fails, still add a basic completion message
					addMessage({
						id: messageId,
						role: "tool",
						content: text || "Task completed",
						toolName: "attempt_completion",
						toolDisplayName: "Task Complete",
						toolDisplayOutput: "✅ Task completed",
						originalType: ask,
						toolData: {
							tool: "attempt_completion",
							content: text,
						},
					})
				}
				return
			}

			// Track pending command BEFORE nonInteractive handling
			// This ensures we capture the command text for later injection into command_output toolData
			if (ask === "command") {
				pendingCommandRef.current = text
			}

			if (nonInteractive && ask !== "followup") {
				seenMessageIds.current.add(messageId)

				if (ask === "tool") {
					let toolName: string | undefined
					let toolDisplayName: string | undefined
					let toolDisplayOutput: string | undefined
					let formattedContent = text || ""
					let toolData: ToolData | undefined
					let todos: TodoItem[] | undefined
					let previousTodos: TodoItem[] | undefined

					try {
						const toolInfo = JSON.parse(text) as Record<string, unknown>
						toolName = toolInfo.tool as string
						toolDisplayName = toolInfo.tool as string
						toolDisplayOutput = formatToolOutput(toolInfo)
						formattedContent = formatToolAskMessage(toolInfo)
						// Extract structured toolData for rich rendering
						toolData = extractToolData(toolInfo)

						// Special handling for update_todo_list tool - extract todos
						if (toolName === "update_todo_list" || toolName === "updateTodoList") {
							const parsedTodos = parseTodosFromToolInfo(toolInfo)
							if (parsedTodos && parsedTodos.length > 0) {
								todos = parsedTodos
								// Capture previous todos before updating global state
								previousTodos = [...currentTodos]
								setTodos(parsedTodos)
							}
						}
					} catch {
						// Use raw text if not valid JSON
					}

					addMessage({
						id: messageId,
						role: "tool",
						content: formattedContent,
						toolName,
						toolDisplayName,
						toolDisplayOutput,
						originalType: ask,
						toolData,
						todos,
						previousTodos,
					})
				} else {
					addMessage({
						id: messageId,
						role: "assistant",
						content: text || "",
						originalType: ask,
					})
				}
				return
			}

			let suggestions: Array<{ answer: string; mode?: string | null }> | undefined
			let questionText = text

			if (ask === "followup") {
				try {
					const data = JSON.parse(text)
					questionText = data.question || text
					suggestions = Array.isArray(data.suggest) ? data.suggest : undefined
				} catch {
					// Use raw text
				}
			} else if (ask === "tool") {
				try {
					const toolInfo = JSON.parse(text) as Record<string, unknown>
					questionText = formatToolAskMessage(toolInfo)
				} catch {
					// Use raw text if not valid JSON
				}
			}
			// Note: ask === "command" is handled above before the nonInteractive block

			seenMessageIds.current.add(messageId)

			setPendingAsk({
				id: messageId,
				type: ask,
				content: questionText,
				suggestions,
			})
		},
		[addMessage, setPendingAsk, setComplete, setLoading, setHasStartedTask, nonInteractive, currentTodos, setTodos],
	)

	/**
	 * Handle all extension messages
	 */
	const handleExtensionMessage = useCallback(
		(msg: ExtensionMessage) => {
			if (msg.type === "state") {
				const state = msg.state

				if (!state) {
					return
				}

				// Extract and update current mode from state
				const newMode = state.mode

				if (newMode) {
					setCurrentMode(newMode)
				}

				// Extract and update task history from state
				const newTaskHistory = state.taskHistory

				if (newTaskHistory && Array.isArray(newTaskHistory)) {
					setTaskHistory(newTaskHistory)
				}

				const clineMessages = state.clineMessages

				if (clineMessages) {
					for (const clineMsg of clineMessages) {
						const ts = clineMsg.ts
						const type = clineMsg.type
						const say = clineMsg.say
						const ask = clineMsg.ask
						const text = clineMsg.text || ""
						const partial = clineMsg.partial || false

						if (type === "say" && say) {
							handleSayMessage(ts, say, text, partial)
						} else if (type === "ask" && ask) {
							handleAskMessage(ts, ask, text, partial)
						}
					}

					// Compute token usage metrics from clineMessages
					// Skip first message (task prompt) as per webview UI pattern
					if (clineMessages.length > 1) {
						const processed = consolidateApiRequests(
							consolidateCommands(clineMessages.slice(1) as ClineMessage[]),
						)

						const metrics = consolidateTokenUsage(processed)
						setTokenUsage(metrics)
					}
				}

				// After processing state, clear the resuming flag if it was set
				// This ensures the flag is cleared even if no resume_task ask message is received
				if (useCLIStore.getState().isResumingTask) {
					useCLIStore.getState().setIsResumingTask(false)
				}
			} else if (msg.type === "messageUpdated") {
				const clineMessage = msg.clineMessage

				if (!clineMessage) {
					return
				}

				const ts = clineMessage.ts
				const type = clineMessage.type
				const say = clineMessage.say
				const ask = clineMessage.ask
				const text = clineMessage.text || ""
				const partial = clineMessage.partial || false

				if (type === "say" && say) {
					handleSayMessage(ts, say, text, partial)
				} else if (type === "ask" && ask) {
					handleAskMessage(ts, ask, text, partial)
				}
			} else if (msg.type === "fileSearchResults") {
				setFileSearchResults((msg.results as FileResult[]) || [])
			} else if (msg.type === "commands") {
				setAllSlashCommands((msg.commands as SlashCommandResult[]) || [])
			} else if (msg.type === "modes") {
				setAvailableModes((msg.modes as ModeResult[]) || [])
			} else if (msg.type === "routerModels") {
				if (msg.routerModels) {
					setRouterModels(msg.routerModels)
				}
			}
		},
		[
			handleSayMessage,
			handleAskMessage,
			setFileSearchResults,
			setAllSlashCommands,
			setAvailableModes,
			setCurrentMode,
			setTokenUsage,
			setRouterModels,
			setTaskHistory,
		],
	)

	return {
		handleExtensionMessage,
		seenMessageIds,
		pendingCommandRef,
		firstTextMessageSkipped,
	}
}
