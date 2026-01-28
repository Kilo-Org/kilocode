/**
 * Simple logger stub for VSCode mock
 * Users can provide their own logger by calling setLogger()
 */

export interface Logger {
	info(message: string, context?: string, meta?: unknown): void
	warn(message: string, context?: string, meta?: unknown): void
	error(message: string, context?: string, meta?: unknown): void
	debug(message: string, context?: string, meta?: unknown): void
}

class ConsoleLogger implements Logger {
	info(message: string, context?: string, _meta?: unknown): void {
		console.log(`[${context || "INFO"}] ${message}`)
	}

	warn(message: string, context?: string, _meta?: unknown): void {
		console.warn(`[${context || "WARN"}] ${message}`)
	}

	error(message: string, context?: string, _meta?: unknown): void {
		console.error(`[${context || "ERROR"}] ${message}`)
	}

	debug(message: string, context?: string, _meta?: unknown): void {
		if (process.env.DEBUG) {
			console.debug(`[${context || "DEBUG"}] ${message}`)
		}
	}
}

let logger: Logger = new ConsoleLogger()

/**
 * Set a custom logger
 *
 * @param customLogger - Your logger implementation
 */
export function setLogger(customLogger: Logger): void {
	logger = customLogger
}

/**
 * Get the current logger
 */
export const logs = {
	info: (message: string, context?: string, meta?: unknown) => logger.info(message, context, meta),
	warn: (message: string, context?: string, meta?: unknown) => logger.warn(message, context, meta),
	error: (message: string, context?: string, meta?: unknown) => logger.error(message, context, meta),
	debug: (message: string, context?: string, meta?: unknown) => logger.debug(message, context, meta),
}
