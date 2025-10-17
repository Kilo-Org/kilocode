import type { GlobalState } from "../../packages/types/src/global-settings.js"
import { isGlobalStateKey } from "../../packages/types/src/global-settings.js"

/**
 * Utility type to extract the value type for a specific GlobalState key
 */
export type GlobalStateValue<K extends keyof GlobalState> = GlobalState[K]

/**
 * Type-safe global state update payload
 * Ensures that the stateKey exists in GlobalState and the value matches the expected type
 */
export type GlobalStateUpdatePayload<K extends keyof GlobalState = keyof GlobalState> = {
	stateKey: K
	stateValue: GlobalStateValue<K>
}

/**
 * Type guard to check if a key is a valid GlobalState key
 * Uses the existing isGlobalStateKey function from global-settings.ts
 */
export function isValidGlobalStateKey(key: string): key is keyof GlobalState {
	return isGlobalStateKey(key)
}

/**
 * Type-safe helper for creating global state update messages
 * This function ensures compile-time type safety for stateKey-value pairs
 */
export function createGlobalStateUpdate<K extends keyof GlobalState>(
	stateKey: K,
	stateValue: GlobalStateValue<K>,
): GlobalStateUpdatePayload<K> {
	return { stateKey, stateValue }
}
