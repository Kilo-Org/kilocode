// kilocode_change - new file
import * as vscode from "vscode"

export interface FileModificationEvent {
	filePath: string
	absolutePath: string
	operation: "create" | "modify" | "delete"
	source: "vscode_api" | "filesystem"
}

export interface FileModificationListener {
	(event: FileModificationEvent): void | Promise<void>
}

/**
 * Service for notifying other extensions about file modifications.
 * This service manages VSCode command execution and event listeners
 * for file modification events.
 *
 * The service uses a default command ID "kilocode.EditFile" which other
 * extensions can listen to and handle. The command is always executed
 * regardless of whether it's registered, allowing external extensions
 * to handle the event.
 *
 * ## Usage
 *
 * ```typescript
 * // Notify about a file modification
 * await FileModificationNotificationService.getInstance().notifyFileModified({
 *   filePath: "src/index.ts",
 *   absolutePath: "/path/to/src/index.ts",
 *   operation: "modify"
 * })
 *
 * // Listen for file modifications
 * FileModificationNotificationService.getInstance().onFileModified((event) => {
 *   console.log(`File ${event.filePath} was ${event.operation}d`)
 * })
 * ```
 */
export class FileModificationNotificationService {
	private static instance: FileModificationNotificationService
	private static readonly DEFAULT_COMMAND_ID = "kilocode.EditFile"

	private listeners: Set<FileModificationListener> = new Set()
	private commandId: string = FileModificationNotificationService.DEFAULT_COMMAND_ID

	private constructor() {}

	/**
	 * Get the singleton instance of the service
	 */
	static getInstance(): FileModificationNotificationService {
		if (!FileModificationNotificationService.instance) {
			FileModificationNotificationService.instance = new FileModificationNotificationService()
		}
		return FileModificationNotificationService.instance
	}

	/**
	 * Set the VSCode command ID to execute when files are modified.
	 * The command will be called with the file modification event as an argument.
	 *
	 * @param commandId - The VSCode command ID to execute (defaults to "kilocode.EditFile")
	 */
	setCommandId(commandId: string): void {
		this.commandId = commandId
	}

	/**
	 * Get the currently configured command ID
	 */
	getCommandId(): string {
		return this.commandId
	}

	/**
	 * Register a listener for file modification events
	 *
	 * @param listener - Callback function to invoke on file modifications
	 * @returns Disposable to unregister the listener
	 */
	onFileModified(listener: FileModificationListener): vscode.Disposable {
		this.listeners.add(listener)

		return {
			dispose: () => {
				this.listeners.delete(listener)
			},
		}
	}

	/**
	 * Notify about a file modification event.
	 * This will:
	 * 1. Execute the VSCode command (even if not registered, allowing external extensions to handle it)
	 * 2. Invoke all registered listeners
	 *
	 * @param event - The file modification event
	 */
	async notifyFileModified(event: FileModificationEvent): Promise<void> {
		try {
			// Execute VSCode command - don't fail if command is not registered
			// External extensions can listen to this command
			await this.executeCommand(event)

			// Invoke all registered listeners
			await this.invokeListeners(event)
		} catch (error) {
			console.error("[FileModificationNotificationService] Error notifying file modification:", error)
		}
	}

	/**
	 * Execute the VSCode command with the file modification event.
	 * The command is executed regardless of whether it's registered,
	 * allowing external extensions to handle the event.
	 *
	 * @param event - The file modification event
	 */
	private async executeCommand(event: FileModificationEvent): Promise<void> {
		try {
			// Execute the command with the event as argument
			// External extensions can register handlers for this command
			await vscode.commands.executeCommand(this.commandId, event)
		} catch (error) {
			// Log but don't fail - the command may not be registered yet
			// External extensions will handle it when they're ready
			console.debug(
				`[FileModificationNotificationService] Command '${this.commandId}' not handled (this is expected if no extension is listening):`,
				error instanceof Error ? error.message : String(error),
			)
		}
	}

	/**
	 * Invoke all registered listeners
	 *
	 * @param event - The file modification event
	 */
	private async invokeListeners(event: FileModificationEvent): Promise<void> {
		const promises: Promise<void>[] = []

		for (const listener of this.listeners) {
			try {
				const result = listener(event)
				if (result instanceof Promise) {
					promises.push(result)
				}
			} catch (error) {
				console.error("[FileModificationNotificationService] Listener error:", error)
			}
		}

		// Wait for all async listeners to complete
		if (promises.length > 0) {
			await Promise.all(promises).catch((error) => {
				console.error("[FileModificationNotificationService] Error waiting for listeners:", error)
			})
		}
	}

	/**
	 * Clear all registered listeners
	 */
	clearListeners(): void {
		this.listeners.clear()
	}

	/**
	 * Dispose the service and clean up resources
	 */
	dispose(): void {
		this.listeners.clear()
		this.commandId = FileModificationNotificationService.DEFAULT_COMMAND_ID
	}
}
