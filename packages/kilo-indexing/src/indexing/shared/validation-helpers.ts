import { Log } from "../../util/log"

const log = Log.create({ service: "indexing-validation" })

/**
 * Sanitizes error messages by removing sensitive information like file paths and URLs
 * @param errorMessage The error message to sanitize
 * @returns The sanitized error message
 */
export function sanitizeErrorMessage(errorMessage: string): string {
  if (!errorMessage || typeof errorMessage !== "string") {
    return String(errorMessage)
  }

  let sanitized = errorMessage

  // Replace URLs first (http, https, ftp, file protocols)
  // This needs to be done before file paths to avoid partial replacements
  sanitized = sanitized.replace(
    /(?:https?|ftp|file):\/\/(?:localhost|[\w\-\.]+)(?::\d+)?(?:\/[\w\-\.\/\?\&\=\#]*)?/gi,
    "[REDACTED_URL]",
  )

  // Replace email addresses
  sanitized = sanitized.replace(/[\w\-\.]+@[\w\-\.]+\.\w+/g, "[REDACTED_EMAIL]")

  // Replace IP addresses (IPv4)
  sanitized = sanitized.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[REDACTED_IP]")

  // Replace file paths in quotes (handles paths with spaces)
  sanitized = sanitized.replace(/"[^"]*(?:\/|\\)[^"]*"/g, '"[REDACTED_PATH]"')

  // Replace file paths (Unix and Windows style)
  // Matches paths like /Users/username/path, C:\Users\path, ./relative/path, ../relative/path
  sanitized = sanitized.replace(
    /(?:\/[\w\-\.]+)+(?:\/[\w\-\.\s]*)*|(?:[A-Za-z]:\\[\w\-\.\\]+)|(?:\.{1,2}\/[\w\-\.\/]+)/g,
    "[REDACTED_PATH]",
  )

  // Replace port numbers that appear after colons (e.g., :11434, :8080)
  // Do this after URLs to avoid double replacement
  sanitized = sanitized.replace(/(?<!REDACTED_URL\]):(\d{2,5})\b/g, ":[REDACTED_PORT]")

  return sanitized
}

/**
 * HTTP error interface for embedder errors
 */
export interface HttpError extends Error {
  status?: number
  response?: {
    status?: number
  }
}

/**
 * Common error types that can occur during embedder validation
 */
export interface ValidationError {
  status?: number
  message?: string
  name?: string
  code?: string
}

/**
 * Maps HTTP status codes to appropriate error messages
 */
export function getErrorMessageForStatus(status: number | undefined, embedderType: string): string | undefined {
  switch (status) {
    case 401:
    case 403:
      return "Authentication failed. Please check your API key."
    case 404:
      return embedderType === "openai"
        ? "The specified embedding model is not available."
        : "Invalid endpoint URL. Please verify the endpoint."
    case 429:
      return "Service is temporarily unavailable due to rate limiting. Please try again later."
    case 402:
      return "Add credits to continue, or switch to a free embedding model."
    default:
      if (status && status >= 400 && status < 600) {
        return "Configuration error. Please verify your embedder settings."
      }
      return undefined
  }
}

/**
 * Extracts status code from various error formats
 */
export function extractStatusCode(error: any): number | undefined {
  // Direct status property
  if (error?.status) return error.status

  // Response status property
  if (error?.response?.status) return error.response.status

  // Extract from error message (e.g., "HTTP 404: Not Found")
  if (error?.message) {
    const match = error.message.match(/HTTP (\d+):/)
    if (match) {
      return parseInt(match[1], 10)
    }
  }

  return undefined
}

/**
 * Extracts error message from various error formats
 */
export function extractErrorMessage(error: any): string {
  if (error?.message) {
    return error.message
  }

  if (typeof error === "string") {
    return error
  }

  if (error && typeof error === "object" && "toString" in error) {
    try {
      return String(error)
    } catch {
      return "Unknown error"
    }
  }

  return "Unknown error"
}

/**
 * Standard validation error handler for embedder configuration validation
 * Returns a consistent error response based on the error type
 */
export function handleValidationError(
  error: any,
  embedderType: string,
  customHandlers?: {
    beforeStandardHandling?: (error: any) => { valid: boolean; error: string } | undefined
  },
): { valid: boolean; error: string } {
  // Allow custom handling first
  if (customHandlers?.beforeStandardHandling) {
    const customResult = customHandlers.beforeStandardHandling(error)
    if (customResult) return customResult
  }

  const statusCode = extractStatusCode(error)
  const errorMessage = extractErrorMessage(error)

  // Check for status-based errors first
  const statusError = getErrorMessageForStatus(statusCode, embedderType)
  if (statusError) {
    return { valid: false, error: statusError }
  }

  // Check for connection errors
  if (errorMessage) {
    if (
      errorMessage.includes("ENOTFOUND") ||
      errorMessage.includes("ECONNREFUSED") ||
      errorMessage.includes("ETIMEDOUT") ||
      errorMessage === "AbortError" ||
      errorMessage.includes("HTTP 0:") ||
      errorMessage === "No response"
    ) {
      return { valid: false, error: "Connection failed. Please check the endpoint URL and network connectivity." }
    }

    if (errorMessage.includes("Failed to parse response JSON")) {
      return { valid: false, error: "Received an invalid response from the embedding service." }
    }
  }

  // For generic errors, preserve the original error message if it's not a standard one
  if (errorMessage && errorMessage !== "Unknown error") {
    return { valid: false, error: errorMessage }
  }

  // Fallback to generic error
  return { valid: false, error: "Configuration error. Please verify your embedder settings." }
}

/**
 * Wraps an async validation function with standard error handling
 */
export async function withValidationErrorHandling<T extends { valid: boolean; error?: string }>(
  validationFn: () => Promise<T>,
  embedderType: string,
  customHandlers?: Parameters<typeof handleValidationError>[2],
): Promise<{ valid: boolean; error?: string }> {
  try {
    return await validationFn()
  } catch (error) {
    return handleValidationError(error, embedderType, customHandlers)
  }
}

/**
 * Formats an embedding error message based on the error type and context
 */
export function formatEmbeddingError(error: any, maxRetries: number): Error {
  const errorMessage = extractErrorMessage(error)
  const statusCode = extractStatusCode(error)

  const toError = (message: string): Error => {
    const err = new Error(message)
    // Preserve the HTTP status so callers (e.g. the directory scanner) can tell a
    // deterministic client error from a transient one without re-parsing the message.
    if (statusCode !== undefined) {
      ;(err as Error & { status?: number }).status = statusCode
    }
    return err
  }

  if (statusCode === 401) {
    return toError("Authentication failed. Please check your API key.")
  }
  if (statusCode) {
    return toError(`Embedding request failed after ${maxRetries} attempts with status ${statusCode}: ${errorMessage}`)
  }
  return toError(`Embedding request failed after ${maxRetries} attempts: ${errorMessage}`)
}

/**
 * Phrases that indicate the request payload exceeded the model's maximum
 * input/context size. These 4xx responses are deterministic: re-sending the
 * same payload cannot succeed, so callers should split the batch instead of
 * retrying it.
 */
const CONTEXT_OVERFLOW_PATTERNS: readonly RegExp[] = [
  /maximum context/i,
  /context (size|length|limit)/i,
  /larger than (the )?max(imum)? context/i,
  /input (is )?too (long|many)/i,
  /prompt (is )?too long/i,
  /too many tokens/i,
  /exceeds? (the |your )?(maximum |max )?(input|context|token)/i,
  /token (limit|length|count).{0,20}(exceed|limit|maximum)/i,
  /payload too large/i,
]

/**
 * Returns true when an embedding error is an "input/context too large" rejection
 * — the model's maximum input token count was exceeded.
 */
export function isContextOverflowError(error: unknown): boolean {
  const status = extractStatusCode(error)
  if (status !== undefined && (status < 400 || status >= 500)) return false
  const message = extractErrorMessage(error)
  if (!message) return false
  return CONTEXT_OVERFLOW_PATTERNS.some((pattern) => pattern.test(message))
}

/**
 * Returns true when an embedding error is a deterministic client error that
 * cannot be resolved by retrying the identical request. 429 (rate limit) and
 * 5xx (server) errors are still considered retryable.
 */
export function isNonRetryableEmbeddingError(error: unknown): boolean {
  const status = extractStatusCode(error)
  if (status === undefined) return false
  if (status === 429) return false
  return status >= 400 && status < 500
}
