// kilocode_change - new file
import * as vscode from "vscode"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"
import { CommitMessageGenerator } from "./CommitMessageGenerator"
import { GitExtensionService } from "./GitExtensionService"

/**
 * Minimum debounce delay in milliseconds.
 * The adaptive debounce delay will never go below this value, even when
 * average latencies are very fast.
 */
const MIN_DEBOUNCE_DELAY_MS = 300

/**
 * Initial debounce delay in milliseconds.
 * This value is used as the starting debounce delay before enough latency samples
 * are collected.
 */
const INITIAL_DEBOUNCE_DELAY_MS = 500

/**
 * Maximum debounce delay in milliseconds.
 * This caps the adaptive debounce delay to prevent excessive waiting times
 * even when latencies are high.
 */
const MAX_DEBOUNCE_DELAY_MS = 2000

/**
 * Number of latency samples to collect before using adaptive debounce delay.
 */
const LATENCY_SAMPLE_SIZE = 5

/**
 * Maximum number of cached suggestions to keep in history.
 */
const MAX_SUGGESTIONS_HISTORY = 10

/**
 * Command ID for tracking inline completion acceptance.
 */
export const GIT_COMMIT_COMPLETION_ACCEPTED_COMMAND = "kilocode.git-commit.inline-completion.accepted"

/**
 * Represents a cached commit message suggestion.
 */
interface CommitMessageSuggestion {
	/** The generated commit message text */
	text: string
	/** The prefix (user input) when this suggestion was generated */
	prefix: string
	/** Hash of the git diff context when this suggestion was generated */
	contextHash: string
}

/**
 * Provides inline completion items for the Git commit message input box.
 * This provider generates AI-powered commit message suggestions based on
 * staged changes in the repository.
 *
 * Based on the GhostInlineCompletionProvider pattern but simplified for
 * commit message generation.
 */
/**
 * Represents a pending request with its associated prefix and context.
 */
interface PendingRequest {
	/** The prefix (user input) when this request was started */
	prefix: string
	/** Hash of the git diff context when this request was started */
	contextHash: string
	/** The promise that resolves when the request completes */
	promise: Promise<void>
}

