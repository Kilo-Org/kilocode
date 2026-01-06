/**
 * Hook to handle JSON messages from stdin in jsonInteractive mode.
 * This enables bidirectional communication with the Agent Manager.
 */

import { useEffect, useRef } from "react"
import { useSetAtom, useAtomValue } from "jotai"
import { createInterface } from "readline"
import { sendAskResponseAtom, cancelTaskAtom, respondToToolAtom } from "../atoms/actions.js"
import { isServiceReadyAtom } from "../atoms/service.js"
import { isStreamingAtom } from "../atoms/ui.js"
import { isApprovalPendingAtom } from "../atoms/approval.js"
import { clearStdinQueueSignalAtom } from "../atoms/queuedMessages.js"
import wait from "../../utils/wait.js"
import { SequentialWorkQueue } from "../../utils/sequential-work-queue.js"
import { createStateChangeWaiter, type StateChangeWaiter } from "../../utils/state-change-waiter.js"
import { logs } from "../../services/logs.js"

export interface StdinMessage {
	type: string
	askResponse?: string
	text?: string
	images?: string[]
	approved?: boolean
}

export interface StdinMessageHandlers {
	sendAskResponse: (params: { response: "messageResponse"; text?: string; images?: string[] }) => Promise<void>
	cancelTask: () => Promise<void>
	respondToTool: (params: {
		response: "yesButtonClicked" | "noButtonClicked"
		text?: string
		images?: string[]
	}) => Promise<void>
}

/**
 * Handles a parsed stdin message by calling the appropriate handler.
 * Exported for testing purposes.
 */
export async function handleStdinMessage(
	message: StdinMessage,
	handlers: StdinMessageHandlers,
): Promise<{ handled: boolean; error?: string }> {
	switch (message.type) {
		case "askResponse":
			// Handle ask response (user message, approval response, etc.)
			if (message.askResponse === "yesButtonClicked" || message.askResponse === "noButtonClicked") {
				await handlers.respondToTool({
					response: message.askResponse,
					...(message.text !== undefined && { text: message.text }),
					...(message.images !== undefined && { images: message.images }),
				})
			} else {
				await handlers.sendAskResponse({
					response: (message.askResponse as "messageResponse") ?? "messageResponse",
					...(message.text !== undefined && { text: message.text }),
					...(message.images !== undefined && { images: message.images }),
				})
			}
			return { handled: true }

		case "cancelTask":
			await handlers.cancelTask()
			return { handled: true }

		case "respondToApproval":
			// Handle approval response (yes/no for tool use)
			// This is a convenience API that maps approved: boolean to the internal response format
			if (message.approved) {
				await handlers.respondToTool({
					response: "yesButtonClicked",
					...(message.text !== undefined && { text: message.text }),
				})
			} else {
				await handlers.respondToTool({
					response: "noButtonClicked",
					...(message.text !== undefined && { text: message.text }),
				})
			}
			return { handled: true }

		default:
			return { handled: false, error: `Unknown message type: ${message.type}` }
	}
}

export interface StdinMessageQueueState {
	isServiceReady: boolean
	isStreaming: boolean
	isApprovalPending: boolean
}

export interface QueuedStdinMessageProcessorOptions {
	pollIntervalMs?: number
	reactionStartTimeoutMs?: number
	reactionDoneTimeoutMs?: number
	maxAttempts?: number
	waitForStateChange?: () => Promise<void>
}

export interface QueuedStdinMessageProcessor {
	enqueue: (message: StdinMessage) => void
	notify: () => void
	clear: () => void
	dispose: () => void
}

function isRetryableStdinHandlerError(error: unknown): boolean {
	if (!(error instanceof Error)) return true
	const msg = error.message.toLowerCase()
	return msg.includes("extensionservice not ready") || msg.includes("not available") || msg.includes("disposed")
}

function isAgentAffectingStdinMessage(message: StdinMessage): boolean {
	if (message.type === "askResponse") return true
	if (message.type === "respondToApproval") return true
	return false
}

async function waitForAgentReaction(params: {
	getState: () => StdinMessageQueueState
	pollIntervalMs: number
	reactionStartTimeoutMs: number
	reactionDoneTimeoutMs: number
	waitForStateChange?: () => Promise<void>
}): Promise<void> {
	const { getState, pollIntervalMs, reactionStartTimeoutMs, reactionDoneTimeoutMs, waitForStateChange } = params

	const waitTick = async () => {
		if (waitForStateChange) {
			await Promise.race([waitForStateChange(), wait(pollIntervalMs)])
			return
		}
		await wait(pollIntervalMs)
	}

	const startDeadline = Date.now() + reactionStartTimeoutMs
	while (Date.now() < startDeadline) {
		const state = getState()
		if (state.isApprovalPending) return
		if (state.isStreaming) break
		await waitTick()
	}

	const doneDeadline = Date.now() + reactionDoneTimeoutMs
	while (Date.now() < doneDeadline) {
		const state = getState()
		if (state.isApprovalPending) return
		if (!state.isStreaming) return
		await waitTick()
	}
}

