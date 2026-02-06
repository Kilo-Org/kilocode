import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import {
	LoggingMessageNotificationSchema,
	ResourceListChangedNotificationSchema,
	ToolListChangedNotificationSchema,
	PromptListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js"
import * as vscode from "vscode"

// Define LogLevel explicitly to avoid deep type inference issues
export type LogLevel = "debug" | "info" | "notice" | "warning" | "error" | "critical" | "alert" | "emergency"

/**
 * Callback type for refreshing server capabilities when the MCP server
 * notifies us that tools, resources, or prompts have changed.
 */
export type RefreshCapabilitiesCallback = (serverName: string) => Promise<void>

export class NotificationService {
	/**
	 * Connect notification handlers to an MCP client.
	 *
	 * @param name - The name of the MCP server (for logging purposes)
	 * @param client - The MCP client to attach handlers to
	 * @param onRefreshCapabilities - Optional callback to refresh server capabilities
	 *        when the server notifies us of changes to tools, resources, or prompts
	 */
	connect(name: string, client: Client, onRefreshCapabilities?: RefreshCapabilitiesCallback): void {
		// Handle logging messages from the server - these are intended for users
		client.setNotificationHandler(LoggingMessageNotificationSchema, async (notification) => {
			const params = notification.params || {}
			const level = params.level || "info"
			// `LoggingMessageNotificationSchema` defines `data`, not `message`.
			// Keep backwards/compat handling by accepting either.
			const data = (params as any).data || (params as any).message || ""
			const logger = params.logger || ""
			const dataPrefix = logger ? `[${logger}]` : ``
			const message = `MCP ${name}: ${dataPrefix}${data}`

			switch (level) {
				case "critical":
				case "emergency":
				case "error":
					vscode.window.showErrorMessage(message)
					break
				case "alert":
				case "warning":
					vscode.window.showWarningMessage(message)
					break
				default:
					vscode.window.showInformationMessage(message)
			}
		})

		// Handle resource list changes - refresh capabilities silently
		client.setNotificationHandler(ResourceListChangedNotificationSchema, async () => {
			console.log(`MCP ${name}: resources list changed, refreshing capabilities`)
			try {
				await onRefreshCapabilities?.(name)
			} catch (error) {
				console.error(`MCP ${name}: failed to refresh capabilities after resource list change:`, error)
			}
		})

		// Handle tool list changes - refresh capabilities silently
		client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
			console.log(`MCP ${name}: tools list changed, refreshing capabilities`)
			try {
				await onRefreshCapabilities?.(name)
			} catch (error) {
				console.error(`MCP ${name}: failed to refresh capabilities after tool list change:`, error)
			}
		})

		// Handle prompt list changes - refresh capabilities silently
		client.setNotificationHandler(PromptListChangedNotificationSchema, async () => {
			console.log(`MCP ${name}: prompts list changed, refreshing capabilities`)
			try {
				await onRefreshCapabilities?.(name)
			} catch (error) {
				console.error(`MCP ${name}: failed to refresh capabilities after prompt list change:`, error)
			}
		})

		// Fallback for any other unhandled notifications - log silently, don't notify user
		// This prevents raw JSON-RPC messages from being displayed as VS Code notifications
		client.fallbackNotificationHandler = async (notification) => {
			console.log(`MCP ${name}: unhandled notification`, notification)
		}
	}
}
