/**
 * CI mode atoms for managing CI-specific state
 * These atoms track CI mode status and exit conditions
 */

import { atom } from "jotai"

/**
 * Atom to track if CI mode is active
 */
export const ciModeAtom = atom<boolean>(false)

/**
 * Atom to store the timeout value in seconds (if provided)
 */
export const ciTimeoutAtom = atom<number | undefined>(undefined)

/**
 * Atom to track if completion_result message was received
 */
export const ciCompletionDetectedAtom = atom<boolean>(false)

/**
 * Ignore completion_result messages at or before this timestamp
 */
export const ciCompletionIgnoreBeforeTimestampAtom = atom<number>(0)

/**
 * Atom to track if command/message execution has finished
 */
export const ciCommandFinishedAtom = atom<boolean>(false)

/**
 * Atom to store the exit reason
 */
export const ciExitReasonAtom = atom<"completion_result" | "command_finished" | "timeout" | null>(null)

/**
 * Action atom to set CI mode configuration
 */
export const setCIModeAtom = atom(null, (get, set, config: { enabled: boolean; timeout?: number }) => {
	set(ciModeAtom, config.enabled)
	set(ciTimeoutAtom, config.timeout)
})

/**
 * Action atom to reset CI state
 */
export const resetCIStateAtom = atom(null, (get, set) => {
	set(ciModeAtom, false)
	set(ciTimeoutAtom, undefined)
	set(ciCompletionDetectedAtom, false)
	set(ciCompletionIgnoreBeforeTimestampAtom, 0)
	set(ciCommandFinishedAtom, false)
	set(ciExitReasonAtom, null)
})
