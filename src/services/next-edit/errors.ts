/**
 * Error types for Next Edit feature
 *
 * This file defines custom error classes and error codes used throughout
 * the Next Edit service for consistent error handling.
 */

// ============================================================================
// Error Codes
// ============================================================================

/**
 * All error codes used in the Next Edit feature
 * These codes are used to identify specific error conditions
 */
export const ErrorCodes = {
	SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
	SESSION_ALREADY_ACTIVE: "SESSION_ALREADY_ACTIVE",
	INVALID_SESSION_ID: "INVALID_SESSION_ID",
	EDIT_NOT_FOUND: "EDIT_NOT_FOUND",
	EDIT_ALREADY_PROCESSED: "EDIT_ALREADY_PROCESSED",
	DEPENDENCY_NOT_MET: "DEPENDENCY_NOT_MET",
	FILE_NOT_FOUND: "FILE_NOT_FOUND",
	ANALYSIS_FAILED: "ANALYSIS_FAILED",
	APPLY_FAILED: "APPLY_FAILED",
	UNDO_FAILED: "UNDO_FAILED",
	GIT_ERROR: "GIT_ERROR",
	VALIDATION_ERROR: "VALIDATION_ERROR",
} as const

/**
 * Type for error code values
 */
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Custom error class for Next Edit feature
 *
 * @extends Error
 *
 * @example
 * ```typescript
 * throw new NextEditError(
 *   ErrorCodes.SESSION_NOT_FOUND,
 *   'Session with ID xyz not found',
 *   { sessionId: 'xyz' }
 * );
 * ```
 */
export class NextEditError extends Error {
	/**
	 * The error code identifying the type of error
	 */
	public readonly code: ErrorCode

	/**
	 * Additional details about the error (optional)
	 */
	public readonly details?: Record<string, unknown>

	/**
	 * Creates a new NextEditError instance
	 *
	 * @param code - The error code from ErrorCodes
	 * @param message - Human-readable error message
	 * @param details - Optional additional error context
	 */
	constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
		super(message)
		this.name = "NextEditError"
		this.code = code
		this.details = details

		// Maintains proper stack trace for where our error was thrown
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, NextEditError)
		}
	}

	/**
	 * Returns a string representation of the error
	 */
	override toString(): string {
		const detailsStr = this.details ? ` | Details: ${JSON.stringify(this.details)}` : ""
		return `[${this.code}] ${this.message}${detailsStr}`
	}
}

// ============================================================================
// Error Factory Functions
// ============================================================================

/**
 * Creates a session not found error
 */
export function createSessionNotFoundError(sessionId: string): NextEditError {
	return new NextEditError(ErrorCodes.SESSION_NOT_FOUND, `Session with ID ${sessionId} not found`, { sessionId })
}

/**
 * Creates an invalid session ID error
 */
export function createInvalidSessionIdError(sessionId: string): NextEditError {
	return new NextEditError(ErrorCodes.INVALID_SESSION_ID, `Invalid session ID: ${sessionId}`, { sessionId })
}

/**
 * Creates an edit not found error
 */
export function createEditNotFoundError(editId: string): NextEditError {
	return new NextEditError(ErrorCodes.EDIT_NOT_FOUND, `Edit with ID ${editId} not found`, { editId })
}

/**
 * Creates a file not found error
 */
export function createFileNotFoundError(filePath: string): NextEditError {
	return new NextEditError(ErrorCodes.FILE_NOT_FOUND, `File not found: ${filePath}`, { filePath })
}

/**
 * Creates a validation error
 */
export function createValidationError(field: string, reason: string): NextEditError {
	return new NextEditError(ErrorCodes.VALIDATION_ERROR, `Validation failed for field '${field}': ${reason}`, {
		field,
		reason,
	})
}

/**
 * Creates an analysis failed error
 */
export function createAnalysisFailedError(reason: string): NextEditError {
	return new NextEditError(ErrorCodes.ANALYSIS_FAILED, `Codebase analysis failed: ${reason}`, { reason })
}

/**
 * Creates an apply failed error
 */
export function createApplyFailedError(editId: string, reason: string): NextEditError {
	return new NextEditError(ErrorCodes.APPLY_FAILED, `Failed to apply edit ${editId}: ${reason}`, { editId, reason })
}

/**
 * Creates a dependency not met error
 */
export function createDependencyNotMetError(editId: string, dependencyId: string): NextEditError {
	return new NextEditError(
		ErrorCodes.DEPENDENCY_NOT_MET,
		`Edit ${editId} depends on ${dependencyId} which is not completed`,
		{ editId, dependencyId },
	)
}

/**
 * Creates a git error
 */
export function createGitError(reason: string): NextEditError {
	return new NextEditError(ErrorCodes.GIT_ERROR, `Git operation failed: ${reason}`, { reason })
}
