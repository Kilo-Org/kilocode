import { vscode } from "@src/utils/vscode"
import type { GlobalState } from "@roo-code/types"
import { GlobalStateValue } from "@roo/WebviewMessage"

/**
 * Type-safe helper for sending global state updates from the WebView
 */
export function updateHostGlobalState<K extends keyof GlobalState>(stateKey: K, stateValue: GlobalStateValue<K>): void {
	vscode.postMessage({ type: "updateGlobalState", stateKey, stateValue })
}
