/**
 * AI Features Error Handling and Logging
 *
 * Specialized error handling and logging for AI features:
 * - Enhanced Chat with Source Discovery
 * - Next Edit Guidance System
 * - Context-Aware Intelligent Completions
 * - Slack Integration
 *
 * kilocode_change - new file
 */

import * as vscode from "vscode"
import { Logger, DiffSystemError } from "./error-handler"

/**
 * AI-specific error codes
 */
export type AIErrorCode =
	| "CHAT_REQUEST_FAILED"
	| "CITATION_GENERATION_FAILED"
	| "CONTEXT_SEARCH_FAILED"
	| "EDIT_PLAN_GENERATION_FAILED"
	| "EDIT_STEP_EXECUTION_FAILED"
	| "AST_ANALYSIS_FAILED"
	| "COMPLETION_GENERATION_FAILED"
	| "SEMANTIC_SEARCH_FAILED"
	| "NL_TO_CODE_FAILED"
	| "SLACK_SHARE_FAILED"
	| "SLACK_OAUTH_FAILED"
	| "VECTOR_EMBEDDING_FAILED"
	| "API_RATE_LIMIT_EXCEEDED"
	| "API_AUTHENTICATION_FAILED"
	| "API_TIMEOUT"
	| "INVALID_INPUT"
	| "INSUFFICIENT_CONTEXT"
	| "MODEL_UNAVAILABLE"

/**
 * AI feature error
 */
export interface AIFeatureError extends Error {
	code: AIErrorCode
	feature: "chat" | "edit_guidance" | "completions" | "slack_integration"
	component: string
	context?: any
	retryable: boolean
	userMessage?: string
}

/**
 * AI error context
 */
export interface AIErrorContext {
	operationId?: string
	userId?: string
	sessionId?: string
	filePath?: string
	aiProvider?: string
	model?: string
	tokensUsed?: number
	additionalData?: Record<string, any>
}

/**
 * AI Logger with specialized logging for AI features
 */
export class AILogger {
	private static readonly LOG_PREFIX = "[AIFeatures]"
	private static outputChannel: vscode.OutputChannel
	private static logHistory: Array<{ timestamp: Date; entry: any }> = []
	private static readonly MAX_LOG_HISTORY = 1000

	/**
	 * Initialize AI logger
	 */
	static initialize(context: vscode.ExtensionContext): void {
		AILogger.outputChannel = vscode.window.createOutputChannel("AI Features")
		context.subscriptions.push(AILogger.outputChannel)
		Logger.info("AILogger.initialize", "AI logger initialized")
	}

	/**
	 * Log chat operation
	 */
	static logChat(
		operation: string,
		message: string,
		data?: {
			sessionId?: string
			messageLength?: number
			citationCount?: number
			duration?: number
			success?: boolean
		},
	): void {
		AILogger.log("info", "chat", `${operation}: ${message}`, data)
	}

	/**
	 * Log edit guidance operation
	 */
	static logEditGuidance(
		operation: string,
		message: string,
		data?: {
			planId?: string
			stepCount?: number
			fileCount?: number
			duration?: number
			success?: boolean
		},
	): void {
		AILogger.log("info", "edit_guidance", `${operation}: ${message}`, data)
	}

	/**
	 * Log completions operation
	 */
	static logCompletions(
		operation: string,
		message: string,
		data?: {
			filePath?: string
			completionLength?: number
			confidence?: number
			duration?: number
			success?: boolean
		},
	): void {
		AILogger.log("info", "completions", `${operation}: ${message}`, data)
	}

	/**
	 * Log Slack operation
	 */
	static logSlack(
		operation: string,
		message: string,
		data?: {
			channelId?: string
			messageSize?: number
			duration?: number
			success?: boolean
		},
	): void {
		AILogger.log("info", "slack_integration", `${operation}: ${message}`, data)
	}

	/**
	 * Log API request
	 */
	static logAPIRequest(provider: string, model: string, tokens: number, duration: number, success: boolean): void {
		AILogger.log("debug", "api", `API Request: ${provider}/${model}`, {
			tokens,
			duration,
			success,
		})
	}

	/**
	 * Log error
	 */
	static logError(
		feature: "chat" | "edit_guidance" | "completions" | "slack_integration",
		error: AIFeatureError,
		context?: AIErrorContext,
	): void {
		AILogger.log("error", feature, error.message, {
			code: error.code,
			retryable: error.retryable,
			context,
		})
	}

	/**
	 * Log warning
	 */
	static logWarning(
		feature: "chat" | "edit_guidance" | "completions" | "slack_integration",
		message: string,
		data?: any,
	): void {
		AILogger.log("warn", feature, message, data)
	}

