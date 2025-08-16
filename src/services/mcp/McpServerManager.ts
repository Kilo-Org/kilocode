import * as vscode from "vscode"
import { McpHub } from "./McpHub"
import { ClineProvider } from "../../core/webview/ClineProvider"

/**
 * Singleton manager for MCP server instances.
 * Ensures only one set of MCP servers runs across all webviews.
 */
export class McpServerManager {
	private static instance: McpHub | null = null
	private static readonly GLOBAL_STATE_KEY = "mcpHubInstanceId"
	private static providers: Set<ClineProvider> = new Set()
	private static initializationPromise: Promise<McpHub> | null = null

	/**
	 * Get the singleton McpHub instance.
	 * Creates a new instance if one doesn't exist.
	 * Thread-safe implementation using a promise-based lock.
	 */
	static async getInstance(context: vscode.ExtensionContext, provider: ClineProvider): Promise<McpHub> {
		// Register the provider
		this.providers.add(provider)

		// If we already have an instance, return it immediately
		if (this.instance) {
			this.instance.registerClient()
			return this.instance
		}

		// If initialization is in progress, wait for it
		if (this.initializationPromise) {
			const instance = await this.initializationPromise
			instance.registerClient()
			return instance
		}

		// Atomically create and assign the initialization promise to prevent race conditions
		this.initializationPromise = this.createInstance(context, provider)

		try {
			const instance = await this.initializationPromise
			instance.registerClient()
			return instance
		} catch (error) {
			// If initialization fails, clear the promise to allow retry
			this.initializationPromise = null
			throw error
		}
	}

	/**
	 * Private method to create a new McpHub instance.
	 * This method ensures atomic creation and prevents multiple instances.
	 */
	private static async createInstance(context: vscode.ExtensionContext, provider: ClineProvider): Promise<McpHub> {
		try {
			// Double-check pattern: verify instance doesn't exist within the promise
			if (this.instance) {
				return this.instance
			}

			console.log("[McpServerManager] Creating new McpHub instance")
			this.instance = new McpHub(provider)

			// Store a unique identifier in global state to track the primary instance
			await context.globalState.update(this.GLOBAL_STATE_KEY, Date.now().toString())

			console.log("[McpServerManager] McpHub instance created successfully")
			return this.instance
		} finally {
			// Clear the initialization promise after completion (success or failure)
			this.initializationPromise = null
		}
	}

	/**
	 * Remove a provider from the tracked set and unregister it from the hub.
	 * This is called when a webview is disposed.
	 */
	static async unregisterProvider(provider: ClineProvider): Promise<void> {
		this.providers.delete(provider)

		// Unregister the client from the hub if it exists
		if (this.instance) {
			await this.instance.unregisterClient()
		}
	}

	/**
	 * Notify all registered providers of server state changes.
	 */
	static notifyProviders(message: any): void {
		this.providers.forEach((provider) => {
			provider.postMessageToWebview(message).catch((error) => {
				console.error("Failed to notify provider:", error)
			})
		})
	}

	/**
	 * Clean up the singleton instance and all its resources.
	 */
	static async cleanup(context: vscode.ExtensionContext): Promise<void> {
		if (this.instance) {
			await this.instance.dispose()
			this.instance = null
			await context.globalState.update(this.GLOBAL_STATE_KEY, undefined)
		}
		this.providers.clear()
	}
}
