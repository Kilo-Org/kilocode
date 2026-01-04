// kilocode_change - new file

import { EventEmitter } from "events"
import { IAgent } from "./base-agent.js"
import { AgentConfig, AgentTask, AgentMessage, AgentRegistryConfig, AgentMetrics } from "./types.js"
import { PlannerAgent, PlannerConfig } from "./planner-agent.js"
import { ExecutorAgent, ExecutorConfig } from "./executor-agent.js"
import { VerifierAgent, VerifierConfig } from "./verifier-agent.js"
// kilocode_change - Import QA Agent
import { QAAgent } from "./qa-agent.js"

export class AgentRegistry extends EventEmitter {
	private _agents: Map<string, IAgent> = new Map()
	private _config: AgentRegistryConfig
	private _taskQueue: AgentTask[] = []
	private _metricsHistory: AgentMetrics[] = []
	private _isProcessingQueue: boolean = false

	constructor(config: AgentRegistryConfig) {
		super()
		this._config = config
		console.log("[AgentRegistry] Initialized with config:", config)
	}

	/**
	 * Register a new agent
	 */
	async registerAgent(agent: IAgent): Promise<void> {
		if (this._agents.size >= this._config.maxAgents) {
			throw new Error(`Maximum number of agents (${this._config.maxAgents}) reached`)
		}

		if (this._agents.has(agent.config.id)) {
			throw new Error(`Agent with ID ${agent.config.id} is already registered`)
		}

		console.log(`[AgentRegistry] Registering agent: ${agent.config.id} (${agent.config.type})`)

		// Set up event listeners
		agent.on("initialized", () => this.handleAgentEvent("agent_initialized", agent))
		agent.on("started", () => this.handleAgentEvent("agent_started", agent))
		agent.on("stopped", () => this.handleAgentEvent("agent_stopped", agent))
		agent.on("taskStarted", (task) => this.handleTaskEvent("task_started", agent, task))
		agent.on("taskCompleted", (task) => this.handleTaskEvent("task_completed", agent, task))
		agent.on("taskFailed", (task) => this.handleTaskEvent("task_failed", agent, task))
		agent.on("messageSent", (message) => this.handleMessageEvent("message_sent", agent, message))
		agent.on("messageBroadcast", (message) => this.handleMessageEvent("message_broadcast", agent, message))

		// Initialize and start the agent
		await agent.initialize()
		await agent.start()

		this._agents.set(agent.config.id, agent)
		this.emit("agentRegistered", agent)

		console.log(`[AgentRegistry] Agent registered successfully: ${agent.config.id}`)
	}

	/**
	 * Unregister an agent
	 */
	async unregisterAgent(agentId: string): Promise<void> {
		const agent = this._agents.get(agentId)
		if (!agent) {
			throw new Error(`Agent with ID ${agentId} is not registered`)
		}

		console.log(`[AgentRegistry] Unregistering agent: ${agentId}`)

		await agent.stop()
		this._agents.delete(agentId)

		this.emit("agentUnregistered", agent)
		console.log(`[AgentRegistry] Agent unregistered successfully: ${agentId}`)
	}

	/**
	 * Get an agent by ID
	 */
	getAgent(agentId: string): IAgent | undefined {
		return this._agents.get(agentId)
	}

	/**
	 * Get all agents
	 */
	getAllAgents(): IAgent[] {
		return Array.from(this._agents.values())
	}

	/**
	 * Get agents by type
	 */
	getAgentsByType(type: string): IAgent[] {
		return this.getAllAgents().filter((agent) => agent.config.type === type)
	}

	/**
	 * Get available agents (enabled and not busy)
	 */
	getAvailableAgents(): IAgent[] {
		return this.getAllAgents().filter(
			(agent) => agent.config.enabled && agent.state.status !== "busy" && agent.state.status !== "offline",
		)
	}

	/**
	 * Submit a task to the registry
	 */
	async submitTask(task: AgentTask): Promise<void> {
		if (this._taskQueue.length >= this._config.taskQueueSize) {
			throw new Error(`Task queue is full (${this._config.taskQueueSize} tasks)`)
		}

		console.log(`[AgentRegistry] Submitting task: ${task.id} to agent: ${task.assignedTo}`)

		this._taskQueue.push(task)
		this.emit("taskQueued", task)

		// Start processing the queue if not already processing
		if (!this._isProcessingQueue) {
			this.processTaskQueue()
		}
	}

	/**
	 * Send a message between agents
	 */
	async sendMessage(message: AgentMessage): Promise<void> {
		console.log(`[AgentRegistry] Routing message from ${message.from} to ${message.to}`)

		if (message.to === "*") {
			// Broadcast to all agents except sender
			for (const agent of this._agents.values()) {
				if (agent.config.id !== message.from) {
					await agent.handleMessage(message)
				}
			}
		} else {
			// Send to specific agent
			const targetAgent = this._agents.get(message.to)
			if (!targetAgent) {
				throw new Error(`Agent with ID ${message.to} not found`)
			}

			await targetAgent.handleMessage(message)
		}

		this.emit("messageRouted", message)
	}

