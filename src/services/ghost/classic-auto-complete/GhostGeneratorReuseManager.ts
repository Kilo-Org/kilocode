import { GhostStringListenableGenerator } from "./GhostListenableGenerator"
import { GhostPrompt } from "./GhostInlineCompletionProvider"

/**
 * Information about a pending suggestion that is currently being generated
 */
export interface PendingSuggestion {
	/** The prefix (text before cursor) when the generation started */
	prefix: string
	/** The suffix (text after cursor) when the generation started */
	suffix: string
	/** The listenable generator streaming the completion */
	generator: GhostStringListenableGenerator
	/** The prompt used to generate this suggestion */
	prompt: GhostPrompt
}

/**
 * Result of getting a completion from the generator reuse manager
 */
export interface GeneratorReuseResult {
	/** The completion text (with already-typed characters stripped) */
	text: string
	/** Whether this result came from reusing an existing generator */
	reused: boolean
	/** The original prefix used for the generation */
	originalPrefix: string
	/** The original suffix used for the generation */
	originalSuffix: string
}

/**
 * Manages generator reuse for Ghost autocomplete.
 *
 * When a user types characters that match the beginning of an in-progress completion,
 * this manager reuses the existing generator instead of starting a new API request.
 *
 * Adapted from continuedev's GeneratorReuseManager.
 */
export class GhostGeneratorReuseManager {
	private pendingSuggestion: PendingSuggestion | null = null

	constructor(private readonly onError: (err: unknown) => void) {}

	/**
	 * Check if we can reuse the existing generator for the given prefix/suffix
	 */
	public shouldReuseExistingGenerator(prefix: string, suffix: string): boolean {
		if (!this.pendingSuggestion) {
			return false
		}

		const { prefix: pendingPrefix, suffix: pendingSuffix, generator } = this.pendingSuggestion
		const pendingCompletion = generator.getAccumulatedText()

		return (
			// Same suffix (cursor position relative to end of file hasn't changed)
			pendingSuffix === suffix &&
			// Current prefix starts with the pending prefix (user typed more, not less)
			prefix.startsWith(pendingPrefix) &&
			// The accumulated completion matches what the user has typed
			(pendingPrefix + pendingCompletion).startsWith(prefix) &&
			// Prevent reuse for backspace (prefix got shorter)
			pendingPrefix.length <= prefix.length
		)
	}

	/**
	 * Get the current pending suggestion if any
	 */
	public getPendingSuggestion(): PendingSuggestion | null {
		return this.pendingSuggestion
	}

	/**
	 * Check if there's a pending generation in progress
	 */
	public hasPendingGeneration(): boolean {
		return this.pendingSuggestion !== null && !this.pendingSuggestion.generator.isEnded
	}

	/**
	 * Cancel any pending generation
	 */
	public cancel(): void {
		if (this.pendingSuggestion) {
			this.pendingSuggestion.generator.cancel()
			this.pendingSuggestion = null
		}
	}

	/**
	 * Create a new generator and start tracking it
	 */
	public createGenerator(
		prefix: string,
		suffix: string,
		prompt: GhostPrompt,
		generatorFactory: (abortSignal: AbortSignal) => AsyncGenerator<string>,
	): GhostStringListenableGenerator {
		// Cancel any existing generator
		this.cancel()

		const abortController = new AbortController()
		const generator = new GhostStringListenableGenerator(
			generatorFactory(abortController.signal),
			this.onError,
			abortController,
		)

		this.pendingSuggestion = {
			prefix,
			suffix,
			generator,
			prompt,
		}

		return generator
	}

	/**
	 * Get a completion, either by reusing an existing generator or creating a new one.
	 *
	 * @param prefix - Current text before cursor
	 * @param suffix - Current text after cursor
	 * @param prompt - The prompt to use if we need to create a new generator
	 * @param generatorFactory - Factory function to create a new generator
	 * @returns The completion text with already-typed characters stripped
	 */
	public async getCompletion(
		prefix: string,
		suffix: string,
		prompt: GhostPrompt,
		generatorFactory: (abortSignal: AbortSignal) => AsyncGenerator<string>,
	): Promise<GeneratorReuseResult> {
		// Check if we can reuse the existing generator
		if (!this.shouldReuseExistingGenerator(prefix, suffix)) {
			// Create a new generator
			this.createGenerator(prefix, suffix, prompt, generatorFactory)
		}

		const pending = this.pendingSuggestion!
		const generator = pending.generator

		// Wait for the generator to complete
		await generator.waitForCompletion()

		// Get the full accumulated text
		const fullCompletion = generator.getAccumulatedText()

		// Strip already-typed characters
		const strippedCompletion = this.stripTypedCharacters(prefix, pending.prefix, fullCompletion)

		return {
			text: strippedCompletion,
			reused: prefix !== pending.prefix,
			originalPrefix: pending.prefix,
			originalSuffix: pending.suffix,
		}
	}

	/**
	 * Get a completion by streaming, yielding chunks as they arrive.
	 * Strips already-typed characters from the stream.
	 *
	 * @param prefix - Current text before cursor
	 * @param suffix - Current text after cursor
	 * @param prompt - The prompt to use if we need to create a new generator
	 * @param generatorFactory - Factory function to create a new generator
	 */
	public async *streamCompletion(
		prefix: string,
		suffix: string,
		prompt: GhostPrompt,
		generatorFactory: (abortSignal: AbortSignal) => AsyncGenerator<string>,
	): AsyncGenerator<string, GeneratorReuseResult> {
		// Check if we can reuse the existing generator
		if (!this.shouldReuseExistingGenerator(prefix, suffix)) {
			// Create a new generator
			this.createGenerator(prefix, suffix, prompt, generatorFactory)
		}

		const pending = this.pendingSuggestion!
		const generator = pending.generator

		// Calculate what the user has typed since the generator started
		let typedSinceGenerator = prefix.slice(pending.prefix.length)

		// Stream chunks, stripping already-typed characters
		for await (const chunk of generator.tee()) {
			let remainingChunk = chunk

			// Strip characters that match what the user has typed
			while (remainingChunk.length > 0 && typedSinceGenerator.length > 0) {
				if (remainingChunk[0] === typedSinceGenerator[0]) {
					typedSinceGenerator = typedSinceGenerator.slice(1)
					remainingChunk = remainingChunk.slice(1)
				} else {
					// Mismatch - the user typed something different
					// We should still yield the remaining chunk
					break
				}
			}

			if (remainingChunk.length > 0) {
				yield remainingChunk
			}
		}

		return {
			text: this.stripTypedCharacters(prefix, pending.prefix, generator.getAccumulatedText()),
			reused: prefix !== pending.prefix,
			originalPrefix: pending.prefix,
			originalSuffix: pending.suffix,
		}
	}

	/**
	 * Strip characters that the user has already typed from the completion
	 */
	private stripTypedCharacters(currentPrefix: string, originalPrefix: string, completion: string): string {
		// What the user typed since the generation started
		const typedSinceGenerator = currentPrefix.slice(originalPrefix.length)

		let result = completion
		let typed = typedSinceGenerator

		// Strip matching prefix
		while (result.length > 0 && typed.length > 0) {
			if (result[0] === typed[0]) {
				result = result.slice(1)
				typed = typed.slice(1)
			} else {
				// Mismatch - stop stripping
				break
			}
		}

		return result
	}

	/**
	 * Clear the pending suggestion without cancelling it
	 * (useful when the suggestion has been accepted or cached)
	 */
	public clear(): void {
		this.pendingSuggestion = null
	}
}
