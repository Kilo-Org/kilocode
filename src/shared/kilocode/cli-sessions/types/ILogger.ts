/**
 * Interface for logging functionality.
 * Implementations should provide methods for different log levels.
 */
export interface ILogger {
	/**
	 * Log a debug message.
	 * @param message The message to log
	 * @param source The source/component generating the log
	 * @param metadata Optional metadata object to include with the log
	 */
	debug(message: string, source: string, metadata?: Record<string, unknown>): void

	/**
	 * Log an informational message.
	 * @param message The message to log
	 * @param source The source/component generating the log
	 * @param metadata Optional metadata object to include with the log
	 */
	info(message: string, source: string, metadata?: Record<string, unknown>): void

	/**
	 * Log a warning message.
	 * @param message The message to log
	 * @param source The source/component generating the log
	 * @param metadata Optional metadata object to include with the log
	 */
	warn(message: string, source: string, metadata?: Record<string, unknown>): void

	/**
	 * Log an error message.
	 * @param message The message to log
	 * @param source The source/component generating the log
	 * @param metadata Optional metadata object to include with the log
	 */
	error(message: string, source: string, metadata?: Record<string, unknown>): void
}
