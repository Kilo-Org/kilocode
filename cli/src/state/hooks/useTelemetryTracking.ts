/**
 * Hook for telemetry tracking throughout the CLI
 * Provides centralized telemetry tracking for various events
 */

import { useEffect, useRef } from "react"
import { useAtomValue } from "jotai"
import { extensionStateAtom, chatMessagesAtom, currentTaskAtom } from "../atoms/extension.js"
import { getTelemetryService } from "../../services/telemetry/index.js"
import { logs } from "../../services/logs.js"
import type { ExtensionChatMessage, HistoryItem } from "../../types/messages.js"

/**
 * Hook to track extension state changes and messages
 */
export function useTelemetryTracking() {
	const extensionState = useAtomValue(extensionStateAtom)
	const chatMessages = useAtomValue(chatMessagesAtom)
	const currentTask = useAtomValue(currentTaskAtom)

	// Track previous values to detect changes
	const prevMessagesRef = useRef<ExtensionChatMessage[]>([])
	const prevTaskRef = useRef<HistoryItem | null>(null)
	const taskStartTimeRef = useRef<number>(0)

	// Track new messages
	useEffect(() => {
		if (chatMessages.length > prevMessagesRef.current.length) {
			const newMessages = chatMessages.slice(prevMessagesRef.current.length)

			for (const message of newMessages) {
				// Track assistant messages
				if (message.type === "say" && message.say) {
					getTelemetryService().trackAssistantMessageReceived(message.say.length, currentTask?.id)
				}

				// Track tool usage from ask messages
				if (message.type === "ask" && message.ask === "tool" && message.text) {
					try {
						const toolData = JSON.parse(message.text)
						if (toolData.tool) {
							// Tool execution will be tracked when approved/executed
							logs.debug("Tool request detected", "useTelemetryTracking", {
								tool: toolData.tool,
							})
						}
					} catch {
						// Ignore parse errors
					}
				}
			}
		}

		prevMessagesRef.current = chatMessages
	}, [chatMessages, currentTask])

	// Track task lifecycle
	useEffect(() => {
		const telemetry = getTelemetryService()

		// Task created
		if (currentTask && !prevTaskRef.current) {
			telemetry.trackTaskCreated(currentTask.id)
			taskStartTimeRef.current = Date.now()
			logs.debug("Task created", "useTelemetryTracking", { taskId: currentTask.id })
		}

		// Task completed/changed
		if (prevTaskRef.current && !currentTask) {
			const duration = Date.now() - taskStartTimeRef.current
			const stats = {
				messageCount: chatMessages.length,
				duration,
			}
			telemetry.trackTaskCompleted(prevTaskRef.current.id, duration, stats)
			logs.debug("Task completed", "useTelemetryTracking", {
				taskId: prevTaskRef.current.id,
				duration,
			})
		}

		prevTaskRef.current = currentTask
	}, [currentTask, chatMessages])

	// Track extension state changes
	useEffect(() => {
		if (extensionState) {
			// Track extension messages received
			logs.debug("Extension state updated", "useTelemetryTracking")
		}
	}, [extensionState])
}

/**
 * Hook to track errors globally
 */
export function useErrorTracking() {
	useEffect(() => {
		const handleError = (event: ErrorEvent) => {
			getTelemetryService().trackException(event.error, "global", true)
		}

		const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
			const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason))
			getTelemetryService().trackException(error, "unhandled_rejection", true)
		}

		window.addEventListener("error", handleError)
		window.addEventListener("unhandledrejection", handleUnhandledRejection)

		return () => {
			window.removeEventListener("error", handleError)
			window.removeEventListener("unhandledrejection", handleUnhandledRejection)
		}
	}, [])
}
