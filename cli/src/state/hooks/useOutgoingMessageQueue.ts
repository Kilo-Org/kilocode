import { useCallback, useEffect, useMemo, useRef } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import { isServiceReadyAtom } from "../atoms/service.js"
import { isStreamingAtom } from "../atoms/ui.js"
import { isApprovalPendingAtom } from "../atoms/approval.js"
import wait from "../../utils/wait.js"
import { SequentialWorkQueue } from "../../utils/sequential-work-queue.js"
import { useTaskState } from "./useTaskState.js"
import { useWebviewMessage } from "./useWebviewMessage.js"
import { logs } from "../../services/logs.js"
import { clearOutgoingQueueSignalAtom, queuedUserMessagesAtom } from "../atoms/queuedMessages.js"

interface StateChangeWaiter {
	waitForChange: () => Promise<void>
	notifyChanged: () => void
}

function createStateChangeWaiter(): StateChangeWaiter {
	let resolve: (() => void) | undefined
	let promise = new Promise<void>((r) => {
		resolve = r
	})

	return {
		waitForChange: () => promise,
		notifyChanged: () => {
			resolve?.()
			promise = new Promise<void>((r) => {
				resolve = r
			})
		},
	}
}

export interface OutgoingUserMessage {
	id: string
	text: string
	images?: string[]
	enqueuedAt: number
}

export interface EnqueueOutgoingUserMessageParams {
	text: string
	images?: string[]
}

export interface OutgoingMessageQueueState {
	isServiceReady: boolean
	isStreaming: boolean
	isApprovalPending: boolean
	hasActiveTask: boolean
}

export interface OutgoingMessageHandlers {
	sendNewTask: (params: { text: string; images?: string[] }) => Promise<void>
	sendAskResponse: (params: { response: "messageResponse"; text?: string; images?: string[] }) => Promise<void>
}

export interface OutgoingMessageQueueCallbacks {
	onDelivered?: (messageId: string) => void
	onDropped?: (messageId: string) => void
}

export interface QueuedOutgoingMessageProcessorOptions {
	pollIntervalMs?: number
	reactionStartTimeoutMs?: number
	reactionDoneTimeoutMs?: number
	maxAttempts?: number
	/**
	 * Optional event-based wakeup used by the interactive hook.
	 * When provided, waiting yields on state changes (and uses polling only as a fallback timeout).
	 */
	waitForStateChange?: () => Promise<void>
}

export interface QueuedOutgoingMessageProcessor {
	enqueue: (message: OutgoingUserMessage) => void
	notify: () => void
	clear: () => void
	dispose: () => void
}

function isRetryableOutgoingError(error: unknown): boolean {
	if (!(error instanceof Error)) return true
	const msg = error.message.toLowerCase()
	return msg.includes("extensionservice not ready") || msg.includes("not available") || msg.includes("disposed")
}

