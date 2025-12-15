/**
 * Utility functions for multi-version session handling
 */

/** Maximum number of parallel versions allowed */
export const MAX_VERSION_COUNT = 4

export interface SessionConfig {
	prompt: string
	label: string
	parallelMode: boolean
	autoMode: boolean
	existingBranch?: string
}

export interface StartSessionMessage {
	prompt: string
	versions?: number
	labels?: string[]
	parallelMode?: boolean
	existingBranch?: string
}

/**
 * Extract session configurations from a start session message.
 *
 * For single version (versions=1 or undefined):
 * - Returns one config with the user's chosen parallelMode
 * - autoMode is false (interactive)
 *
 * For multi-version (versions>1):
 * - Returns multiple configs, one per version
 * - Forces parallelMode=true for isolated worktrees, autoMode=false for interactive finishing
 * - Users can click "Finish to Branch" on each session to commit their changes
 * - Uses provided labels or generates (v1), (v2) suffixes
 */
export function extractSessionConfigs(message: StartSessionMessage): SessionConfig[] {
	const { prompt, versions = 1, labels, parallelMode = false, existingBranch } = message

	// Single version case
	if (versions === 1) {
		return [
			{
				prompt,
				label: prompt.slice(0, 50),
				parallelMode,
				autoMode: false,
				existingBranch,
			},
		]
	}

	// Multi-version case: always use parallelMode, but start interactively (autoMode=false)
	// Users can click the "Finish to Branch" button on individual sessions to commit their changes
	// Note: existingBranch is not supported in multi-version mode as each version needs isolated branches
	const effectiveLabels = labels ?? Array.from({ length: versions }, (_, i) => `${prompt.slice(0, 50)} (v${i + 1})`)

	return effectiveLabels.map((label) => ({
		prompt,
		label,
		parallelMode: true,
		autoMode: false,
		// existingBranch is deliberately excluded in multi-version mode
	}))
}