export function createQueuedStdinMessageProcessor(params: {
	getState: () => StdinMessageQueueState
	handlers: StdinMessageHandlers
	options?: QueuedStdinMessageProcessorOptions
}): QueuedStdinMessageProcessor {
	const pollIntervalMs = params.options?.pollIntervalMs ?? 25
	const reactionStartTimeoutMs = params.options?.reactionStartTimeoutMs ?? 10_000
	const reactionDoneTimeoutMs = params.options?.reactionDoneTimeoutMs ?? 10 * 60_000
	const maxAttempts = params.options?.maxAttempts ?? 50
	const waitForStateChange = params.options?.waitForStateChange

	const queue = new SequentialWorkQueue<StdinMessage>({
		canProcess: ({ value }) => {
			const state = params.getState()

			// Unknown message types can be dropped immediately (no dependency on agent state).
			if (value.type !== "askResponse" && value.type !== "cancelTask" && value.type !== "respondToApproval") {
				return true
			}

			if (value.type === "cancelTask") {
				return true
			}

			if (!state.isServiceReady) {
				return false
			}

			if (value.type === "respondToApproval") {
				return state.isApprovalPending
			}

			if (value.type === "askResponse") {
				const askResponse = value.askResponse
				if (askResponse === "yesButtonClicked" || askResponse === "noButtonClicked") {
					return state.isApprovalPending
				}

				// messageResponse: only send when the agent isn't streaming and no approval is pending.
				return !state.isStreaming && !state.isApprovalPending
			}

			return true
		},
		process: async ({ value }) => {
			const result = await handleStdinMessage(value, params.handlers)
			if (!result.handled) {
				logs.warn("Unknown stdin message type", "QueuedStdinMessageProcessor", { type: value.type })
				return
			}

			if (isAgentAffectingStdinMessage(value)) {
				await waitForAgentReaction({
					getState: params.getState,
					pollIntervalMs,
					reactionStartTimeoutMs,
					reactionDoneTimeoutMs,
					...(waitForStateChange ? { waitForStateChange } : {}),
				})
			}
		},
		shouldRetry: ({ item, error }) => {
			if (item.attempts >= maxAttempts) return false
			return isRetryableStdinHandlerError(error)
		},
		onDrop: ({ item, error }) => {
			logs.error("Dropping stdin message after retries", "QueuedStdinMessageProcessor", {
				type: item.value.type,
				attempts: item.attempts,
				error: error instanceof Error ? error.message : String(error),
			})
		},
	})

	return {
		enqueue: (message) => {
			if (message.type === "cancelTask") {
				queue.clear()
			}
			queue.enqueue(message)
		},
		notify: () => queue.notify(),
		clear: () => queue.clear(),
		dispose: () => queue.dispose(),
	}
}

export function useStdinJsonHandler(enabled: boolean) {
	const sendAskResponse = useSetAtom(sendAskResponseAtom)
	const cancelTask = useSetAtom(cancelTaskAtom)
	const respondToTool = useSetAtom(respondToToolAtom)
	const isServiceReady = useAtomValue(isServiceReadyAtom)
	const isStreaming = useAtomValue(isStreamingAtom)
	const isApprovalPending = useAtomValue(isApprovalPendingAtom)
	const clearSignal = useAtomValue(clearStdinQueueSignalAtom)
	const stateRef = useRef<StdinMessageQueueState>({
		isServiceReady,
		isStreaming,
		isApprovalPending,
	})
	const stateChangeWaiterRef = useRef<StateChangeWaiter>(createStateChangeWaiter())
	const processorRef = useRef<QueuedStdinMessageProcessor | null>(null)

	useEffect(() => {
		stateRef.current = {
			isServiceReady,
			isStreaming,
			isApprovalPending,
		}
		stateChangeWaiterRef.current.notifyChanged()
		processorRef.current?.notify()
	}, [isServiceReady, isStreaming, isApprovalPending])

	useEffect(() => {
		processorRef.current?.clear()
		stateChangeWaiterRef.current.notifyChanged()
	}, [clearSignal])

	useEffect(() => {
		if (!enabled) {
			return
		}

		logs.debug("Starting stdin JSON handler", "useStdinJsonHandler")

		const rl = createInterface({
			input: process.stdin,
			terminal: false,
		})

		const handlers: StdinMessageHandlers = {
			sendAskResponse: async (params) => {
				await sendAskResponse(params)
			},
			cancelTask: async () => {
				await cancelTask()
			},
			respondToTool: async (params) => {
				await respondToTool(params)
			},
		}

		const processor = createQueuedStdinMessageProcessor({
			getState: () => stateRef.current,
			handlers,
			options: {
				waitForStateChange: () => stateChangeWaiterRef.current.waitForChange(),
			},
		})
		processorRef.current = processor

		const handleLine = async (line: string) => {
			const trimmed = line.trim()
			if (!trimmed) return

			try {
				const message: StdinMessage = JSON.parse(trimmed)
				logs.debug("Received stdin message", "useStdinJsonHandler", { type: message.type })
				processor.enqueue(message)
			} catch (error) {
				logs.error("Failed to parse stdin JSON", "useStdinJsonHandler", {
					error: error instanceof Error ? error.message : String(error),
					line: trimmed.slice(0, 100),
				})
			}
		}

		rl.on("line", handleLine)

		rl.on("close", () => {
			logs.debug("Stdin closed", "useStdinJsonHandler")
		})

		rl.on("error", (error) => {
			logs.error("Stdin error", "useStdinJsonHandler", {
				error: error instanceof Error ? error.message : String(error),
			})
		})

		return () => {
			processor.dispose()
			processorRef.current = null
			rl.close()
		}
	}, [
		enabled,
		sendAskResponse,
		cancelTask,
		respondToTool,
	])
}
