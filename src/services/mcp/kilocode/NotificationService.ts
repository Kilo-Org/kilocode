import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { LoggingMessageNotificationSchema } from "@modelcontextprotocol/sdk/types.js"
import * as vscode from "vscode"

// Define LogLevel explicitly to avoid deep type inference issues
export type LogLevel = "debug" | "info" | "notice" | "warning" | "error" | "critical" | "alert" | "emergency"

export class NotificationService {
	connect(name: string, client: Client): void {
		client.setNotificationHandler(LoggingMessageNotificationSchema, async (notification) => {
			const params = notification.params || {}
			const level = params.level || "info"
			// `LoggingMessageNotificationSchema` defines `data`, not `message`.
			// Keep backwards/compat handling by accepting either.
			const data = (params as any).data || (params as any).message || "" // kilocode_change
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

		client.fallbackNotificationHandler = async (notification) => {
			vscode.window.showInformationMessage(`MCP ${name}: ${JSON.stringify(notification)}`)
		}
	}
}
