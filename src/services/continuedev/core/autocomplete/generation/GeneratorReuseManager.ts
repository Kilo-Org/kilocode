import { ListenableGenerator } from "./ListenableGenerator"

export class GeneratorReuseManager {
	currentGenerator: ListenableGenerator<string> | undefined
	pendingGeneratorPrefix: string | undefined
	pendingCompletion = ""

	constructor(private readonly onError: (err: unknown) => void) {}

	private _createListenableGenerator(abortController: AbortController, gen: AsyncGenerator<string>, prefix: string) {
		this.currentGenerator?.cancel()

		const listenableGen = new ListenableGenerator(gen, this.onError, abortController)
		listenableGen.listen((chunk) => (this.pendingCompletion += chunk ?? ""))

		this.pendingGeneratorPrefix = prefix
		this.pendingCompletion = ""
		this.currentGenerator = listenableGen
	}

	private shouldReuseExistingGenerator(prefix: string): boolean {
		return (
			!!this.currentGenerator &&
			!!this.pendingGeneratorPrefix &&
			(this.pendingGeneratorPrefix + this.pendingCompletion).startsWith(prefix) &&
			// for e.g. backspace
			this.pendingGeneratorPrefix?.length <= prefix?.length
		)
	}

	/**
	 * Ensures `currentGenerator` is set up, without requiring the caller to consume a generator.
	 *
	 * Returns `true` when the existing generator can be reused for the provided prefix; otherwise
	 * cancels the old generator and starts a new one (and returns `false`).
	 *
	 * This is useful in "pull-based UI" scenarios (e.g. VS Code inline completions) where the
	 * consumer might not continuously iterate an output generator, but still wants background
	 * streaming + reuse semantics.
	 */
	ensureGenerator(prefix: string, newGenerator: (abortSignal: AbortSignal) => AsyncGenerator<string>): boolean {
		const reused = this.shouldReuseExistingGenerator(prefix)

		if (!reused) {
			const abortController = new AbortController()
			this._createListenableGenerator(abortController, newGenerator(abortController.signal), prefix)
		}

		return reused
	}

	async *getGenerator(
		prefix: string,
		newGenerator: (abortSignal: AbortSignal) => AsyncGenerator<string>,
		multiline: boolean,
	): AsyncGenerator<string> {
		// If we can't reuse, then create a new generator
		if (!this.shouldReuseExistingGenerator(prefix)) {
			// Create a wrapper over the current generator to fix the prompt
			const abortController = new AbortController()
			this._createListenableGenerator(abortController, newGenerator(abortController.signal), prefix)
		}

		// Already typed characters are those that are new in the prefix from the old generator
		let typedSinceLastGenerator = prefix.slice(this.pendingGeneratorPrefix?.length) || ""
		for await (let chunk of this.currentGenerator?.tee() ?? []) {
			if (!chunk) {
				continue
			}

			// Ignore already typed characters in the completion
			while (chunk.length && typedSinceLastGenerator.length) {
				if (chunk[0] === typedSinceLastGenerator[0]) {
					typedSinceLastGenerator = typedSinceLastGenerator.slice(1)
					chunk = chunk.slice(1)
				} else {
					break
				}
			}

			// Break at newline unless we are in multiline mode
			const newLineIndex = chunk.indexOf("\n")
			if (newLineIndex >= 0 && !multiline) {
				yield chunk.slice(0, newLineIndex)
				break
			} else if (chunk !== "") {
				yield chunk
			}
		}
	}
}
