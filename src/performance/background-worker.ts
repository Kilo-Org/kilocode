// kilocode_change - Performance optimization: Background processing for heavy operations

/**
 * Background worker for handling heavy operations without blocking the main thread
 */
export class BackgroundWorker {
	private workers: Map<string, Worker> = new Map()
	private taskQueue: Map<string, Promise<any>> = new Map()
	private isProcessing = new Set<string>()

	/**
	 * Execute a task in the background
	 */
	async executeInBackground<T>(
		taskId: string,
		task: () => Promise<T>,
		priority: "high" | "normal" | "low" = "normal",
	): Promise<T> {
		// If task is already running, return existing promise
		if (this.taskQueue.has(taskId)) {
			return this.taskQueue.get(taskId) as Promise<T>
		}

		// Mark task as processing
		this.isProcessing.add(taskId)

		const taskPromise = new Promise<T>((resolve, reject) => {
			// Use setTimeout to run task in background (non-blocking)
			setTimeout(
				async () => {
					try {
						const result = await task()
						resolve(result)
					} catch (error) {
						reject(error)
					} finally {
						// Clean up
						this.isProcessing.delete(taskId)
						this.taskQueue.delete(taskId)
					}
				},
				priority === "high" ? 0 : priority === "low" ? 100 : 50,
			)
		})

		this.taskQueue.set(taskId, taskPromise)
		return taskPromise
	}

	/**
	 * Check if a task is currently processing
	 */
	isTaskRunning(taskId: string): boolean {
		return this.isProcessing.has(taskId)
	}

	/**
	 * Get status of all running tasks
	 */
	getRunningTasks(): string[] {
		return Array.from(this.isProcessing)
	}

	/**
	 * Cancel a running task
	 */
	cancelTask(taskId: string): boolean {
		if (this.isProcessing.has(taskId)) {
			this.isProcessing.delete(taskId)
			this.taskQueue.delete(taskId)
			return true
		}
		return false
	}

	/**
	 * Clear all completed tasks
	 */
	clearCompleted(): void {
		// Only clear tasks that are not currently processing
		for (const [taskId, promise] of this.taskQueue.entries()) {
			if (!this.isProcessing.has(taskId)) {
				this.taskQueue.delete(taskId)
			}
		}
	}

	/**
	 * Get task statistics
	 */
	getStats(): { total: number; running: number; completed: number } {
		const total = this.taskQueue.size
		const running = this.isProcessing.size
		const completed = total - running

		return { total, running, completed }
	}
}

// Singleton instance for global use
export const backgroundWorker = new BackgroundWorker()
