// kilocode_change - new file

import { Worker, MessageChannel, MessagePort } from "worker_threads"
import { EventEmitter } from "events"
import { ParseResult } from "../services/parser/parser-service"

interface WorkerTask {
	id: string
	type: "parse" | "dispose"
	data: any
	resolve: (value: any) => void
	reject: (error: Error) => void
	timestamp: number
}

interface WorkerMessage {
	type: "result" | "error" | "ready"
	id: string
	data: any
}

export class WorkerPool extends EventEmitter {
	private workers: Worker[] = []
	private availableWorkers: Worker[] = []
	private busyWorkers: Map<Worker, Set<string>> = new Map()
	private taskQueue: WorkerTask[] = []
	private pendingTasks: Map<string, WorkerTask> = new Map()
	private maxWorkers: number
	private workerScript: string
	private isInitialized = false
	private taskId = 0

	constructor(maxWorkers: number, workerScript: string) {
		super()
		this.maxWorkers = maxWorkers
		this.workerScript = workerScript
	}

	/**
	 * Initialize the worker pool
	 */
	async initialize(): Promise<void> {
		if (this.isInitialized) {
			return
		}

		console.log(`[WorkerPool] Initializing with ${this.maxWorkers} workers`)

		// Create workers
		const initPromises = []
		for (let i = 0; i < this.maxWorkers; i++) {
			initPromises.push(this.createWorker())
		}

		await Promise.all(initPromises)
		this.isInitialized = true

		console.log(`[WorkerPool] Initialized with ${this.workers.length} workers`)
		this.emit("initialized")
	}

	/**
	 * Execute a task on an available worker
	 */
	async executeTask(type: "parse" | "dispose", data: any): Promise<any> {
		return new Promise((resolve, reject) => {
			const task: WorkerTask = {
				id: `task_${++this.taskId}`,
				type,
				data,
				resolve,
				reject,
				timestamp: Date.now(),
			}

			this.pendingTasks.set(task.id, task)
			this.taskQueue.push(task)

			this.processQueue()
		})
	}

	/**
	 * Parse a file using the worker pool
	 */
	async parseFile(filePath: string, options?: { content?: string; force?: boolean }): Promise<ParseResult> {
		return this.executeTask("parse", { filePath, ...options })
	}

	/**
	 * Parse multiple files in parallel
	 */
	async parseFiles(filePaths: string[], options?: { force?: boolean }): Promise<ParseResult[]> {
		const promises = filePaths.map((filePath) => this.parseFile(filePath, options))
		return Promise.all(promises)
	}

	/**
	 * Get pool statistics
	 */
	getStats(): any {
		return {
			totalWorkers: this.workers.length,
			availableWorkers: this.availableWorkers.length,
			busyWorkers: this.busyWorkers.size,
			queuedTasks: this.taskQueue.length,
			pendingTasks: this.pendingTasks.size,
			isInitialized: this.isInitialized,
		}
	}

	/**
	 * Dispose of the worker pool
	 */
	async dispose(): Promise<void> {
		console.log("[WorkerPool] Disposing worker pool")

		// Clear pending tasks
		for (const task of this.pendingTasks.values()) {
			task.reject(new Error("Worker pool is being disposed"))
		}
		this.pendingTasks.clear()
		this.taskQueue.length = 0

		// Dispose all workers
		const disposePromises = this.workers.map((worker) =>
			this.executeTask("dispose", {}).catch((error) => {
				console.error("[WorkerPool] Error disposing worker:", error)
			}),
		)

		await Promise.all(disposePromises)

		// Terminate workers
		for (const worker of this.workers) {
			worker.terminate()
		}

		this.workers.length = 0
		this.availableWorkers.length = 0
		this.busyWorkers.clear()
		this.isInitialized = false

		console.log("[WorkerPool] Worker pool disposed")
		this.emit("disposed")
	}

	// Private methods

	private async createWorker(): Promise<Worker> {
		return new Promise((resolve, reject) => {
			const worker = new Worker(this.workerScript)

			const timeout = setTimeout(() => {
				worker.terminate()
				reject(new Error("Worker initialization timeout"))
			}, 30000) // 30 second timeout

			worker.once("message", (message: WorkerMessage) => {
				clearTimeout(timeout)

				if (message.type === "ready") {
					this.setupWorkerHandlers(worker)
					this.workers.push(worker)
					this.availableWorkers.push(worker)
					this.busyWorkers.set(worker, new Set())

					console.log(`[WorkerPool] Worker ${this.workers.length} ready`)
					resolve(worker)
				} else {
					worker.terminate()
					reject(new Error(`Worker initialization failed: ${message.data.error}`))
				}
			})

			worker.once("error", (error) => {
				clearTimeout(timeout)
				reject(error)
			})
		})
	}