	/**
	 * Log debug
	 */
	static logDebug(
		feature: "chat" | "edit_guidance" | "completions" | "slack_integration",
		message: string,
		data?: any,
	): void {
		AILogger.log("debug", feature, message, data)
	}

	/**
	 * Get recent logs
	 */
	static getRecentLogs(count: number = 100): Array<{ timestamp: Date; entry: any }> {
		return AILogger.logHistory.slice(-count)
	}

	/**
	 * Clear log output
	 */
	static clear(): void {
		if (AILogger.outputChannel) {
			AILogger.outputChannel.clear()
		}
		AILogger.logHistory = []
	}

	/**
	 * Show log output channel
	 */
	static show(): void {
		if (AILogger.outputChannel) {
			AILogger.outputChannel.show()
		}
	}

	/**
	 * Internal logging method
	 */
	private static log(level: "debug" | "info" | "warn" | "error", feature: string, message: string, data?: any): void {
		const logEntry = {
			timestamp: new Date(),
			level,
			feature,
			message,
			data,
		}

		// Store in history
		AILogger.logHistory.push({ timestamp: logEntry.timestamp, entry: logEntry })
		if (AILogger.logHistory.length > AILogger.MAX_LOG_HISTORY) {
			AILogger.logHistory.shift()
		}

		// Format log message
		const formattedMessage = AILogger.formatLogMessage(logEntry)

		// Output to VSCode channel
		if (AILogger.outputChannel) {
			AILogger.outputChannel.appendLine(formattedMessage)
		}

		// Also output to console for development
		if (process.env.NODE_ENV === "development") {
			console.log(formattedMessage)
		}

		// Also log to main logger
		switch (level) {
			case "debug":
				Logger.debug(feature, message, data)
				break
			case "info":
				Logger.info(feature, message, data)
				break
			case "warn":
				Logger.warn(feature, message, data)
				break
			case "error":
				Logger.error(feature, message, undefined, data)
				break
		}
	}

	/**
	 * Format log message consistently
	 */
	private static formatLogMessage(entry: any): string {
		const timestamp = entry.timestamp.toISOString()
		const level = entry.level.toUpperCase().padEnd(5, " ")
		const feature = entry.feature.padEnd(20, " ")

		let message = `${timestamp} ${level} ${feature} ${entry.message}`

		if (entry.data) {
			message += ` | Data: ${JSON.stringify(entry.data)}`
		}

		return message
	}
}

/**
 * AI Error Handler
 */
export class AIErrorHandler {
	/**
	 * Create AI feature error
	 */
	static createError(
		code: AIErrorCode,
		feature: AIFeatureError["feature"],
		component: string,
		message: string,
		context?: AIErrorContext,
		retryable: boolean = false,
		userMessage?: string,
	): AIFeatureError {
		const error = Object.assign(new Error(message), {
			code,
			feature,
			component,
			context,
			retryable,
			userMessage,
		}) as AIFeatureError

		AILogger.logError(feature, error, context)
		return error
	}

	/**
	 * Handle AI API error
	 */
	static handleAPIError(
		feature: AIFeatureError["feature"],
		component: string,
		error: any,
		context?: AIErrorContext,
	): AIFeatureError {
		let code: AIErrorCode
		let retryable = false
		let userMessage: string

		if (error?.status === 429) {
			code = "API_RATE_LIMIT_EXCEEDED"
			retryable = true
			userMessage = "API rate limit exceeded. Please try again later."
		} else if (error?.status === 401) {
			code = "API_AUTHENTICATION_FAILED"
			retryable = false
			userMessage = "API authentication failed. Please check your API key."
		} else if (error?.code === "ETIMEDOUT" || error?.code === "ECONNABORTED") {
			code = "API_TIMEOUT"
			retryable = true
			userMessage = "API request timed out. Please try again."
		} else {
			code = "CHAT_REQUEST_FAILED"
			retryable = true
			userMessage = "An error occurred while processing your request."
		}

		return AIErrorHandler.createError(
			code,
			feature,
			component,
			error?.message || "Unknown API error",
			context,
			retryable,
			userMessage,
		)
	}

	/**
	 * Handle validation error
	 */
	static handleValidationError(
		feature: AIFeatureError["feature"],
		component: string,
		message: string,
		context?: AIErrorContext,
	): AIFeatureError {
		return AIErrorHandler.createError(
			"INVALID_INPUT",
			feature,
			component,
			message,
			context,
			false,
			"Invalid input provided. Please check your request and try again.",
		)
	}

