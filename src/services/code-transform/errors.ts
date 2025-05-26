/**
 * Error handling for code transformation operations
 * 
 * This module provides consistent error creation and handling for all
 * code transformation operations, with typed error codes and structured
 * error information.
 */

/**
 * Error codes for code refactoring operations
 */
export type RefactoringErrorCode =
    | 'invalid_selector'          // Invalid or incomplete selector
    | 'invalid_operation'         // Invalid operation parameters
    | 'unsupported_operation'     // Operation type not supported
    | 'file_not_found'            // File path doesn't exist
    | 'file_read_error'           // Error reading a file
    | 'file_write_error'          // Error writing to a file
    | 'parse_error'               // Error parsing code
    | 'transformation_error'      // Error applying transformation
    | 'concurrent_operation'      // Another operation is in progress
    | 'dry_run_error'             // Error generating preview
    | 'invalid_dsl_command'       // Invalid DSL command
    | 'unknown_error';            // Unspecified error

/**
 * Structured error class for code refactoring operations
 */
export class CodeRefactoringError extends Error {
    /**
     * Create a new code refactoring error
     * 
     * @param code Specific error code
     * @param message Descriptive error message
     * @param details Optional additional error details
     */
    constructor(
        public readonly code: RefactoringErrorCode,
        message: string,
        public readonly details?: Record<string, unknown>
    ) {
        super(message);
        this.name = 'CodeRefactoringError';

        // Capture stack trace (works in V8 environments)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, CodeRefactoringError);
        }
    }

    /**
     * Convert error to a structured format suitable for display or serialization
     */
    toStructured(): {
        code: RefactoringErrorCode;
        message: string;
        details?: Record<string, unknown>;
    } {
        return {
            code: this.code,
            message: this.message,
            details: this.details
        };
    }

    /**
     * Format the error for display with optional details
     */
    formatForDisplay(): string {
        let result = `${this.message}`;

        if (this.details) {
            const detailsText = Object.entries(this.details)
                .map(([key, value]) => `  ${key}: ${formatValue(value)}`)
                .join('\n');

            if (detailsText) {
                result += '\n\nDetails:\n' + detailsText;
            }
        }

        return result;
    }
}

/**
 * Create a new refactoring error with consistent structure
 * 
 * @param code Error code
 * @param message Error message
 * @param details Optional additional details
 * @returns CodeRefactoringError instance
 */
export function createError(
    code: RefactoringErrorCode,
    message: string,
    details?: Record<string, unknown>
): CodeRefactoringError {
    return new CodeRefactoringError(code, message, details);
}

/**
 * Format a validation error for display
 * 
 * @param errorObj An object containing validation errors
 * @returns Formatted error string
 */
export function formatValidationError(errorObj: Record<string, string[]>): string {
    return Object.entries(errorObj)
        .map(([field, errors]) => `${field}: ${errors.join(', ')}`)
        .join('\n');
}

/**
 * Format a value for display in error message
 * 
 * @param value Any value to format
 * @returns String representation of the value
 */
function formatValue(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch (e) {
            return String(value);
        }
    }
    return String(value);
}