/**
 * Unified error hierarchy for Ghost system
 * Provides consistent error handling across all strategies and components
 */

/**
 * Base error class for all Ghost-related errors
 */
export abstract class GhostError extends Error {
	public readonly code: string
	public readonly timestamp: Date

	constructor(message: string, code: string) {
		super(message)
		this.name = this.constructor.name
		this.code = code
		this.timestamp = new Date()

		// Ensure proper prototype chain for instanceof checks
		Object.setPrototypeOf(this, new.target.prototype)
	}

	/**
	 * Get error details for logging/telemetry
	 */
	public getDetails(): Record<string, unknown> {
		return {
			name: this.name,
			message: this.message,
			code: this.code,
			timestamp: this.timestamp.toISOString(),
			stack: this.stack,
		}
	}
}

/**
 * Context-related errors (invalid document, range, etc.)
 */
export class GhostContextError extends GhostError {
	constructor(
		message: string,
		public readonly contextType?: string,
	) {
		super(message, "GHOST_CONTEXT_ERROR")
	}

	public override getDetails(): Record<string, any> {
		return {
			...super.getDetails(),
			contextType: this.contextType,
		}
	}
}

/**
 * Strategy-related errors (prompt generation, response parsing, etc.)
 */
export class GhostStrategyError extends GhostError {
	constructor(
		message: string,
		public readonly strategyName?: string,
		public readonly phase?: string,
	) {
		super(message, "GHOST_STRATEGY_ERROR")
	}

	public override getDetails(): Record<string, unknown> {
		return {
			...super.getDetails(),
			strategyName: this.strategyName,
			phase: this.phase,
		}
	}
}

/**
 * API/Model-related errors (network issues, API failures, etc.)
 */
export class GhostModelError extends GhostError {
	constructor(
		message: string,
		public readonly modelName?: string,
		public readonly apiProvider?: string,
	) {
		super(message, "GHOST_MODEL_ERROR")
	}

	public override getDetails(): Record<string, unknown> {
		return {
			...super.getDetails(),
			modelName: this.modelName,
			apiProvider: this.apiProvider,
		}
	}
}

/**
 * Configuration-related errors (invalid profiles, missing settings, etc.)
 */
export class GhostConfigError extends GhostError {
	constructor(
		message: string,
		public readonly configType?: string,
	) {
		super(message, "GHOST_CONFIG_ERROR")
	}

	public override getDetails(): Record<string, unknown> {
		return {
			...super.getDetails(),
			configType: this.configType,
		}
	}
}

/**
 * Cancellation errors (user cancelled, timeout, etc.)
 */
export class GhostCancellationError extends GhostError {
	constructor(message: string = "Operation was cancelled") {
		super(message, "GHOST_CANCELLATION_ERROR")
	}
}

/**
 * Template-related errors (missing templates, compilation failures, etc.)
 */
export class GhostTemplateError extends GhostError {
	constructor(
		message: string,
		public readonly templatePath?: string,
	) {
		super(message, "GHOST_TEMPLATE_ERROR")
	}

	public override getDetails(): Record<string, unknown> {
		return {
			...super.getDetails(),
			templatePath: this.templatePath,
		}
	}
}

/**
 * Utility functions for error handling
 */
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace GhostErrorUtils {
	/**
	 * Check if an error is a Ghost error
	 */
	export function isGhostError(error: unknown): error is GhostError {
		return error instanceof GhostError
	}

	/**
	 * Convert any error to a GhostError
	 */
	export function toGhostError(error: unknown, fallbackMessage = "Unknown error occurred"): GhostError {
		if (isGhostError(error)) {
			return error
		}

		if (error instanceof Error) {
			return new GhostStrategyError(`${fallbackMessage}: ${error.message}`)
		}

		return new GhostStrategyError(`${fallbackMessage}: ${String(error)}`)
	}

	/**
	 * Log error with appropriate level based on error type
	 */
	export function logError(error: GhostError, logger = console): void {
		const details = error.getDetails()

		switch (error.code) {
			case "GHOST_CANCELLATION_ERROR":
				logger.info("Ghost operation cancelled:", details)
				break
			case "GHOST_CONTEXT_ERROR":
			case "GHOST_CONFIG_ERROR":
				logger.warn("Ghost configuration issue:", details)
				break
			case "GHOST_MODEL_ERROR":
			case "GHOST_STRATEGY_ERROR":
			case "GHOST_TEMPLATE_ERROR":
				logger.error("Ghost execution error:", details)
				break
			default:
				logger.error("Unknown Ghost error:", details)
		}
	}
}
