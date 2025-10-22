/**
 * Kitty protocol handling utilities
 */

import type { Key } from "../../types/keyboard.js"
import { ESC, MAX_KITTY_SEQUENCE_LENGTH } from "../../constants/keyboard/index.js"
import { parseKittySequence } from "./parsing.js"
import { logs } from "../../services/logs.js"

/**
 * State for Kitty sequence buffering
 */
export interface KittyBufferState {
	buffer: string
}

/**
 * Create initial Kitty buffer state
 */
export function createKittyBufferState(): KittyBufferState {
	return {
		buffer: "",
	}
}

/**
 * Try to parse a Kitty sequence directly
 * Returns the parsed key if successful, null otherwise
 */
export function tryParseKittySequence(sequence: string, isDebugEnabled: boolean): Key | null {
	const result = parseKittySequence(sequence)

	if (result.key && isDebugEnabled) {
		logs.debug("Kitty sequence parsed", "KittyProtocolHelpers", { key: result.key })
	}

	return result.key
}

/**
 * Process accumulated Kitty buffer and extract all parseable sequences
 * Returns array of parsed keys and the remaining unparsed buffer
 */
export function processKittyBuffer(buffer: string, isDebugEnabled: boolean): { keys: Key[]; remainingBuffer: string } {
	const keys: Key[] = []
	let currentBuffer = buffer

	while (currentBuffer) {
		const result = parseKittySequence(currentBuffer)

		if (!result.key) {
			// Look for next CSI start
			const nextStart = currentBuffer.indexOf(ESC, 1)
			if (nextStart > 0) {
				if (isDebugEnabled) {
					logs.debug("Skipping incomplete sequence, looking for next CSI", "KittyProtocolHelpers")
				}
				currentBuffer = currentBuffer.slice(nextStart)
				continue
			}
			break
		}

		// Successfully parsed a key
		if (isDebugEnabled) {
			logs.debug("Kitty buffer parsed", "KittyProtocolHelpers", { key: result.key })
		}

		keys.push(result.key)
		currentBuffer = currentBuffer.slice(result.consumedLength)
	}

	return { keys, remainingBuffer: currentBuffer }
}

/**
 * Check if buffer has overflowed and should be cleared
 */
export function isBufferOverflow(buffer: string, isDebugEnabled: boolean): boolean {
	if (buffer.length > MAX_KITTY_SEQUENCE_LENGTH) {
		if (isDebugEnabled) {
			logs.warn("Kitty buffer overflow, clearing", "KittyProtocolHelpers", { buffer })
		}
		return true
	}
	return false
}

/**
 * Handle a Kitty protocol sequence
 * Returns array of parsed keys, or empty array if sequence needs more data
 */
export function handleKittySequence(sequence: string, state: KittyBufferState, isDebugEnabled: boolean): Key[] {
	// Try to parse the sequence directly first
	const directKey = tryParseKittySequence(sequence, isDebugEnabled)
	if (directKey) {
		return [directKey]
	}

	// If not parsed, accumulate in buffer
	state.buffer += sequence

	// Try to parse accumulated buffer
	const { keys, remainingBuffer } = processKittyBuffer(state.buffer, isDebugEnabled)

	if (keys.length > 0) {
		// Successfully parsed some keys
		state.buffer = remainingBuffer
		return keys
	}

	// Check for buffer overflow
	if (isBufferOverflow(state.buffer, isDebugEnabled)) {
		state.buffer = ""
		return []
	}

	// Wait for more data
	return []
}

/**
 * Clear the Kitty buffer
 */
export function clearKittyBuffer(state: KittyBufferState): void {
	state.buffer = ""
}
