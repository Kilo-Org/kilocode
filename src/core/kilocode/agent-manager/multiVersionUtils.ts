/**
 * Utility functions for multi-version session handling
 */

/** Maximum number of parallel versions allowed */
export const MAX_VERSION_COUNT = 4

export interface SessionConfig {
	prompt: string
	label: string
	parallelMode: boolean
	yoloMode: boolean
}

export interface StartSessionMessage {
	prompt: string
	versions?: number
	labels?: string[]
	parallelMode?: boolean
	yoloMode?: boolean
}

/**
 * Extract session configurations from a start session message.
 *
 * For single version (versions=1 or undefined):
 * - Returns one config with the user's chosen parallelMode and yoloMode
 *
 * For multi-version (versions>1):
 * - Returns multiple configs, one per version
 * - Forces parallelMode=true for isolated worktrees
 * - yoloMode enables auto-approval of all tool operations for autonomous agents
 * - Users can click "Finish to Branch" on each session to commit their changes
 * - Uses provided labels or generates (v1), (v2) suffixes
 */
export function extractSessionConfigs(message: StartSessionMessage): SessionConfig[] {
	const { prompt, versions = 1, labels, parallelMode = false, yoloMode = false } = message

	// Single version case
	if (versions === 1) {
		return [
			{
				prompt,
				label: prompt.slice(0, 50),
				parallelMode,
				yoloMode,
			},
		]
	}

	// Multi-version case: always use parallelMode for isolated worktrees
	// yoloMode is passed through from the message for autonomous operation
	const effectiveLabels = labels ?? Array.from({ length: versions }, (_, i) => `${prompt.slice(0, 50)} (v${i + 1})`)

	return effectiveLabels.map((label) => ({
		prompt,
		label,
		parallelMode: true,
		yoloMode,
	}))
}
