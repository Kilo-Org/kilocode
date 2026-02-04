/**
 * Interface defining the contract that an ExtensionHost must implement
 * to work with the vscode-shim WindowAPI.
 *
 * This interface is used implicitly by WindowAPI when accessing global.__extensionHost.
 * The ExtensionHost implementation (e.g., in apps/cli) must satisfy this contract.
 */

import type { WebviewViewProvider } from "./webview.js"

/**
 * Core event map for ExtensionHost communication.
 * Maps event names to their payload types.
 *
 * - "extensionWebviewMessage": Messages from the extension to the webview/CLI
 * - "webviewMessage": Messages from the webview/CLI to the extension
 */
export interface ExtensionHostEventMap {
	extensionWebviewMessage: unknown
	webviewMessage: unknown
}

/**
 * Allowed event names for ExtensionHost communication.
 */
export type ExtensionHostEventName = keyof ExtensionHostEventMap

/**
 * ExtensionHost interface for bridging the vscode-shim with the actual extension host.
 *
 * The ExtensionHost acts as a message broker between the extension and the CLI/webview,
 * providing event-based communication and webview provider registration.
 *
 * @template TEventMap - Event map type that must include the core ExtensionHostEventMap events.
 *                       Implementations can extend this with additional events.
 */
export interface IExtensionHost<TEventMap extends ExtensionHostEventMap = ExtensionHostEventMap> {
	/**
	 * Register a webview view provider with a specific view ID.
	 * Called by WindowAPI.registerWebviewViewProvider to allow the extension host
	 * to track registered providers.
	 *
	 * @param viewId - The unique identifier for the webview view
	 * @param provider - The webview view provider to register
	 */
	registerWebviewProvider(viewId: string, provider: WebviewViewProvider): void

	/**
	 * Unregister a previously registered webview view provider.
	 * Called when disposing of a webview registration.
	 *
	 * @param viewId - The unique identifier of the webview view to unregister
	 */
	unregisterWebviewProvider(viewId: string): void

	/**
	 * Check if the extension host is in its initial setup phase.
	 * Used to determine if certain actions should be deferred until setup completes.
	 *
	 * @returns true if initial setup is in progress, false otherwise
	 */
	isInInitialSetup(): boolean

	/**
	 * Mark the webview as ready, signaling that initial setup has completed.
	 * This should be called after resolveWebviewView completes successfully.
	 */
	markWebviewReady(): void

	/**
	 * Emit an event to registered listeners.
	 * Used for forwarding messages from the extension to the webview/CLI.
	 *
	 * @param event - The event name to emit
	 * @param message - The message payload to send with the event
	 * @returns true if the event had listeners, false otherwise
	 */
	emit<K extends keyof TEventMap>(event: K, message: TEventMap[K]): boolean

	/**
	 * Register a listener for an event.
	 * Used for receiving messages from the webview/CLI to the extension.
	 *
	 * @param event - The event name to listen for
	 * @param listener - The callback function to invoke when the event is emitted
	 * @returns The ExtensionHost instance for chaining
	 */
	on<K extends keyof TEventMap>(event: K, listener: (message: TEventMap[K]) => void): this
}
