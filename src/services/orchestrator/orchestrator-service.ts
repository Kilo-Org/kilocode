// kilocode_change - new file

import { EventEmitter } from "events"
import { AgentRegistry } from "../agents/agent-registry"
import { Blackboard } from "./blackboard"
import { ExecutionPlan, PlanStep, AgentTask, AgentMessage } from "../agents/types"
import { AgentRegistryConfig } from "../agents/types"
import { BlackboardConfig } from "./blackboard"

export interface OrchestratorConfig {
	agentRegistry: AgentRegistryConfig
	blackboard: BlackboardConfig
	workspaceRoot: string
	enableAutoPlanning: boolean
	enableAutoExecution: boolean
	enableAutoVerification: boolean
}

export class OrchestratorService extends EventEmitter {
	private _agentRegistry: AgentRegistry
	private _blackboard: Blackboard
	private _config: OrchestratorConfig
	private _activePlans: Map<string, ExecutionPlan> = new Map()
	private _isRunning: boolean = false

	constructor(config: OrchestratorConfig) {
		super()
		this._config = config
		this._agentRegistry = new AgentRegistry(config.agentRegistry)
		this._blackboard = new Blackboard(config.blackboard)

		this.setupEventHandlers()
		console.log("[Orchestrator] Initialized with config:", config)
	}

	/**
	 * Start the orchestrator
	 */
	async start(): Promise<void> {
		if (this._isRunning) {
			console.warn("[Orchestrator] Already running")
			return
		}

		console.log("[Orchestrator] Starting...")
		this._isRunning = true

		// Load blackboard data if persistence is enabled
		if (this._config.blackboard.enablePersistence) {
			await this._blackboard.load()
		}

		this.emit("started")
		console.log("[Orchestrator] Started successfully")
	}

	/**
	 * Stop the orchestrator
	 */
	async stop(): Promise<void> {
		if (!this._isRunning) {
			console.warn("[Orchestrator] Not running")
			return
		}

		console.log("[Orchestrator] Stopping...")
		this._isRunning = false

		// Shutdown all agents
		await this._agentRegistry.shutdown()

		// Destroy blackboard
		this._blackboard.destroy()

		this.emit("stopped")
		console.log("[Orchestrator] Stopped successfully")
	}

	/**
	 * Process a user request and create execution plan
	 */
	async processRequest(request: string, context?: any): Promise<ExecutionPlan> {
		console.log("[Orchestrator] Processing request:", request)

		// Store request in blackboard
		this._blackboard.write(
			`request:${Date.now()}`,
			{
				request,
				context,
				status: "processing",
			},
			"orchestrator",
		)

		try {
			// Get planner agent
			const plannerAgents = this._agentRegistry.getAgentsByType("planner")
			if (plannerAgents.length === 0) {
				throw new Error("No planner agent available")
			}

			const plannerAgent = plannerAgents[0]

			// Create planning task
			const task: AgentTask = {
				id: `plan-${Date.now()}`,
				type: "analyze_request",
				assignedTo: plannerAgent.config.id,
				createdBy: "orchestrator",
				status: "pending",
				priority: "medium",
				input: { request, context },
				createdAt: new Date(),
				updatedAt: new Date(),
			}

			// Submit task to planner
			await this._agentRegistry.submitTask(task)

			// Wait for plan creation (simplified - in real scenario would use events/promises)
			await new Promise((resolve) => setTimeout(resolve, 2000))

			// Get the created plan from blackboard or agent state
			const plan = await this.extractPlanFromAgent(plannerAgent.config.id)

			if (plan) {
				this._activePlans.set(plan.id, plan)

				// Store plan in blackboard
				this._blackboard.write(`plan:${plan.id}`, plan, "orchestrator")

				this.emit("planCreated", plan)

				// Auto-execute if enabled
				if (this._config.enableAutoExecution) {
					await this.executePlan(plan.id)
				}

				return plan
			} else {
				throw new Error("Failed to create execution plan")
			}
		} catch (error) {
			console.error("[Orchestrator] Error processing request:", error)
			throw error
		}
	}