	private setupWorkerHandlers(worker: Worker): void {
		worker.on("message", (message: WorkerMessage) => {
			this.handleWorkerMessage(worker, message)
		})

		worker.on("error", (error) => {
			console.error("[WorkerPool] Worker error:", error)
			this.handleWorkerError(worker, error)
		})

		worker.on("exit", (code) => {
			if (code !== 0) {
				console.error(`[WorkerPool] Worker exited with code ${code}`)
				this.handleWorkerExit(worker, code)
			}
		})
	}

	private handleWorkerMessage(worker: Worker, message: WorkerMessage): void {
		const task = this.pendingTasks.get(message.id)

		if (!task) {
			console.warn(`[WorkerPool] Received message for unknown task: ${message.id}`)
			return
		}

		this.pendingTasks.delete(message.id)

		// Remove task from busy worker tracking
		const busyTasks = this.busyWorkers.get(worker)
		if (busyTasks) {
			busyTasks.delete(task.id)
			if (busyTasks.size === 0) {
				this.busyWorkers.delete(worker)
				this.availableWorkers.push(worker)
				this.processQueue()
			}
		}

		if (message.type === "result") {
			task.resolve(message.data)
		} else if (message.type === "error") {
			task.reject(new Error(message.data.error))
		}
	}

	private handleWorkerError(worker: Worker, error: Error): void {
		console.error("[WorkerPool] Worker error:", error)

		// Fail all pending tasks for this worker
		const busyTasks = this.busyWorkers.get(worker)
		if (busyTasks) {
			const taskIds = Array.from(busyTasks)
			for (const taskId of taskIds) {
				const task = this.pendingTasks.get(taskId)
				if (task) {
					this.pendingTasks.delete(taskId)
					task.reject(error)
				}
			}
			this.busyWorkers.delete(worker)
		}

		// Remove worker from pool
		const workerIndex = this.workers.indexOf(worker)
		if (workerIndex >= 0) {
			this.workers.splice(workerIndex, 1)
		}

		const availableIndex = this.availableWorkers.indexOf(worker)
		if (availableIndex >= 0) {
			this.availableWorkers.splice(availableIndex, 1)
		}

		// Terminate and replace worker
		worker.terminate()
		this.replaceWorker()
	}

	private handleWorkerExit(worker: Worker, code: number): void {
		console.error(`[WorkerPool] Worker exited with code ${code}`)

		// Remove worker from pool
		const workerIndex = this.workers.indexOf(worker)
		if (workerIndex >= 0) {
			this.workers.splice(workerIndex, 1)
		}

		const availableIndex = this.availableWorkers.indexOf(worker)
		if (availableIndex >= 0) {
			this.availableWorkers.splice(availableIndex, 1)
		}

		this.busyWorkers.delete(worker)

		// Replace worker if it wasn't intentionally disposed
		if (code !== 0 && this.isInitialized) {
			this.replaceWorker()
		}
	}

	private async replaceWorker(): Promise<void> {
		try {
			console.log("[WorkerPool] Replacing failed worker")
			const newWorker = await this.createWorker()
			console.log("[WorkerPool] Worker replacement completed")
		} catch (error) {
			console.error("[WorkerPool] Failed to replace worker:", error)
		}
	}

	private async processQueue(): Promise<void> {
		if (this.taskQueue.length === 0 || this.availableWorkers.length === 0) {
			return
		}

		const tasksToProcess = Math.min(this.taskQueue.length, this.availableWorkers.length)

		for (let i = 0; i < tasksToProcess; i++) {
			const task = this.taskQueue.shift()!
			const worker = this.availableWorkers.shift()!

			// Track task
			const busyTasks = this.busyWorkers.get(worker) || new Set()
			busyTasks.add(task.id)
			this.busyWorkers.set(worker, busyTasks)

			// Send task to worker
			worker.postMessage({
				type: task.type,
				id: task.id,
				data: task.data,
			})
		}
	}
}
