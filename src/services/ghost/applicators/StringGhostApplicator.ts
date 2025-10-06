import { IGhostApplicator } from "./IGhostApplicator"
import { GhostSuggestionsState } from "../GhostSuggestions"

/**
 * String-based implementation for tests and benchmarks
 * Applies operations directly to string content without VSCode APIs
 *
 * This allows tests to verify the complete Ghost workflow including application
 * without requiring VSCode environment or mocking complex VSCode APIs.
 */
export class StringGhostApplicator implements IGhostApplicator {
	private results: Map<string, string> = new Map()
	private locked: boolean = false

	async applyAll(suggestions: GhostSuggestionsState, fileUri: string): Promise<void> {
		const content = this.getOriginalContent(fileUri)
		if (content === undefined) {
			throw new Error(`No original content set for ${fileUri}. Call setOriginalContent() first.`)
		}
		const result = suggestions.applyToContent(content, fileUri)
		this.results.set(fileUri, result)
	}

	async applySelected(suggestions: GhostSuggestionsState, fileUri: string): Promise<void> {
		const content = this.getOriginalContent(fileUri)
		if (content === undefined) {
			throw new Error(`No original content set for ${fileUri}. Call setOriginalContent() first.`)
		}
		const result = suggestions.applyFirstGroup(content, fileUri)
		this.results.set(fileUri, result)
	}

	isLocked(): boolean {
		return this.locked
	}

	/**
	 * Get the result after application (for test assertions)
	 */
	getResult(fileUri: string): string | undefined {
		return this.results.get(fileUri)
	}

	/**
	 * Set the original content for a file (test setup)
	 * MUST be called before applyAll() or applySelected()
	 */
	setOriginalContent(fileUri: string, content: string): void {
		this.results.set(fileUri + ":original", content)
	}

	/**
	 * Clear all stored content (test cleanup)
	 */
	clear(): void {
		this.results.clear()
	}

	private getOriginalContent(fileUri: string): string | undefined {
		return this.results.get(fileUri + ":original")
	}
}
