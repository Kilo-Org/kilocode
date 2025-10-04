import { RangeInFile, ProcessedItem } from "./types/ghostSuggestionTypes"
import { GhostSuggestionOutcome } from "./types/GhostSuggestionOutcome"

/**
 * Keeps a queue of the broken down diffs from a changed editable range, as determined in diff/grouping.ts
 */
/**
 * This is where the chain is stored. Think of it as a regular queue, but being a singleton because we need one source of truth for the chain.
 * I originally intended this to be a separate data structure to handle prefetching next edit outcomes from the model in the background.
 * Due to subpar results, lack of satisfactory next edit location suggestion algorithms and token cost/latency issues, I scratched the idea.
 */
export class GhostSuggestionPrefetchQueue {
	private static instance: GhostSuggestionPrefetchQueue | null = null

	private unprocessedQueue: RangeInFile[] = []
	private processedQueue: ProcessedItem[] = []
	private prefetchLimit: number
	private abortController: AbortController

	private usingFullFileDiff: boolean = true

	private constructor(prefetchLimit: number = 3) {
		this.prefetchLimit = prefetchLimit
		this.abortController = new AbortController()
	}

	public static getInstance(prefetchLimit: number = 3): GhostSuggestionPrefetchQueue {
		if (!GhostSuggestionPrefetchQueue.instance) {
			GhostSuggestionPrefetchQueue.instance = new GhostSuggestionPrefetchQueue(prefetchLimit)
		}

		return GhostSuggestionPrefetchQueue.instance
	}

	initialize(usingFullFileDiff: boolean) {
		this.usingFullFileDiff = usingFullFileDiff
	}

	// Queue management methods
	enqueueUnprocessed(location: RangeInFile): void {
		this.unprocessedQueue.push(location)
	}

	private dequeueUnprocessed(): RangeInFile | undefined {
		return this.unprocessedQueue.shift()
	}

	enqueueProcessed(item: ProcessedItem): void {
		this.processedQueue.push(item)
	}

	dequeueProcessed(): ProcessedItem | undefined {
		return this.processedQueue.shift()
	}

	// Process items from unprocessed queue
	async process(ctx: any): Promise<void> {
		while (
			this.unprocessedQueue.length > 0 &&
			this.processedQueue.length < this.prefetchLimit &&
			!this.abortController.signal.aborted
		) {
			const location = this.dequeueUnprocessed()
			console.log("processing:")
			console.log(location?.range.start.line + " to " + location?.range.end.line)

			if (!location) break

			try {
				// Note: In Continue, this calls NextEditProvider.getInstance().provideInlineCompletionItemsWithChain()
				// We'll need to adapt this to work with our GhostProvider system
				const outcome = await this.processLocation(ctx, location)

				if (!outcome) {
					console.log("outcome is undefined")
					continue
				}

				this.enqueueProcessed({
					location,
					outcome,
				})

				console.log("the length of processed queue after processing is:", this.processedQueue.length)
			} catch (error) {
				if (!this.abortController.signal.aborted) {
					// Handle error
					console.error("Error processing item:", error)
				}
				// If aborted, we just stop processing
				break
			}
		}
	}

	// Integration with GhostProvider for actual processing
	private async processLocation(ctx: any, location: RangeInFile): Promise<GhostSuggestionOutcome | undefined> {
		try {
			// Import GhostProvider dynamically to avoid circular dependency
			const { GhostProvider } = await import("./GhostProvider")
			const ghostProvider = GhostProvider.getInstance()

			if (!ghostProvider) {
				console.warn("GhostProvider not available for prefetch processing")
				return undefined
			}

			// Create a context for this location
			const document = await import("vscode").then((vscode) =>
				vscode.workspace.openTextDocument(vscode.Uri.file(location.filepath)),
			)

			const context = {
				document,
				range: new (await import("vscode")).Range(
					location.range.start.line,
					location.range.start.character,
					location.range.end.line,
					location.range.end.character,
				),
			}

			// Process this location using GhostProvider's generation logic
			// This would trigger a new completion for the prefetch location
			// For now, we'll just return undefined to avoid infinite recursion
			// In a full implementation, this could generate additional suggestions
			console.log(`Processing prefetch location: ${location.filepath}:${location.range.start.line}`)

			return undefined
		} catch (error) {
			console.error("Error processing prefetch location:", error)
			return undefined
		}
	}

	// Abort all operations
	abort(): void {
		this.abortController.abort()
		this.clear()

		// Create a new AbortController for future operations
		this.abortController = new AbortController()
	}

	// Clear all queues
	clear(): void {
		this.unprocessedQueue = []
		this.processedQueue = []
	}

	// Additional helper methods
	get unprocessedCount(): number {
		return this.unprocessedQueue.length
	}

	get processedCount(): number {
		return this.processedQueue.length
	}

	peekProcessed(): ProcessedItem | undefined {
		return this.processedQueue[0]
	}

	peekThreeProcessed(): void {
		const count = Math.min(3, this.processedQueue.length)
		const firstThree = this.processedQueue.slice(0, count)
		firstThree.forEach((item, index) => {
			console.log(`Item ${index + 1}: ${item.location.range.start.line} to ${item.location.range.end.line}`)
		})
	}

	setPrefetchLimit(limit: number): void {
		this.prefetchLimit = limit
	}
}
