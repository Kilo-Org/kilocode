/**
 * Generate a unique request ID for messages.
 * Uses a short random string suitable for request correlation.
 */
export function generateRequestId(): string {
	return Math.random().toString(36).substring(2, 9)
}
