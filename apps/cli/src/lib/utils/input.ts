/**
 * Global Input Sequences Registry
 *
 * This module centralizes the definition of input sequences that should be
 * handled at the App level (or other top-level components) and ignored by
 * child components like MultilineTextInput.
 *
 * When adding new global shortcuts:
 * 1. Add the sequence definition to GLOBAL_INPUT_SEQUENCES
 * 2. The App.tsx useInput handler should check for and handle the sequence
 * 3. Child components automatically ignore these via isGlobalInputSequence()
 */

import type { Key } from "ink"

/**
 * Definition of a global input sequence
 */
export interface GlobalInputSequence {
	/** Unique identifier for the sequence */
	id: string
	/** Human-readable description */
	description: string
	/**
	 * Matcher function - returns true if the input matches this sequence.
	 * @param input - The raw input string from useInput
	 * @param key - The parsed key object from useInput
	 */
	matches: (input: string, key: Key) => boolean
}

/**
 * Registry of all global input sequences that should be handled at the App level
 * and ignored by child components (like MultilineTextInput).
 *
 * Add new global shortcuts here to ensure they're properly handled throughout
 * the application.
 */
export const GLOBAL_INPUT_SEQUENCES: GlobalInputSequence[] = [
	{
		id: "ctrl-c",
		description: "Exit application (with confirmation)",
		matches: (input, key) => key.ctrl && input === "c",
	},
	{
		id: "ctrl-m",
		description: "Cycle through modes",
		matches: (input, key) => {
			// Standard Ctrl+M detection
			if (key.ctrl && input === "m") return true
			// CSI u encoding: ESC [ 109 ; 5 u (kitty keyboard protocol)
			// 109 = 'm' ASCII code, 5 = Ctrl modifier
			if (input === "\x1b[109;5u") return true
			if (input.endsWith("[109;5u")) return true
			return false
		},
	},
	{
		id: "ctrl-t",
		description: "Toggle TODO list viewer",
		matches: (input, key) => {
			// Standard Ctrl+T detection
			if (key.ctrl && input === "t") return true
			// CSI u encoding: ESC [ 116 ; 5 u (kitty keyboard protocol)
			// 116 = 't' ASCII code, 5 = Ctrl modifier
			if (input === "\x1b[116;5u") return true
			if (input.endsWith("[116;5u")) return true
			return false
		},
	},
	// Add more global sequences here as needed:
	// {
	//   id: "ctrl-n",
	//   description: "New task",
	//   matches: (input, key) => key.ctrl && input === "n",
	// },
]

/**
 * Check if an input matches any global input sequence.
 *
 * Use this in child components (like MultilineTextInput) to determine
 * if input should be ignored because it will be handled by a parent component.
 *
 * @param input - The raw input string from useInput
 * @param key - The parsed key object from useInput
 * @returns The matching GlobalInputSequence, or undefined if no match
 *
 * @example
 * ```tsx
 * useInput((input, key) => {
 *   // Ignore inputs handled at App level
 *   if (isGlobalInputSequence(input, key)) {
 *     return
 *   }
 *   // Handle component-specific input...
 * })
 * ```
 */
export function isGlobalInputSequence(input: string, key: Key): GlobalInputSequence | undefined {
	return GLOBAL_INPUT_SEQUENCES.find((seq) => seq.matches(input, key))
}

/**
 * Check if an input matches a specific global input sequence by ID.
 *
 * @param input - The raw input string from useInput
 * @param key - The parsed key object from useInput
 * @param id - The sequence ID to check for
 * @returns true if the input matches the specified sequence
 *
 * @example
 * ```tsx
 * if (matchesGlobalSequence(input, key, "ctrl-m")) {
 *   // Handle mode cycling
 * }
 * ```
 */
export function matchesGlobalSequence(input: string, key: Key, id: string): boolean {
	const seq = GLOBAL_INPUT_SEQUENCES.find((s) => s.id === id)
	return seq ? seq.matches(input, key) : false
}
