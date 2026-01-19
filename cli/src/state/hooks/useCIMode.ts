/**
 * Hook for managing CI mode behavior and exit logic
 * Handles automatic exit when completion conditions are met
 */

import { useAtomValue, useSetAtom } from "jotai"
import { useEffect, useState, useCallback, useRef } from "react"
import {
	ciCompletionDetectedAtom,
	ciCompletionIgnoreBeforeTimestampAtom,
	ciCommandFinishedAtom,
	ciExitReasonAtom,
} from "../atoms/ci.js"
import { taskResumedViaContinueOrSessionAtom } from "../atoms/extension.js"
import { useExtensionMessage } from "./useExtensionMessage.js"
import { logs } from "../../services/logs.js"

/**
 * Options for useCIMode hook
 */
export interface UseCIModeOptions {
	/** Whether CI mode is enabled */
	enabled: boolean
	/** Optional timeout in seconds */
	timeout?: number
	/** Callback to execute when exit conditions are met */
	onExit: () => void
}

/**
 * Return type for useCIMode hook
 */
export interface UseCIModeReturn {
	/** Whether CI mode is active */
	isCIMode: boolean
	/** Whether the CLI should exit */
	shouldExit: boolean
	/** The reason for exiting */
	exitReason: "completion_result" | "command_finished" | "timeout" | null
	/** Mark command execution as finished */
	markCommandFinished: () => void
}

/**
 * Hook for managing CI mode behavior
 *
 * This hook monitors for exit conditions in CI mode:
 * 1. completion_result message received from extension
 * 2. Command/message execution finished
 * 3. Timeout reached (if configured)
 *
 * When any condition is met, it triggers the onExit callback after a brief cleanup delay.
 *
 * @example
 * ```tsx
 * function MyComponent({ options, onExit }) {
 *   const { shouldExit, exitReason } = useCIMode({
 *     enabled: options.ci,
 *     timeout: options.timeout,
 *     onExit: onExit
 *   })
 *
 *   useEffect(() => {
 *     if (shouldExit) {
 *       console.log(`Exiting: ${exitReason}`)
 *       setTimeout(() => onExit(), 100)
 *     }
 *   }, [shouldExit, exitReason, onExit])
 * }
 * ```
 */
export function useCIMode(options: UseCIModeOptions): UseCIModeReturn {
	const { enabled, timeout } = options

	const completionDetected = useAtomValue(ciCompletionDetectedAtom)
	const completionIgnoreBeforeTimestamp = useAtomValue(ciCompletionIgnoreBeforeTimestampAtom)
	const commandFinished = useAtomValue(ciCommandFinishedAtom)
	const taskResumedViaSession = useAtomValue(taskResumedViaContinueOrSessionAtom)
	// Write atoms
	const setCommandFinished = useSetAtom(ciCommandFinishedAtom)
	const setExitReason = useSetAtom(ciExitReasonAtom)

	// Local state
	const [shouldExit, setShouldExit] = useState(false)
	const [localExitReason, setLocalExitReason] = useState<"completion_result" | "command_finished" | "timeout" | null>(
		null,
	)

	// Track if exit has been triggered to prevent multiple calls
	const exitTriggeredRef = useRef(false)
	const timeoutIdRef = useRef<NodeJS.Timeout | null>(null)

	// Get extension messages to monitor for completion_result
	const { lastMessage } = useExtensionMessage()

	const isHistoricalCompletion = lastMessage?.ts !== undefined && lastMessage.ts <= completionIgnoreBeforeTimestamp

	// Monitor for completion_result messages
	useEffect(() => {
		if (!enabled || !lastMessage || exitTriggeredRef.current) return

		// Skip if session was just restored - the completion_result is historical
		if (taskResumedViaSession || isHistoricalCompletion) {
			logs.debug("CI mode: Skipping completion_result check - historical message", "useCIMode")
			return
		}

		// Check if this is a completion_result message
		if (lastMessage.type === "ask" && lastMessage.ask === "completion_result") {
			logs.info("CI mode: completion_result message received", "useCIMode")
			setLocalExitReason("completion_result")
			setExitReason("completion_result")
			setShouldExit(true)
			exitTriggeredRef.current = true
		}
	}, [enabled, lastMessage, taskResumedViaSession, isHistoricalCompletion])

	// Monitor for command finished
	useEffect(() => {
		if (!enabled || !commandFinished || exitTriggeredRef.current) return

		logs.info("CI mode: command execution finished", "useCIMode")
		setLocalExitReason("command_finished")
		setExitReason("command_finished")
		setShouldExit(true)
		exitTriggeredRef.current = true
	}, [enabled, commandFinished])

	// Monitor for completion detected atom (set by message handler)
	useEffect(() => {
		if (!enabled || !completionDetected || exitTriggeredRef.current) return

		// Skip if session was just restored - the completion_result is historical
		if (taskResumedViaSession || isHistoricalCompletion) {
			logs.debug("CI mode: Skipping completion detected atom - historical message", "useCIMode")
			return
		}

		logs.info("CI mode: completion detected via atom", "useCIMode")
		setLocalExitReason("completion_result")
		setExitReason("completion_result")
		setShouldExit(true)
		exitTriggeredRef.current = true
	}, [enabled, completionDetected, taskResumedViaSession, isHistoricalCompletion])

	// Setup timeout if provided
	useEffect(() => {
		if (!enabled || !timeout) return

		logs.info(`CI mode: timeout set to ${timeout} seconds`, "useCIMode")

		timeoutIdRef.current = setTimeout(() => {
			if (!exitTriggeredRef.current) {
				logs.warn(`CI mode: timeout reached after ${timeout} seconds`, "useCIMode")
				setLocalExitReason("timeout")
				setExitReason("timeout")
				setShouldExit(true)
				exitTriggeredRef.current = true
			}
		}, timeout * 1000)

		return () => {
			if (timeoutIdRef.current) {
				clearTimeout(timeoutIdRef.current)
				timeoutIdRef.current = null
			}
		}
	}, [enabled, timeout])

	// Cleanup timeout when exit is triggered
	useEffect(() => {
		if (shouldExit && timeoutIdRef.current) {
			clearTimeout(timeoutIdRef.current)
			timeoutIdRef.current = null
		}
	}, [shouldExit])

	// Mark command as finished (called by command/message handlers)
	const markCommandFinished = useCallback(() => {
		if (enabled) {
			setCommandFinished(true)
		}
	}, [enabled, setCommandFinished])

	return {
		isCIMode: enabled,
		shouldExit,
		exitReason: localExitReason,
		markCommandFinished,
	}
}
