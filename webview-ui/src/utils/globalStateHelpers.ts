import { vscode } from "@src/utils/vscode"
import type { GlobalState } from "@roo-code/types"
import { createGlobalStateUpdate, type GlobalStateValue } from "@roo/GlobalStateTypes"

/**
 * Type-safe helper for sending global state updates from the WebView
 * This ensures compile-time type safety when updating global state
 */
export function updateHostGlobalState<K extends keyof GlobalState>(stateKey: K, stateValue: GlobalStateValue<K>): void {
	const updatePayload = createGlobalStateUpdate(stateKey, stateValue)
	vscode.postMessage({ type: "updateGlobalState", ...updatePayload })
}
