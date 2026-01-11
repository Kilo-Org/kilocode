/**
 * Logging for User Story 1 Operations
 *
 * Provides structured logging for diff visualization and interaction operations
 */

import { Logger } from "../error-handler"
import { DiffEventManager } from "../event-system"

/**
 * Logging configuration for User Story 1
 */
export interface UserStory1LoggingConfig {
	enableDebugLogging: boolean
	enablePerformanceMetrics: boolean
	logUserInteractions: boolean
	logOverlayOperations: boolean
}

/**
 * Logger for User Story 1 operations
 */
export class UserStory1Logger {
	private static config: UserStory1LoggingConfig = {
		enableDebugLogging: true,
		enablePerformanceMetrics: true,
		logUserInteractions: true,
		logOverlayOperations: true,
	}

	/**
	 * Configure logging settings
	 */
	static configure(config: Partial<UserStory1LoggingConfig>): void {
		this.config = { ...this.config, ...config }
		Logger.info("UserStory1Logger.configure", `Logging configuration updated: ${JSON.stringify(this.config)}`)
	}

	/**
	 * Log diff creation
	 */
	static logDiffCreation(
		filePath: string,
		operation: "unified" | "streaming" | "from-unified",
		duration: number,
		additionsCount: number,
		deletionsCount: number,
		modificationsCount: number,
	): void {
		if (!this.config.enableDebugLogging) return

		Logger.debug("UserStory1Logger.logDiffCreation", `Diff created for ${filePath}`, {
			operation,
			duration,
			additionsCount,
			deletionsCount,
			modificationsCount,
		})
	}

	/**
	 * Log overlay rendering
	 */
	static logOverlayRendering(
		fileBufferId: string,
		overlayCount: number,
		renderTime: number,
		colorScheme: string,
	): void {
		if (!this.config.enableDebugLogging) return

		Logger.debug("UserStory1Logger.logOverlayRendering", `Overlays rendered for ${fileBufferId}`, {
			overlayCount,
			renderTime,
			colorScheme,
		})
	}

	/**
	 * Log user interaction
	 */
	static logUserInteraction(
		action: "accept" | "reject" | "navigate" | "quick-pick",
		overlayId?: string,
		context?: any,
	): void {
		if (!this.config.logUserInteractions) return

		const logData: any = {
			action,
			overlayId,
			context,
		}

		Logger.info("UserStory1Logger.logUserInteraction", `User interaction: ${action}`, logData)
	}

	/**
	 * Log performance metrics
	 */
	static logPerformanceMetrics(operation: string, startTime: number, endTime: number, metadata?: any): void {
		if (!this.config.enablePerformanceMetrics) return

		const duration = endTime - startTime
		const performanceData = {
			operation,
			duration,
			startTime: new Date(startTime).toISOString(),
			endTime: new Date(endTime).toISOString(),
			metadata,
		}

		Logger.info(
			"UserStory1Logger.logPerformanceMetrics",
			`Performance: ${operation} (${duration}ms)`,
			performanceData,
		)
	}

	/**
	 * Log overlay operation
	 */
	static logOverlayOperation(
		operation: "add" | "remove" | "update" | "accept" | "reject",
		fileBufferId: string,
		success: boolean,
		overlayId?: string,
		error?: string,
	): void {
		if (!this.config.logOverlayOperations) return

		const operationData = {
			operation,
			fileBufferId,
			overlayId,
			success,
			error,
		}

		const level = success ? "debug" : "warn"
		Logger[level](
			"UserStory1Logger.logOverlayOperation",
			`Overlay ${operation}: ${success ? "success" : "failed"}`,
			operationData,
		)
	}

	/**
	 * Log session state changes
	 */
	static logSessionStateChange(change: "session-created" | "session-updated" | "session-cleared", data?: any): void {
		if (!this.config.enableDebugLogging) return

		Logger.debug("UserStory1Logger.logSessionStateChange", `Session ${change}`, data)
	}

	/**
	 * Log error with context
	 */
	static logError(component: string, operation: string, error: Error | string, context?: any): void {
		const errorMessage = error instanceof Error ? error.message : error
		const errorObj = error instanceof Error ? error : new Error(errorMessage)

		Logger.error("UserStory1Logger.logError", `Error in ${component}: ${operation}`, errorObj, {
			component,
			operation,
			context,
		})
	}

	/**
	 * Get logging statistics
	 */
	static getLoggingStats(): {
		config: UserStory1LoggingConfig
		recentOperations: Array<{ timestamp: Date; operation: string; success: boolean }>
	} {
		// This would typically track recent operations in memory
		// For now, return current config
		return {
			config: this.config,
			recentOperations: [],
		}
	}

	/**
	 * Log checkpoint reached
	 */
	static logCheckpoint(checkpoint: string, data?: any): void {
		Logger.info("UserStory1Logger.logCheckpoint", `Checkpoint reached: ${checkpoint}`, data)
	}

	/**
	 * Start performance timer
	 */
	static startPerformanceTimer(operation: string): () => void {
		const startTime = Date.now()

		return () => {
			const endTime = Date.now()
			this.logPerformanceMetrics(operation, startTime, endTime)
		}
	}

	/**
	 * Log file buffer operations
	 */
	static logFileBufferOperation(
		operation: "create" | "update" | "open" | "close",
		fileBufferId: string,
		filePath: string,
		success: boolean,
		metadata?: any,
	): void {
		if (!this.config.enableDebugLogging) return

		const operationData = {
			operation,
			fileBufferId,
			filePath,
			success,
			metadata,
		}

		Logger.debug(
			"UserStory1Logger.logFileBufferOperation",
			`File buffer ${operation}: ${success ? "success" : "failed"}`,
			operationData,
		)
	}

	/**
	 * Emit custom event for logging
	 */
	static emitCustomEvent(eventName: string, data?: any): void {
		DiffEventManager.emitUiRefreshNeeded(`logging-${eventName}`)
		Logger.debug("UserStory1Logger.emitCustomEvent", `Custom event: ${eventName}`, data)
	}
}
