/**
 * A wrapper around an AsyncGenerator that allows multiple consumers to listen to the same stream.
 * Buffers all values and allows new listeners to receive all past values plus future ones.
 *
 * Adapted from continuedev's ListenableGenerator for Ghost autocomplete use case.
 */
export class GhostListenableGenerator<T> {
	private _source: AsyncGenerator<T>
	private _buffer: T[] = []
	private _listeners: Set<(value: T | null) => void> = new Set()
	private _isEnded = false
	private _abortController: AbortController
	private _completionPromise: Promise<void>
	private _error: unknown = null

	constructor(
		source: AsyncGenerator<T>,
		private readonly onError: (e: unknown) => void,
		abortController: AbortController,
	) {
		this._source = source
		this._abortController = abortController
		this._completionPromise = this._start().catch((e) => {
			console.log(`GhostListenableGenerator failed: ${e?.message || e}`)
		})
	}

	/**
	 * Cancel the generator and abort any pending operations
	 */
	public cancel(): void {
		this._abortController.abort()
		this._isEnded = true
	}

	/**
	 * Check if the generator has finished (either completed or cancelled)
	 */
	public get isEnded(): boolean {
		return this._isEnded
	}

	/**
	 * Check if the generator was cancelled via abort
	 */
	public get isCancelled(): boolean {
		return this._abortController.signal.aborted
	}

	/**
	 * Get any error that occurred during generation
	 */
	public get error(): unknown {
		return this._error
	}

	/**
	 * Wait for the generator to complete
	 */
	public waitForCompletion(): Promise<void> {
		return this._completionPromise
	}

	/**
	 * Get all accumulated values so far
	 */
	public getBuffer(): T[] {
		return [...this._buffer]
	}

	/**
	 * Start consuming the source generator
	 */
	private async _start(): Promise<void> {
		try {
			for await (const value of this._source) {
				if (this._isEnded) {
					break
				}
				this._buffer.push(value)
				for (const listener of this._listeners) {
					listener(value)
				}
			}
		} catch (e) {
			this._error = e
			this.onError(e)
		} finally {
			this._isEnded = true
			// Notify all listeners that the stream has ended
			for (const listener of this._listeners) {
				listener(null)
			}
		}
	}

	/**
	 * Add a listener that will receive all past and future values.
	 * The listener receives null when the stream ends.
	 */
	public listen(listener: (value: T | null) => void): void {
		this._listeners.add(listener)
		// Send all buffered values to the new listener
		for (const value of this._buffer) {
			listener(value)
		}
		// If already ended, notify immediately
		if (this._isEnded) {
			listener(null)
		}
	}

	/**
	 * Remove a listener
	 */
	public unlisten(listener: (value: T | null) => void): void {
		this._listeners.delete(listener)
	}

	/**
	 * Create a new async generator that yields all values from this generator.
	 * Multiple consumers can call tee() to get independent iterators over the same data.
	 */
	public async *tee(): AsyncGenerator<T> {
		let i = 0

		// First, yield all buffered values
		while (i < this._buffer.length) {
			yield this._buffer[i++]
		}

		// Then wait for new values
		while (!this._isEnded) {
			const promise = new Promise<T | null>((resolve) => {
				const listener = (value: T | null) => {
					resolve(value)
					this._listeners.delete(listener)
				}
				this._listeners.add(listener)
			})

			const value = await promise

			// null signals end of stream
			if (value === null) {
				break
			}

			// Yield any values that were added while we were waiting
			while (i < this._buffer.length) {
				yield this._buffer[i++]
			}
		}

		// Yield any remaining buffered values
		while (i < this._buffer.length) {
			yield this._buffer[i++]
		}
	}
}

/**
 * Specialized version for string chunks that accumulates into a single string
 */
export class GhostStringListenableGenerator extends GhostListenableGenerator<string> {
	/**
	 * Get the accumulated string from all chunks
	 */
	public getAccumulatedText(): string {
		return this.getBuffer().join("")
	}
}
