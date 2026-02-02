/**
 * File-based debug logging utility
 *
 * This writes logs to ~/.roo/cli-debug.log, avoiding stdout/stderr
 * which would break TUI applications. The log format is timestamped JSON.
 *
 * Usage:
 *   import { debugLog, DebugLogger } from "@roo-code/core/cli"
 *
 *   // Simple logging
 *   debugLog("handleModeSwitch", { mode: newMode, configId })
 *
 *   // Or create a named logger for a component
 *   const log = new DebugLogger("ClineProvider")
 *   log.info("handleModeSwitch", { mode: newMode })
 */

import * as fs from "fs"
import * as path from "path"
import * as os from "os"

const DEBUG_LOG_PATH = path.join(os.homedir(), ".roo", "cli-debug.log")

/**
 * Simple file-based debug log function.
 * Writes timestamped entries to ~/.roo/cli-debug.log
 */
export function debugLog(message: string, data?: unknown): void {
	try {
		const logDir = path.dirname(DEBUG_LOG_PATH)

		if (!fs.existsSync(logDir)) {
			fs.mkdirSync(logDir, { recursive: true })
		}

		const timestamp = new Date().toISOString()

		const entry = data
			? `[${timestamp}] ${message}: ${JSON.stringify(data, null, 2)}\n`
			: `[${timestamp}] ${message}\n`

		fs.appendFileSync(DEBUG_LOG_PATH, entry)
	} catch {
		// NO-OP - don't let logging errors break functionality
	}
}

/**
 * Debug logger with component context.
 * Prefixes all messages with the component name.
 */
export class DebugLogger {
	private component: string

	constructor(component: string) {
		this.component = component
	}

	/**
	 * Log a debug message with optional data
	 */
	debug(message: string, data?: unknown): void {
		debugLog(`[${this.component}] ${message}`, data)
	}

	/**
	 * Alias for debug
	 */
	info(message: string, data?: unknown): void {
		this.debug(message, data)
	}

	/**
	 * Log a warning
	 */
	warn(message: string, data?: unknown): void {
		debugLog(`[${this.component}] WARN: ${message}`, data)
	}

	/**
	 * Log an error
	 */
	error(message: string, data?: unknown): void {
		debugLog(`[${this.component}] ERROR: ${message}`, data)
	}
}

/**
 * Pre-configured logger for provider/mode debugging
 */
export const providerDebugLog = new DebugLogger("ProviderSettings")
