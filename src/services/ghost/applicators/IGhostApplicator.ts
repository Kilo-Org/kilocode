import { GhostSuggestionsState } from "../GhostSuggestions"

/**
 * Platform-independent interface for applying Ghost suggestions
 * Implementations: VSCodeGhostApplicator (production), StringGhostApplicator (tests)
 *
 * CRITICAL: This interface uses platform-independent types (string URIs, not vscode.Uri)
 * Each implementation converts to its platform-specific types internally.
 */
export interface IGhostApplicator {
	/**
	 * Apply all suggestions from a GhostSuggestionsState
	 * @param suggestions The suggestions to apply
	 * @param fileUri Platform-independent file URI as string
	 */
	applyAll(suggestions: GhostSuggestionsState, fileUri: string): Promise<void>

	/**
	 * Apply only the selected group of suggestions
	 * @param suggestions The suggestions to apply
	 * @param fileUri Platform-independent file URI as string
	 */
	applySelected(suggestions: GhostSuggestionsState, fileUri: string): Promise<void>

	/**
	 * Check if applicator is currently locked (prevents concurrent edits)
	 * This is essential for preventing race conditions during file modifications
	 */
	isLocked(): boolean
}
