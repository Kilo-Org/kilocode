export interface SequentialWorkQueueItem<T> {
	value: T
	attempts: number
	enqueuedAt: number
}

export type SequentialWorkQueueCanProcess<T> = (item: SequentialWorkQueueItem<T>) => boolean
export type SequentialWorkQueueProcess<T> = (item: SequentialWorkQueueItem<T>) => Promise<void>
export type SequentialWorkQueueShouldRetry<T> = (params: {
	item: SequentialWorkQueueItem<T>
	error: unknown
}) => boolean
export type SequentialWorkQueueOnDrop<T> = (params: { item: SequentialWorkQueueItem<T>; error?: unknown }) => void

export interface SequentialWorkQueueOptions<T> {
	canProcess: SequentialWorkQueueCanProcess<T>
	process: SequentialWorkQueueProcess<T>
	shouldRetry?: SequentialWorkQueueShouldRetry<T>
	onDrop?: SequentialWorkQueueOnDrop<T>
	retryDelayMs?: number
}

export class SequentialWorkQueue<T> {
	private readonly items: SequentialWorkQueueItem<T>[] = []
	private readonly canProcess: SequentialWorkQueueCanProcess<T>
	private readonly processItem: SequentialWorkQueueProcess<T>
	private readonly shouldRetry: SequentialWorkQueueShouldRetry<T>
	private readonly onDrop: SequentialWorkQueueOnDrop<T> | undefined
	private readonly retryDelayMs: number
	private draining = false
	private disposed = false
	private retryTimer: ReturnType<typeof setTimeout> | undefined

	constructor(options: SequentialWorkQueueOptions<T>) {
		this.canProcess = options.canProcess
		this.processItem = options.process
		this.shouldRetry =
			options.shouldRetry ??
			(() => {
				return true
			})
		this.onDrop = options.onDrop
		this.retryDelayMs = options.retryDelayMs ?? 250
	}

	get size(): number {
		return this.items.length
	}

	clear(): void {
		this.items.length = 0
		if (this.retryTimer) {
			clearTimeout(this.retryTimer)
			this.retryTimer = undefined
		}
	}

	enqueue(value: T): void {
		if (this.disposed) return

		this.items.push({
			value,
			attempts: 0,
			enqueuedAt: Date.now(),
		})
		this.kick()
	}

	notify(): void {
		this.kick()
	}

	dispose(): void {
		this.disposed = true
		this.clear()
		this.draining = false
	}

	private kick(): void {
		if (this.disposed) return
		if (this.retryTimer) return
		queueMicrotask(() => void this.drain())
	}

	private scheduleRetry(): void {
		if (this.disposed) return
		if (this.retryTimer) return

		this.retryTimer = setTimeout(() => {
			this.retryTimer = undefined
			void this.drain()
		}, this.retryDelayMs)
	}

	private async processHead(item: SequentialWorkQueueItem<T>): Promise<"processed" | "retry" | "drop"> {
		try {
			await this.processItem(item)
			return "processed"
		} catch (error) {
			if (this.shouldRetry({ item, error })) {
				item.attempts += 1
				return "retry"
			}

			this.onDrop?.({ item, error })
			return "drop"
		}
	}

	private async drain(): Promise<void> {
		if (this.disposed) return
		if (this.draining) return
		if (this.items.length === 0) return

		this.draining = true
		try {
			while (!this.disposed && this.items.length > 0) {
				const item = this.items[0]
				if (!item) return

				if (!this.canProcess(item)) {
					break
				}

				const result = await this.processHead(item)
				if (result === "retry") {
					this.scheduleRetry()
					break
				}

				if (result === "drop") {
					this.items.shift()
					continue
				}

				this.items.shift()
			}
		} finally {
			this.draining = false
		}
	}
}