	/**
	 * Get registry statistics
	 */
	getStats(): {
		totalAgents: number
		agentsByType: Record<string, number>
		availableAgents: number
		busyAgents: number
		taskQueueSize: number
		averageTaskDuration: number
		successRate: number
	} {
		const agents = this.getAllAgents()
		const agentsByType: Record<string, number> = {}

		for (const agent of agents) {
			agentsByType[agent.config.type] = (agentsByType[agent.config.type] || 0) + 1
		}

		const completedTasks = this._metricsHistory.flatMap((m) => (m.metrics.taskCount > 0 ? [m] : []))

		const averageTaskDuration =
			completedTasks.length > 0
				? completedTasks.reduce((sum, m) => sum + m.metrics.averageResponseTime, 0) / completedTasks.length
				: 0

		const successRate =
			completedTasks.length > 0
				? completedTasks.reduce((sum, m) => sum + m.metrics.successRate, 0) / completedTasks.length
				: 0

		return {
			totalAgents: agents.length,
			agentsByType,
			availableAgents: this.getAvailableAgents().length,
			busyAgents: agents.filter((a) => a.state.status === "busy").length,
			taskQueueSize: this._taskQueue.length,
			averageTaskDuration,
			successRate,
		}
	}

	/**
	 * Get metrics for all agents
	 */
	getAllMetrics(): AgentMetrics[] {
		const metrics: AgentMetrics[] = []

		for (const agent of this._agents.values()) {
			metrics.push(agent.getMetrics())
		}

		return metrics
	}

	/**
	 * Shutdown all agents
	 */
	async shutdown(): Promise<void> {
		console.log("[AgentRegistry] Shutting down all agents...")

		const shutdownPromises = Array.from(this._agents.values()).map((agent) => agent.stop())
		await Promise.all(shutdownPromises)

		this._agents.clear()
		this._taskQueue = []
		this._isProcessingQueue = false

		this.emit("shutdown")
		console.log("[AgentRegistry] All agents shut down")
	}

	/**
	 * Initialize default agents
	 */
	async initializeDefaultAgents(configs: {
		planner?: PlannerConfig
		executor?: ExecutorConfig
		verifier?: VerifierConfig
	}): Promise<void> {
		console.log("[AgentRegistry] Initializing default agents...")

		try {
			// Create and register planner agent
			if (configs.planner) {
				const plannerAgent = new PlannerAgent(configs.planner)
				await this.registerAgent(plannerAgent)
			}

			// Create and register executor agent
			if (configs.executor) {
				const executorAgent = new ExecutorAgent(configs.executor)
				await this.registerAgent(executorAgent)
			}

			// Create and register verifier agent
			if (configs.verifier) {
				const verifierAgent = new VerifierAgent(configs.verifier)
				await this.registerAgent(verifierAgent)
			}

			console.log("[AgentRegistry] Default agents initialized successfully")
		} catch (error) {
			console.error("[AgentRegistry] Error initializing default agents:", error)
			throw error
		}
	}

	private async processTaskQueue(): Promise<void> {
		if (this._isProcessingQueue || this._taskQueue.length === 0) {
			return
		}

		this._isProcessingQueue = true
		console.log("[AgentRegistry] Processing task queue...")

		while (this._taskQueue.length > 0) {
			const task = this._taskQueue.shift()!

			try {
				const agent = this.getAgent(task.assignedTo)
				if (!agent) {
					console.error(`[AgentRegistry] Agent not found for task: ${task.assignedTo}`)
					continue
				}

				if (agent.state.status === "busy" || !agent.config.enabled) {
					// Re-queue the task for later
					this._taskQueue.push(task)
					await new Promise((resolve) => setTimeout(resolve, 1000)) // Wait 1 second
					continue
				}

				console.log(`[AgentRegistry] Assigning task ${task.id} to agent ${task.assignedTo}`)
				await agent.executeTask(task)
			} catch (error) {
				console.error(`[AgentRegistry] Error executing task ${task.id}:`, error)
				task.status = "failed"
				task.error = error instanceof Error ? error.message : String(error)
				task.completedAt = new Date()
				this.emit("taskFailed", task)
			}
		}

		this._isProcessingQueue = false
		console.log("[AgentRegistry] Task queue processing completed")
	}

	private handleAgentEvent(event: string, agent: IAgent): void {
		console.log(`[AgentRegistry] Agent event: ${event} from ${agent.config.id}`)
		this.emit(event, agent)

		// Collect metrics
		if (this._config.enableMetrics) {
			const metrics = agent.getMetrics()
			this._metricsHistory.push(metrics)

			// Keep only last 1000 metrics entries
			if (this._metricsHistory.length > 1000) {
				this._metricsHistory = this._metricsHistory.slice(-1000)
			}
		}
	}

	private handleTaskEvent(event: string, agent: IAgent, task: AgentTask): void {
		console.log(`[AgentRegistry] Task event: ${event} from ${agent.config.id} for task ${task.id}`)
		this.emit(event, agent, task)
	}

	private handleMessageEvent(event: string, agent: IAgent, message: AgentMessage): void {
		console.log(`[AgentRegistry] Message event: ${event} from ${agent.config.id} to ${message.to}`)
		this.emit(event, agent, message)

		// Route the message
		if (event === "message_sent" || event === "message_broadcast") {
			this.sendMessage(message).catch((error) => {
				console.error(`[AgentRegistry] Error routing message:`, error)
			})
		}
	}
}
