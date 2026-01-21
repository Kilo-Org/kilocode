/**
 * Logger interface for the agent runtime.
 * This allows the runtime to be used with any logging implementation.
 */
export interface Logger {
	debug(message: string, context?: string, meta?: Record<string, unknown>): void
	info(message: string, context?: string, meta?: Record<string, unknown>): void
	warn(message: string, context?: string, meta?: Record<string, unknown>): void
	error(message: string, context?: string, meta?: Record<string, unknown>): void
}

/**
 * Default console-based logger implementation.
 * Used when no custom logger is provided.
 */
class ConsoleLogger implements Logger {
	debug(message: string, context?: string, meta?: Record<string, unknown>): void {
		if (process.env.DEBUG) {
			console.debug(`[DEBUG] [${context || "Runtime"}] ${message}`, meta ? JSON.stringify(meta) : "")
		}
	}

	info(message: string, context?: string, meta?: Record<string, unknown>): void {
		console.log(`[INFO] [${context || "Runtime"}] ${message}`, meta ? JSON.stringify(meta) : "")
	}

	warn(message: string, context?: string, meta?: Record<string, unknown>): void {
		console.warn(`[WARN] [${context || "Runtime"}] ${message}`, meta ? JSON.stringify(meta) : "")
	}

	error(message: string, context?: string, meta?: Record<string, unknown>): void {
		console.error(`[ERROR] [${context || "Runtime"}] ${message}`, meta ? JSON.stringify(meta) : "")
	}
}

// Global logger instance - can be overridden by setLogger
let globalLogger: Logger = new ConsoleLogger()

/**
 * Set the global logger instance.
 * Call this early in your application to use a custom logger.
 */
export function setLogger(logger: Logger): void {
	globalLogger = logger
}

/**
 * Get the current global logger instance.
 */
export function getLogger(): Logger {
	return globalLogger
}

/**
 * Logs service compatible object for use within the runtime.
 * Provides the same API as the CLI logs service.
 */
export const logs = {
	debug(message: string, context?: string, meta?: Record<string, unknown>): void {
		globalLogger.debug(message, context, meta)
	},
	info(message: string, context?: string, meta?: Record<string, unknown>): void {
		globalLogger.info(message, context, meta)
	},
	warn(message: string, context?: string, meta?: Record<string, unknown>): void {
		globalLogger.warn(message, context, meta)
	},
	error(message: string, context?: string, meta?: Record<string, unknown>): void {
		globalLogger.error(message, context, meta)
	},
}