	/**
	 * Handle insufficient context error
	 */
	static handleInsufficientContextError(
		feature: AIFeatureError["feature"],
		component: string,
		message: string,
		context?: AIErrorContext,
	): AIFeatureError {
		return AIErrorHandler.createError(
			"INSUFFICIENT_CONTEXT",
			feature,
			component,
			message,
			context,
			false,
			"Not enough context to provide a meaningful response. Please provide more details.",
		)
	}

	/**
	 * Safe execution with AI-specific error handling
	 */
	static async safeExecute<T>(
		operation: () => Promise<T>,
		feature: AIFeatureError["feature"],
		component: string,
		errorMessage?: string,
		context?: AIErrorContext,
	): Promise<{ success: boolean; result?: T; error?: AIFeatureError }> {
		try {
			const result = await operation()
			return { success: true, result }
		} catch (error) {
			const aiError = AIErrorHandler.handleAPIError(feature, component, error, context)
			if (errorMessage && aiError.userMessage) {
				AIErrorHandler.showUserError(aiError)
			}
			return { success: false, error: aiError }
		}
	}

	/**
	 * Safe synchronous execution with AI-specific error handling
	 */
	static safeExecuteSync<T>(
		operation: () => T,
		feature: AIFeatureError["feature"],
		component: string,
		errorMessage?: string,
		context?: AIErrorContext,
	): { success: boolean; result?: T; error?: AIFeatureError } {
		try {
			const result = operation()
			return { success: true, result }
		} catch (error) {
			const aiError = AIErrorHandler.handleAPIError(feature, component, error, context)
			if (errorMessage && aiError.userMessage) {
				AIErrorHandler.showUserError(aiError)
			}
			return { success: false, error: aiError }
		}
	}

	/**
	 * Retry operation with exponential backoff
	 */
	static async retry<T>(
		operation: () => Promise<T>,
		feature: AIFeatureError["feature"],
		component: string,
		maxRetries: number = 3,
		baseDelay: number = 1000,
		context?: AIErrorContext,
	): Promise<{ success: boolean; result?: T; error?: AIFeatureError }> {
		let lastError: AIFeatureError | undefined

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				const result = await operation()
				if (attempt > 0) {
					AILogger.logDebug(feature, "Operation succeeded on attempt " + (attempt + 1))
				}
				return { success: true, result }
			} catch (error) {
				lastError = AIErrorHandler.handleAPIError(feature, component, error, context)

				if (!lastError.retryable || attempt >= maxRetries) {
					break
				}

				const delay = baseDelay * Math.pow(2, attempt)
				AILogger.logWarning(feature, "Attempt " + (attempt + 1) + " failed, retrying in " + delay + "ms")
				await new Promise((resolve) => setTimeout(resolve, delay))
			}
		}

		AILogger.logError(feature, lastError!, context)
		return { success: false, error: lastError }
	}

	/**
	 * Show error to user
	 */
	static showUserError(error: AIFeatureError): void {
		const message = error.userMessage || error.feature + ": " + error.message
		vscode.window.showErrorMessage(message)
	}

	/**
	 * Show warning to user
	 */
	static showUserWarning(message: string, feature?: string): void {
		vscode.window.showWarningMessage(`AI Features: ${message}`)
		AILogger.logWarning(feature as any, "User warning displayed", { message })
	}

	/**
	 * Show info to user
	 */
	static showUserInfo(message: string, feature?: string): void {
		vscode.window.showInformationMessage(`AI Features: ${message}`)
		AILogger.logDebug(feature as any, "User info displayed", { message })
	}

	/**
	 * Wrap async function with error handling and metrics
	 */
	static async withMetrics<T>(
		operation: () => Promise<T>,
		feature: AIFeatureError["feature"],
		component: string,
		operationId: string,
		context?: AIErrorContext,
	): Promise<{ success: boolean; result?: T; error?: AIFeatureError; duration?: number }> {
		const startTime = Date.now()

		try {
			const result = await operation()
			const duration = Date.now() - startTime

			AILogger.logDebug(feature, `Operation ${operationId} completed in ${duration}ms`, {
				success: true,
				duration,
			})

			return { success: true, result, duration }
		} catch (error) {
			const duration = Date.now() - startTime
			const aiError = AIErrorHandler.handleAPIError(feature, component, error, context)

			AILogger.logError(feature, aiError, {
				...context,
				operationId,
				additionalData: {
					...context?.additionalData,
					durationMs: duration,
				},
			})

			return { success: false, error: aiError, duration }
		}
	}
}
