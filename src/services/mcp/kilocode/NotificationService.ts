import { z } from "zod"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { LoggingMessageNotificationSchema } from "@modelcontextprotocol/sdk/types.js"

export type LogLevel = z.infer<typeof LoggingMessageNotificationSchema>["params"]["level"]

export type NotificationCallback = (message: string) => Promise<void>

export class NotificationService {
	private notificationCallback: NotificationCallback | null = null

	setNotificationCallback(callback: NotificationCallback) {
		if (this.notificationCallback) {
			console.warn("Notification callback is already set. Overriding the existing callback.")
		}
		this.notificationCallback = callback
	}

	clearNotificationCallback(callback: NotificationCallback) {
		if (this.notificationCallback !== callback) {
			console.warn("Notification callback does not match the current callback.")
		} else {
			this.notificationCallback = null
		}
	}

	emojiForLevel(level: LogLevel) {
		switch (level) {
			case "debug":
				return "🐛"
			case "info":
				return "ℹ️"
			case "notice":
				return "📢"
			case "warning":
				return "⚠️"
			case "error":
				return "❌"
			case "critical":
				return "🔥"
			case "alert":
				return "🚨"
			case "emergency":
				return "🆘"
			default:
				return "📝"
		}
	}

	connect(name: string, client: Client): void {
		client.setNotificationHandler(LoggingMessageNotificationSchema, async (notification) => {
			const params = notification.params || {}
			const level = params.level || "notice"
			const data = params.data || params.message || ""
			const logger = params.logger || ""
			const dataPrefix = logger ? `[${logger}] ` : ""

			const message = `${this.emojiForLevel(level)} **MCP ${name} ${level}**

${dataPrefix}${data}`

			if (this.notificationCallback) {
				await this.notificationCallback(message)
			} else {
				console.log(message)
			}
		})

		client.fallbackNotificationHandler = async (notification) => {
			const message = `**MCP ${name} notice**

Unknown notification: ${notification.method}

${JSON.stringify(notification.params, null, 2)}`

			if (this.notificationCallback) {
				await this.notificationCallback(message)
			} else {
				console.log(message)
			}
		}
	}
}
