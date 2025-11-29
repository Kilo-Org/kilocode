import * as vscode from "vscode"
import type { ILogger } from "../../shared/kilocode/cli-sessions/types/ILogger"

export class ExtensionLoggerAdapter implements ILogger {
	constructor(private readonly outputChannel: vscode.OutputChannel) {}

	private formatLog(message: string, source: string, metadata?: Record<string, unknown>): string {
		const timestamp = new Date().toISOString()
		let logMessage = `[${timestamp}] [${source}] ${message}`

		if (metadata && Object.keys(metadata).length > 0) {
			try {
				logMessage += ` ${JSON.stringify(metadata)}`
			} catch (error) {
				logMessage += ` [metadata serialization error]`
			}
		}

		return logMessage
	}

	debug(message: string, source: string, metadata?: Record<string, unknown>): void {
		const logMessage = this.formatLog(message, source, metadata)
		this.outputChannel.appendLine(`[DEBUG] ${logMessage}`)
	}

	info(message: string, source: string, metadata?: Record<string, unknown>): void {
		const logMessage = this.formatLog(message, source, metadata)
		this.outputChannel.appendLine(`[INFO] ${logMessage}`)
	}

	warn(message: string, source: string, metadata?: Record<string, unknown>): void {
		const logMessage = this.formatLog(message, source, metadata)
		this.outputChannel.appendLine(`[WARN] ${logMessage}`)
	}

	error(message: string, source: string, metadata?: Record<string, unknown>): void {
		const logMessage = this.formatLog(message, source, metadata)
		this.outputChannel.appendLine(`[ERROR] ${logMessage}`)
	}
}
