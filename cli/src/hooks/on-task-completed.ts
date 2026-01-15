/**
 * Validate the on-task-completed prompt string.
 * Returns an object with valid flag and optional error message.
 *
 * Validation rules:
 * - Must not be empty or whitespace-only
 * - Must not exceed 50,000 characters (reasonable limit for prompts)
 * - Handles special characters, markdown, and newlines (all allowed)
 */
export function validateOnTaskCompletedPrompt(prompt: string): { valid: boolean; error?: string } {
	// Check for empty or whitespace-only
	if (!prompt || prompt.trim().length === 0) {
		return { valid: false, error: "--on-task-completed prompt cannot be empty" }
	}

	// Check for maximum length (50KB is a reasonable limit)
	const maxLength = 50000
	if (prompt.length > maxLength) {
		return {
			valid: false,
			error: `--on-task-completed prompt exceeds maximum length of ${maxLength} characters (got ${prompt.length})`,
		}
	}

	return { valid: true }
}
