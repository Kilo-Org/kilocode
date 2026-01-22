// kilocode_change - new file
/**
 * Helper utilities for capturing LLM error telemetry.
 *
 * This module provides a centralized way to capture LLM API error telemetry,
 * avoiding code duplication across multiple error handling paths in Task.ts.
 */

import { TelemetryService } from "@roo-code/telemetry"
import { getErrorMessage, getErrorStatusCode, shouldReportApiErrorToTelemetry } from "@roo-code/types"

/**
 * Options for capturing LLM error telemetry.
 */
export interface LlmErrorTelemetryOptions {
	/** The task ID for telemetry tracking */
	taskId: string
	/** The error that occurred */
	error: unknown
	/** Time when the API request started (from performance.now()) */
	apiRequestStartTime: number
	/** The inference provider (e.g., "openrouter") */
	inferenceProvider?: string
	/** Input tokens consumed (if available) */
	inputTokens?: number
	/** Output tokens consumed (if available) */
	outputTokens?: number
	/** Cache write tokens (if available) */
	cacheWriteTokens?: number
	/** Cache read tokens (if available) */
	cacheReadTokens?: number
}

/**
 * Captures LLM error telemetry and marks the error to prevent duplicate reporting.
 *
 * This function:
 * 1. Extracts error status code and message
 * 2. Checks if the error should be reported (filters out user cancellations, etc.)
 * 3. Captures the telemetry event with all available context
 * 4. Marks the error object with `__llmCompletionTelemetryCaptured = true` to prevent duplicates
 *
 * @param options - The telemetry options
 * @returns true if telemetry was captured, false if skipped (already captured or filtered out)
 */
export function captureLlmErrorTelemetry(options: LlmErrorTelemetryOptions): boolean {
	const { error, taskId, apiRequestStartTime, inferenceProvider } = options

	// Check if this error was already captured
	if (typeof error === "object" && error !== null && (error as any).__llmCompletionTelemetryCaptured === true) {
		return false
	}

	const errorStatusCode = getErrorStatusCode(error)
	const extractedErrorMessage = getErrorMessage(error) ?? (error instanceof Error ? error.message : String(error))

	// Check if this error should be reported
	if (!shouldReportApiErrorToTelemetry(errorStatusCode, extractedErrorMessage)) {
		return false
	}

	// Capture the telemetry using the dedicated LLM error event
	TelemetryService.instance.captureLlmError(taskId, {
		inputTokens: options.inputTokens ?? 0,
		outputTokens: options.outputTokens ?? 0,
		cacheWriteTokens: options.cacheWriteTokens ?? 0,
		cacheReadTokens: options.cacheReadTokens ?? 0,
		completionTime: performance.now() - apiRequestStartTime,
		inferenceProvider,
		errorType:
			errorStatusCode !== undefined ? `http_${errorStatusCode}` : error instanceof Error ? error.name : "unknown",
		errorMessage: extractedErrorMessage,
	})

	// Mark the error so upstream consumers can avoid duplicate telemetry
	if (typeof error === "object" && error !== null) {
		;(error as any).__llmCompletionTelemetryCaptured = true
	}

	return true
}

/**
 * Checks if an error has already had its telemetry captured.
 *
 * @param error - The error to check
 * @returns true if telemetry was already captured for this error
 */
export function isLlmErrorTelemetryCaptured(error: unknown): boolean {
	return typeof error === "object" && error !== null && (error as any).__llmCompletionTelemetryCaptured === true
}
