// kilocode_change - new file

import { EventEmitter } from "events"
import type { AgentConfig, AgentTask, AgentMessage, AgentState, AgentMetrics } from "./types.js"

export interface IAgent extends EventEmitter {
	readonly id: string
	readonly config: AgentConfig
	readonly state: AgentState

	initialize(): Promise<void>
	start(): Promise<void>
	stop(): Promise<void>
	executeTask(task: AgentTask): Promise<any>
	handleMessage(message: AgentMessage): Promise<void>
	getMetrics(): AgentMetrics
	updateConfig(config: Partial<AgentConfig>): Promise<void>
}

export abstract class BaseAgent extends EventEmitter implements IAgent {
	protected _state: AgentState
	protected _isRunning: boolean = false
	protected _taskQueue: AgentTask[] = []
	protected _messageHandlers: Map<string, (message: AgentMessage) => Promise<void>> = new Map()

	constructor(config: AgentConfig) {
		super()
		this._state = {
			id: config.id,
			config,
			currentTasks: [],
			completedTasks: [],
			status: "idle",
			lastActivity: new Date(),
			stats: {
				tasksCompleted: 0,
				tasksFailed: 0,
				averageExecutionTime: 0,
				successRate: 0,
			},
		}
	}

	get id(): string {
		return this.config.id
	}

	get config(): AgentConfig {
		return this._state.config
	}

	get state(): AgentState {
		return { ...this._state }
	}

	async initialize(): Promise<void> {
		console.log(`[${this.config.type}:${this.config.id}] Initializing agent...`)
		await this.setupMessageHandlers()
		this.emit("initialized")
	}

	async start(): Promise<void> {
		if (this._isRunning) {
			console.warn(`[${this.config.type}:${this.config.id}] Agent is already running`)
			return
		}

		console.log(`[${this.config.type}:${this.config.id}] Starting agent...`)
		this._isRunning = true
		this._state.status = "idle"
		this.emit("started")
	}

	async stop(): Promise<void> {
		if (!this._isRunning) {
			console.warn(`[${this.config.type}:${this.config.id}] Agent is already stopped`)
			return
		}

		console.log(`[${this.config.type}:${this.config.id}] Stopping agent...`)
		this._isRunning = false
		this._state.status = "offline"
		this.emit("stopped")
	}

	async executeTask(task: AgentTask): Promise<any> {
		if (!this._isRunning) {
			throw new Error(`Agent ${this.config.id} is not running`)
		}

		if (this._state.currentTasks.length >= this.config.maxConcurrentTasks) {
			throw new Error(`Agent ${this.config.id} has reached maximum concurrent tasks`)
		}

		console.log(`[${this.config.type}:${this.config.id}] Executing task: ${task.id}`)

		task.status = "in_progress"
		task.startedAt = new Date()
		this._state.currentTasks.push(task)
		this._state.status = "busy"
		this._state.lastActivity = new Date()

		this.emit("taskStarted", task)

		try {
			const result = await this.processTask(task)

			task.status = "completed"
			task.completedAt = new Date()
			task.output = result

			const duration = task.completedAt.getTime() - task.startedAt!.getTime()
			this.updateStats(duration, true)

			this.emit("taskCompleted", task)
			return result
		} catch (error) {
			task.status = "failed"
			task.error = error instanceof Error ? error.message : String(error)
			task.completedAt = new Date()

			const duration = task.completedAt.getTime() - task.startedAt!.getTime()
			this.updateStats(duration, false)

			this.emit("taskFailed", task)
			throw error
		} finally {
			this._state.currentTasks = this._state.currentTasks.filter((t: AgentTask) => t.id !== task.id)
			this._state.completedTasks.push(task)

			if (this._state.currentTasks.length === 0) {
				this._state.status = "idle"
			}
		}
	}

	async handleMessage(message: AgentMessage): Promise<void> {
		console.log(`[${this.config.type}:${this.config.id}] Received message from ${message.from}: ${message.type}`)

		const handler = this._messageHandlers.get(message.type)
		if (handler) {
			await handler(message)
		} else {
			console.warn(`[${this.config.type}:${this.config.id}] No handler for message type: ${message.type}`)
		}

		this.emit("messageReceived", message)
	}

	getMetrics(): AgentMetrics {
		return {
			agentId: this.config.id,
			timestamp: new Date(),
			metrics: {
				taskCount: this._state.completedTasks.length,
				successRate: this._state.stats.successRate,
				averageResponseTime: this._state.stats.averageExecutionTime,
				memoryUsage: process.memoryUsage().heapUsed,
				cpuUsage: 0, // Would need to implement CPU monitoring
				errorCount: this._state.stats.tasksFailed,
			},
		}
	}

	async updateConfig(config: Partial<AgentConfig>): Promise<void> {
		this._state.config = { ...this._state.config, ...config }
		this.emit("configUpdated", this._state.config)
	}

	protected abstract processTask(task: AgentTask): Promise<any>
	protected abstract setupMessageHandlers(): Promise<void>

	protected updateStats(duration: number, success: boolean): void {
		const stats = this._state.stats

		if (success) {
			stats.tasksCompleted++
		} else {
			stats.tasksFailed++
		}

		const totalTasks = stats.tasksCompleted + stats.tasksFailed
		stats.successRate = totalTasks > 0 ? stats.tasksCompleted / totalTasks : 0

		// Update average execution time
		const totalDuration = stats.averageExecutionTime * (totalTasks - 1) + duration
		stats.averageExecutionTime = totalDuration / totalTasks
	}

	protected async sendMessage(
		to: string,
		type: string,
		content: any,
		priority: AgentMessage["priority"] = "medium",
	): Promise<void> {
		const message: AgentMessage = {
			id: `${this.config.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
			from: this.config.id,
			to,
			type: type as any,
			content,
			timestamp: new Date(),
			priority,
		}

		this.emit("messageSent", message)
	}

	protected async broadcastMessage(
		type: string,
		content: any,
		priority: AgentMessage["priority"] = "medium",
	): Promise<void> {
		const message: AgentMessage = {
			id: `${this.config.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
			from: this.config.id,
			to: "*",
			type: type as any,
			content,
			timestamp: new Date(),
			priority,
		}

		this.emit("messageBroadcast", message)
	}
}