	/**
	 * Execute an existing plan
	 */
	async executePlan(planId: string): Promise<void> {
		const plan = this._activePlans.get(planId)
		if (!plan) {
			throw new Error(`Plan ${planId} not found`)
		}

		console.log("[Orchestrator] Executing plan:", planId)
		plan.status = "active"
		plan.updatedAt = new Date()

		// Update plan in blackboard
		this._blackboard.write(`plan:${planId}`, plan, "orchestrator")

		try {
			// Execute steps in dependency order
			const executedSteps = new Set<string>()
			let stepCount = 0

			while (executedSteps.size < plan.steps.length && stepCount < 100) {
				// Safety limit
				stepCount++

				for (const step of plan.steps) {
					if (executedSteps.has(step.id)) {
						continue
					}

					// Check if dependencies are satisfied
					const dependenciesSatisfied = step.dependencies.every((dep) => executedSteps.has(dep))

					if (!dependenciesSatisfied) {
						continue
					}

					// Execute step
					await this.executeStep(step)
					executedSteps.add(step.id)
				}

				// Wait a bit between iterations
				await new Promise((resolve) => setTimeout(resolve, 500))
			}

			// Check if all steps completed
			const allCompleted = plan.steps.every((step) => step.status === "completed" || step.status === "skipped")

			plan.status = allCompleted ? "completed" : "failed"
			plan.updatedAt = new Date()

			// Update plan in blackboard
			this._blackboard.write(`plan:${planId}`, plan, "orchestrator")

			this.emit("planCompleted", plan)
			console.log(`[Orchestrator] Plan ${planId} ${plan.status}`)
		} catch (error) {
			plan.status = "failed"
			plan.updatedAt = new Date()

			this._blackboard.write(`plan:${planId}`, plan, "orchestrator")
			this.emit("planFailed", plan, error)

			console.error(`[Orchestrator] Plan ${planId} failed:`, error)
		}
	}

	/**
	 * Get active plans
	 */
	getActivePlans(): ExecutionPlan[] {
		return Array.from(this._activePlans.values())
	}

	/**
	 * Get plan by ID
	 */
	getPlan(planId: string): ExecutionPlan | undefined {
		return this._activePlans.get(planId)
	}

	/**
	 * Get orchestrator status
	 */
	getStatus(): {
		isRunning: boolean
		activePlans: number
		agentStats: any
		blackboardStats: any
	} {
		return {
			isRunning: this._isRunning,
			activePlans: this._activePlans.size,
			agentStats: this._agentRegistry.getStats(),
			blackboardStats: this._blackboard.getStats(),
		}
	}

	/**
	 * Get agent registry
	 */
	getAgentRegistry(): AgentRegistry {
		return this._agentRegistry
	}

	/**
	 * Get blackboard
	 */
	getBlackboard(): Blackboard {
		return this._blackboard
	}

	private setupEventHandlers(): void {
		// Handle agent events
		this._agentRegistry.on("taskCompleted", (agent: any, task: AgentTask) => {
			console.log(`[Orchestrator] Task completed: ${task.id} by ${agent.config.id}`)
			this.emit("taskCompleted", agent, task)
		})

		this._agentRegistry.on("taskFailed", (agent: any, task: AgentTask) => {
			console.error(`[Orchestrator] Task failed: ${task.id} by ${agent.config.id}`)
			this.emit("taskFailed", agent, task)
		})

		this._agentRegistry.on("messageRouted", (message: AgentMessage) => {
			console.log(`[Orchestrator] Message routed: ${message.from} -> ${message.to}`)
			this.emit("messageRouted", message)
		})

		// Handle blackboard events
		this._blackboard.on("entryWritten", (entry) => {
			this.emit("blackboardUpdate", "write", entry)
		})

		this._blackboard.on("entryRead", (entry) => {
			this.emit("blackboardUpdate", "read", entry)
		})
	}

	private async executeStep(step: PlanStep): Promise<void> {
		console.log(`[Orchestrator] Executing step: ${step.id}`)

		step.status = "in_progress"
		step.actualDuration = 0
		const startTime = Date.now()

		try {
			// Get the assigned agent
			const agent = this._agentRegistry.getAgent(step.assignedAgent)
			if (!agent) {
				throw new Error(`Agent ${step.assignedAgent} not found`)
			}

			// Create task for the step
			const task: AgentTask = {
				id: `step-${step.id}-${Date.now()}`,
				type: step.type,
				assignedTo: step.assignedAgent,
				createdBy: "orchestrator",
				status: "pending",
				priority: "medium",
				input: step.input,
				createdAt: new Date(),
				updatedAt: new Date(),
			}

			// Submit task
			await this._agentRegistry.submitTask(task)

			// Wait for completion (simplified)
			await new Promise((resolve) => setTimeout(resolve, 3000))

			step.status = "completed"
			step.actualDuration = Date.now() - startTime

			console.log(`[Orchestrator] Step completed: ${step.id} in ${step.actualDuration}ms`)
		} catch (error) {
			step.status = "failed"
			step.error = error instanceof Error ? error.message : String(error)
			step.actualDuration = Date.now() - startTime

			console.error(`[Orchestrator] Step failed: ${step.id}`, error)
		}
	}

	private async extractPlanFromAgent(agentId: string): Promise<ExecutionPlan | undefined> {
		// This is a simplified implementation
		// In a real scenario, you'd get the plan from the agent's completed tasks or events

		const agent = this._agentRegistry.getAgent(agentId)
		if (!agent) {
			return undefined
		}

		// Look for recently completed planning tasks
		const completedTasks = agent.state.completedTasks
			.filter((task) => task.type === "analyze_request" && task.status === "completed")
			.sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime())

		if (completedTasks.length > 0) {
			return completedTasks[0].output as ExecutionPlan
		}

		return undefined
	}
}