async function waitForAgentReaction(params: {
	getState: () => OutgoingMessageQueueState
	pollIntervalMs: number
	reactionStartTimeoutMs: number
	reactionDoneTimeoutMs: number
	waitForStateChange?: () => Promise<void>
}): Promise<void> {
	const { getState, pollIntervalMs, reactionStartTimeoutMs, reactionDoneTimeoutMs, waitForStateChange } = params

	const waitTick = async () => {
		// Deadlock safety: we always race state-change wakeups with a bounded timeout.
		// If no state changes occur, the timeout ensures progress until the deadline is reached.
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

export function createQueuedOutgoingMessageProcessor(params: {
	getState: () => OutgoingMessageQueueState
	handlers: OutgoingMessageHandlers
	callbacks?: OutgoingMessageQueueCallbacks
	options?: QueuedOutgoingMessageProcessorOptions
}): QueuedOutgoingMessageProcessor {
	const pollIntervalMs = params.options?.pollIntervalMs ?? 25
	const reactionStartTimeoutMs = params.options?.reactionStartTimeoutMs ?? 10_000
	const reactionDoneTimeoutMs = params.options?.reactionDoneTimeoutMs ?? 10 * 60_000
	const maxAttempts = params.options?.maxAttempts ?? 50
	const waitForStateChange = params.options?.waitForStateChange

	const queue = new SequentialWorkQueue<OutgoingUserMessage>({
		canProcess: () => {
			const state = params.getState()
			return state.isServiceReady && !state.isStreaming && !state.isApprovalPending
		},
		process: async ({ value }) => {
			const state = params.getState()
			if (state.hasActiveTask) {
				await params.handlers.sendAskResponse({
					response: "messageResponse",
					text: value.text,
					...(value.images !== undefined && { images: value.images }),
				})
			} else {
				await params.handlers.sendNewTask({
					text: value.text,
					...(value.images !== undefined && { images: value.images }),
				})
			}

			params.callbacks?.onDelivered?.(value.id)

				await waitForAgentReaction({
					getState: params.getState,
					pollIntervalMs,
					reactionStartTimeoutMs,
					reactionDoneTimeoutMs,
					waitForStateChange,
				})
			},
			shouldRetry: ({ item, error }) => {
				if (item.attempts >= maxAttempts) return false
				return isRetryableOutgoingError(error)
		},
		onDrop: ({ item, error }) => {
			logs.error("Dropping queued outgoing message after retries", "QueuedOutgoingMessageProcessor", {
				attempts: item.attempts,
				error: error instanceof Error ? error.message : String(error),
				preview: item.value.text.slice(0, 100),
			})
			params.callbacks?.onDropped?.(item.value.id)
		},
	})

	return {
		enqueue: (message) => queue.enqueue(message),
		notify: () => queue.notify(),
		clear: () => queue.clear(),
		dispose: () => queue.dispose(),
	}
}

export function useOutgoingMessageQueue(): { enqueue: (message: EnqueueOutgoingUserMessageParams) => void } {
	const isServiceReady = useAtomValue(isServiceReadyAtom)
	const isStreaming = useAtomValue(isStreamingAtom)
	const isApprovalPending = useAtomValue(isApprovalPendingAtom)
	const clearSignal = useAtomValue(clearOutgoingQueueSignalAtom)
	const { hasActiveTask } = useTaskState()
	const { sendMessage, sendAskResponse } = useWebviewMessage()
	const setQueuedUserMessages = useSetAtom(queuedUserMessagesAtom)

	const stateRef = useRef<OutgoingMessageQueueState>({
		isServiceReady,
		isStreaming,
		isApprovalPending,
		hasActiveTask,
	})
	const stateChangeWaiterRef = useRef<StateChangeWaiter>(createStateChangeWaiter())
	const processorRef = useRef<QueuedOutgoingMessageProcessor | null>(null)

	useEffect(() => {
		stateRef.current = {
			isServiceReady,
			isStreaming,
			isApprovalPending,
			hasActiveTask,
		}
		stateChangeWaiterRef.current.notifyChanged()
		processorRef.current?.notify()
	}, [isServiceReady, isStreaming, isApprovalPending, hasActiveTask])

	useEffect(() => {
		const processor = createQueuedOutgoingMessageProcessor({
			getState: () => stateRef.current,
			handlers: {
				sendNewTask: async (params) => {
					await sendMessage({ type: "newTask", ...params })
				},
				sendAskResponse: async (params) => {
					await sendAskResponse(params)
				},
			},
				callbacks: {
					onDelivered: (messageId) => {
						setQueuedUserMessages((prev) => prev.filter((m) => m.id !== messageId))
					},
					onDropped: (messageId) => {
						setQueuedUserMessages((prev) => prev.filter((m) => m.id !== messageId))
					},
				},
				options: {
					waitForStateChange: () => stateChangeWaiterRef.current.waitForChange(),
				},
			})

		processorRef.current = processor

		return () => {
			processor.dispose()
			processorRef.current = null
		}
	}, [sendAskResponse, sendMessage, setQueuedUserMessages])

	useEffect(() => {
		processorRef.current?.clear()
		// Keep atom in sync even if the signal is triggered from outside this hook.
		setQueuedUserMessages([])
		stateChangeWaiterRef.current.notifyChanged()
	}, [clearSignal, setQueuedUserMessages])

	const enqueue = useCallback(
		(message: EnqueueOutgoingUserMessageParams) => {
			const queued: OutgoingUserMessage = {
				id: `queued-${Date.now()}-${Math.random()}`,
				text: message.text,
				...(message.images !== undefined && { images: message.images }),
				enqueuedAt: Date.now(),
			}
			setQueuedUserMessages((prev) => [...prev, queued])
			processorRef.current?.enqueue(queued)
		},
		[setQueuedUserMessages],
	)

	return useMemo(() => ({ enqueue }), [enqueue])
}
