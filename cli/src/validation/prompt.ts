export interface PromptFileValidationResult {
	valid: boolean
	error?: string
}

/**
 * Validates that --prompt-file requires --auto or --json-io flag.
 */
export function validatePromptFileRequiresNonInteractive(options: {
	promptFile?: string
	auto?: boolean
	jsonIo?: boolean
}): PromptFileValidationResult {
	if (!options.promptFile) {
		return { valid: true }
	}

	if (!options.auto && !options.jsonIo) {
		return {
			valid: false,
			error: "Error: --prompt-file option requires --auto or --json-io flag",
		}
	}

	return { valid: true }
}

/**
 * Validates that --prompt-file is not used with prompt arguments or --continue.
 */
export function validatePromptFileConflicts(options: {
	promptFile?: string
	prompt?: string
	continue?: boolean
}): PromptFileValidationResult {
	if (!options.promptFile) {
		return { valid: true }
	}

	if (options.prompt) {
		return {
			valid: false,
			error: "Error: --prompt-file cannot be used with a prompt argument",
		}
	}

	if (options.continue) {
		return {
			valid: false,
			error: "Error: --prompt-file option cannot be used with --continue flag",
		}
	}

	return { valid: true }
}
