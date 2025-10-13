/**
 * Constants for CI mode behavior
 */

/**
 * Standard messages used in CI mode for non-interactive responses
 */
export const CI_MODE_MESSAGES = {
	/**
	 * Message sent to AI when a follow-up question is asked in CI mode
	 * This informs the AI that it should make autonomous decisions
	 */
	FOLLOWUP_RESPONSE:
		"This process is running in non-interactive CI mode. No user input is available. You must make autonomous decisions based on best practices and reasonable assumptions. Proceed with the most appropriate option.",

	/**
	 * Message sent when an operation is automatically rejected in CI mode
	 * based on configuration settings
	 */
	AUTO_REJECTED:
		"This operation was automatically rejected in CI mode due to configuration restrictions. Please find an alternative approach that doesn't require this operation, or break down the task into steps that comply with the configured auto-approval rules.",
} as const
