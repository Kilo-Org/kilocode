import { LRUCache } from "lru-cache"
import { CodeContext } from "../ContextGatherer"
import { processTextInsertion } from "../utils/CompletionTextProcessor"
import { Autocompletion } from "../types"
import * as vscode from "vscode"

/**
 * Manages caching of code completions to improve response time and reduce API calls
 */
export class AutocompleteCache {
	private cache: LRUCache<string, Autocompletion[]>
	private readonly maxCompletionsPerContext = 5
	private readonly maxLinesToConsider = 5

	constructor() {
		this.cache = new LRUCache<string, Autocompletion[]>({
			max: 50,
			ttl: 1000 * 60 * 60 * 24, // Default: Cache for 24 hours
		})
	}

	/**
	 * Finds a matching completion from the cache that starts with the current line prefix
	 * @returns Processed completion ready for insertion if found, null otherwise
	 */
	public findMatchingCompletion(context: CodeContext): Autocompletion | null {
		const linePrefix = context.document
			.getText(new vscode.Range(new vscode.Position(context.position.line, 0), context.position))
			.trimStart()

		const cachedCompletions = this.getCompletionsInternal(context)

		for (const completion of cachedCompletions) {
			if (completion.text.startsWith(linePrefix)) {
				// Subtract the current line prefix from the cached completion
				const completionWithoutPrefix = completion.text.substring(linePrefix.length)

				// Adjust the range to account for the current cursor position
				const adjustedRange = new vscode.Range(
					context.position,
					context.position.translate(0, completionWithoutPrefix.length),
				)

				return {
					text: completionWithoutPrefix,
					range: adjustedRange,
					originalPrefix: completion.originalPrefix,
				}
			}
		}

		return null
	}

	/**
	 * Adds a new completion to the cache
	 * @returns true if the completion was added, false if it was already in the cache
	 */
	public addCompletion(context: CodeContext, completion: Autocompletion): boolean {
		const key = this.generateKey(context)
		const completions = this.cache.get(key) ?? []

		// Add the new completion if it's not already in the list
		const existingCompletion = completions.find(
			(c) => c.text === completion.text && c.originalPrefix === completion.originalPrefix,
		)
		if (existingCompletion) {
			return false
		}

		completions.push(completion)

		// Prune the array if it exceeds the maximum size
		// Keep the most recent completions (remove from the beginning)
		if (completions.length > this.maxCompletionsPerContext) {
			completions.splice(0, completions.length - this.maxCompletionsPerContext)
		}

		this.cache.set(key, completions)
		console.log(
			`🚀🛑 Saved new cache entry for completion: '${completion.text}' with prefix: '${completion.originalPrefix}'`,
		)

		return true
	}

	/**
	 * Gets completions from the cache for a given context (private helper)
	 */
	private getCompletionsInternal(context: CodeContext): Autocompletion[] {
		const key = this.generateKey(context)
		return this.cache.get(key) ?? []
	}

	/**
	 * Generates a cache key based on context's preceding and following lines
	 */
	private generateKey(context: CodeContext): string {
		const precedingContext = context.precedingLines.slice(-this.maxLinesToConsider).join("\n")
		const followingContext = context.followingLines.slice(0, this.maxLinesToConsider).join("\n")
		return `${precedingContext}|||${followingContext}`
	}

	/**
	 * Clears the entire cache
	 */
	public clear(): void {
		this.cache.clear()
	}
}