export class GitCommitInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
	private suggestionsHistory: CommitMessageSuggestion[] = []
	private generator: CommitMessageGenerator
	private debounceTimer: NodeJS.Timeout | null = null
	private debounceDelayMs: number = INITIAL_DEBOUNCE_DELAY_MS
	private latencyHistory: number[] = []
	private isFirstCall: boolean = true
	private pendingRequests: PendingRequest[] = []
	private lastContextHash: string = ""
	private acceptedCommand: vscode.Disposable | null = null

	constructor(
		private context: vscode.ExtensionContext,
		private outputChannel: vscode.OutputChannel,
	) {
		const providerSettingsManager = new ProviderSettingsManager(this.context)
		this.generator = new CommitMessageGenerator(providerSettingsManager)

		// Register the acceptance tracking command
		this.acceptedCommand = vscode.commands.registerCommand(GIT_COMMIT_COMPLETION_ACCEPTED_COMMAND, () => {
			this.outputChannel.appendLine("[GitCommitInlineCompletionProvider] Commit message suggestion accepted")
		})
	}

	/**
	 * Provides inline completion items for the Git commit message input box.
	 */
	async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		_context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken,
	): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList> {
		// Only provide completions for the SCM input box
		if (document.uri.scheme !== "vscode-scm") {
			return []
		}

		// Get the current text in the input box (prefix)
		const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), position))

		// Get the workspace path from the document URI or active workspace
		const workspacePath = this.getWorkspacePath()
		if (!workspacePath) {
			return []
		}

		// Get the current git context hash to detect if changes have occurred
		const contextHash = await this.getGitContextHash(workspacePath)
		if (!contextHash) {
			return []
		}

		// Check cache first for matching suggestions
		const cachedResult = this.findMatchingSuggestion(prefix, contextHash)
		if (cachedResult) {
			return this.stringToInlineCompletions(cachedResult, position, prefix)
		}

		// Skip if user has typed a substantial amount (let them finish their thought)
		if (prefix.length > 50) {
			return []
		}

		// Debounced fetch for new suggestions
		await this.debouncedFetchAndCacheSuggestion(workspacePath, prefix, contextHash, token)

		// Check cache again after fetch
		const newCachedResult = this.findMatchingSuggestion(prefix, contextHash)
		if (newCachedResult) {
			return this.stringToInlineCompletions(newCachedResult, position, prefix)
		}

		return []
	}

	/**
	 * Find a matching suggestion from the history based on current prefix and context.
	 * Returns only the first (most recent) match to avoid overlapping suggestions.
	 */
	private findMatchingSuggestion(prefix: string, contextHash: string): string | null {
		// Search from most recent to least recent, return first match only
		for (let i = this.suggestionsHistory.length - 1; i >= 0; i--) {
			const suggestion = this.suggestionsHistory[i]

			// Context must match (same staged changes)
			if (suggestion.contextHash !== contextHash) {
				continue
			}

			// Exact prefix match - return the suggestion text as-is
			if (prefix === suggestion.prefix) {
				return suggestion.text
			}

			// Partial typing match: user has typed more of the suggestion
			// This handles the case where user types "fe" and we have a suggestion for "" with text "feat: add feature"
			// We need to check if what the user typed matches the beginning of the full message
			const fullMessage = suggestion.prefix + suggestion.text
			if (
				fullMessage.toLowerCase().startsWith(prefix.toLowerCase()) &&
				prefix.length > suggestion.prefix.length
			) {
				// User has typed part of the suggestion, return the remaining part
				return fullMessage.substring(prefix.length)
			}

			// Also check if user typed exactly what was in the suggestion text
			if (
				suggestion.text !== "" &&
				prefix.startsWith(suggestion.prefix) &&
				suggestion.text.toLowerCase().startsWith(prefix.substring(suggestion.prefix.length).toLowerCase())
			) {
				const typedContent = prefix.substring(suggestion.prefix.length)
				return suggestion.text.substring(typedContent.length)
			}

			// Backward deletion: user deleted characters
			if (suggestion.text !== "" && suggestion.prefix.startsWith(prefix)) {
				const deletedContent = suggestion.prefix.substring(prefix.length)
				return deletedContent + suggestion.text
			}
		}

		return null
	}

	/**
	 * Update the suggestions history with a new suggestion.
	 */
	private updateSuggestions(suggestion: CommitMessageSuggestion): void {
		const isDuplicate = this.suggestionsHistory.some(
			(existing) =>
				existing.text === suggestion.text &&
				existing.prefix === suggestion.prefix &&
				existing.contextHash === suggestion.contextHash,
		)

		if (isDuplicate) {
			return
		}

		this.suggestionsHistory.push(suggestion)

		if (this.suggestionsHistory.length > MAX_SUGGESTIONS_HISTORY) {
			this.suggestionsHistory.shift()
		}
	}

	/**
	 * Find a pending request that covers the current prefix and context.
	 * A request covers the current position if:
	 * 1. The context hash matches (same staged changes)
	 * 2. The current prefix either equals or extends the pending prefix
	 *    (user is typing forward, not backspacing or editing earlier)
	 *
	 * @returns The covering pending request, or null if none found
	 */
	private findCoveringPendingRequest(prefix: string, contextHash: string): PendingRequest | null {
		for (const pendingRequest of this.pendingRequests) {
			// Context hash must match exactly (same staged changes)
			if (contextHash !== pendingRequest.contextHash) {
				continue
			}

			// Current prefix must start with the pending prefix (user typed more)
			// or be exactly equal (same position)
			if (prefix.startsWith(pendingRequest.prefix)) {
				return pendingRequest
			}
		}
		return null
	}

	/**
	 * Remove a pending request from the list when it completes.
	 */
	private removePendingRequest(request: PendingRequest): void {
		const index = this.pendingRequests.indexOf(request)
		if (index !== -1) {
			this.pendingRequests.splice(index, 1)
		}
	}

	/**
	 * Debounced fetch with leading edge execution and pending request reuse.
	 * - First call executes immediately (leading edge)
	 * - Subsequent calls reset the timer and wait for debounce delay of inactivity (trailing edge)
	 * - If a pending request covers the current prefix/context, reuse it instead of starting a new one
	 */
	private debouncedFetchAndCacheSuggestion(
		workspacePath: string,
		prefix: string,
		contextHash: string,
		token: vscode.CancellationToken,
	): Promise<void> {
		// Check if any existing pending request covers this one
		const coveringRequest = this.findCoveringPendingRequest(prefix, contextHash)
		if (coveringRequest) {
			// Wait for the existing request to complete - no need to start a new one
			return coveringRequest.promise
		}

		// First call executes immediately
		if (this.isFirstCall && this.debounceTimer === null) {
			this.isFirstCall = false
			return this.fetchAndCacheSuggestion(workspacePath, prefix, contextHash, token)
		}

		// Clear any existing timer
		if (this.debounceTimer !== null) {
			clearTimeout(this.debounceTimer)
		}

		// Create the pending request object first so we can reference it in the cleanup
		const pendingRequest: PendingRequest = {
			prefix,
			contextHash,
			promise: null!, // Will be set immediately below
		}

		const requestPromise = new Promise<void>((resolve) => {
			this.debounceTimer = setTimeout(async () => {
				this.debounceTimer = null
				this.isFirstCall = true
				await this.fetchAndCacheSuggestion(workspacePath, prefix, contextHash, token)
				// Remove this request from pending when done
				this.removePendingRequest(pendingRequest)
				resolve()
			}, this.debounceDelayMs)
		})

		// Complete the pending request object
		pendingRequest.promise = requestPromise

		// Add to the list of pending requests
		this.pendingRequests.push(pendingRequest)

		return requestPromise
	}

	/**
	 * Fetch a new commit message suggestion from the AI.
	 */
	private async fetchAndCacheSuggestion(
		workspacePath: string,
		prefix: string,
		contextHash: string,
		token: vscode.CancellationToken,
	): Promise<void> {
		const startTime = performance.now()

		if (token.isCancellationRequested) {
			return
		}

		let gitService: GitExtensionService | null = null

		try {
			gitService = new GitExtensionService(workspacePath)

			// Get staged changes first, fall back to unstaged
			let changes = await gitService.gatherChanges({ staged: true })
			let usedStaged = true

			if (changes.length === 0) {
				changes = await gitService.gatherChanges({ staged: false })
				usedStaged = false
			}

			if (changes.length === 0) {
				return
			}

			// Get the git context for message generation
			const gitContext = await gitService.getCommitContext(changes, {
				staged: usedStaged,
				includeRepoContext: true,
			})

			// Generate the commit message
			const message = await this.generator.generateMessage({
				workspacePath,
				selectedFiles: changes.map((c) => c.filePath),
				gitContext,
			})

			if (!message) {
				return
			}

			// Process the suggestion: if user has typed a prefix, remove it from the suggestion
			let suggestionText = message
			if (prefix && message.toLowerCase().startsWith(prefix.toLowerCase())) {
				suggestionText = message.substring(prefix.length)
			} else if (prefix) {
				// If the prefix doesn't match the start of the message, prepend a newline
				// to suggest the full message on a new line, or just return the full message
				suggestionText = message
			}

			// Cache the suggestion
			this.updateSuggestions({
				text: suggestionText,
				prefix,
				contextHash,
			})

			// Record latency for adaptive debounce
			const latencyMs = performance.now() - startTime
			this.recordLatency(latencyMs)

			this.outputChannel.appendLine(
				`[GitCommitInlineCompletionProvider] Generated suggestion in ${Math.round(latencyMs)}ms`,
			)
		} catch (error) {
			this.outputChannel.appendLine(
				`[GitCommitInlineCompletionProvider] Error generating suggestion: ${error instanceof Error ? error.message : String(error)}`,
			)
		} finally {
			gitService?.dispose()
		}
	}

	/**
	 * Get a hash representing the current git context (staged changes).
	 * This is used to invalidate cached suggestions when changes occur.
	 */
	private async getGitContextHash(workspacePath: string): Promise<string | null> {
		let gitService: GitExtensionService | null = null

		try {
			gitService = new GitExtensionService(workspacePath)

			// Get staged changes first, fall back to unstaged
			let changes = await gitService.gatherChanges({ staged: true })

			if (changes.length === 0) {
				changes = await gitService.gatherChanges({ staged: false })
			}

			if (changes.length === 0) {
				return null
			}

			// Create a simple hash from the file paths and statuses
			const hashInput = changes.map((c) => `${c.filePath}:${c.status}:${c.staged}`).join("|")

			// Simple string hash
			let hash = 0
			for (let i = 0; i < hashInput.length; i++) {
				const char = hashInput.charCodeAt(i)
				hash = (hash << 5) - hash + char
				hash = hash & hash // Convert to 32bit integer
			}

			return hash.toString(16)
		} catch (error) {
			return null
		} finally {
			gitService?.dispose()
		}
	}

	/**
	 * Get the workspace path from the active workspace.
	 */
	private getWorkspacePath(): string | null {
		const workspaceFolders = vscode.workspace.workspaceFolders
		if (workspaceFolders && workspaceFolders.length > 0) {
			return workspaceFolders[0].uri.fsPath
		}
		return null
	}

	/**
	 * Convert a suggestion string to inline completion items.
	 * When the input box is empty (position at 0,0), we prepend a newline to visually
	 * separate the suggestion from the placeholder text, but use filterText to ensure
	 * only the actual message is inserted when accepted.
	 */
	private stringToInlineCompletions(
		text: string,
		position: vscode.Position,
		prefix: string,
	): vscode.InlineCompletionItem[] {
		if (text === "") {
			return []
		}

		// When the input box is empty, prepend a newline to visually separate from placeholder
		const isEmptyInput = prefix === ""
		const displayText = isEmptyInput ? "\n" + text : text

		const item = new vscode.InlineCompletionItem(displayText, new vscode.Range(position, position), {
			command: GIT_COMMIT_COMPLETION_ACCEPTED_COMMAND,
			title: "Commit Message Accepted",
		})

		// Use filterText to ensure only the actual message (without newline) is inserted
		if (isEmptyInput) {
			item.filterText = text
		}

		return [item]
	}

	/**
	 * Records a latency measurement and updates the adaptive debounce delay.
	 */
	private recordLatency(latencyMs: number): void {
		this.latencyHistory.push(latencyMs)

		if (this.latencyHistory.length > LATENCY_SAMPLE_SIZE) {
			this.latencyHistory.shift()

			const sum = this.latencyHistory.reduce((acc, val) => acc + val, 0)
			const averageLatency = Math.round(sum / this.latencyHistory.length)

			this.debounceDelayMs = Math.max(MIN_DEBOUNCE_DELAY_MS, Math.min(averageLatency, MAX_DEBOUNCE_DELAY_MS))
		}
	}

	/**
	 * Clear the suggestions cache. Useful when git state changes significantly.
	 */
	public clearCache(): void {
		this.suggestionsHistory = []
		this.lastContextHash = ""
	}

	/**
	 * Dispose of resources.
	 */
	public dispose(): void {
		if (this.debounceTimer !== null) {
			clearTimeout(this.debounceTimer)
			this.debounceTimer = null
		}

		if (this.acceptedCommand) {
			this.acceptedCommand.dispose()
			this.acceptedCommand = null
		}
	}
}
