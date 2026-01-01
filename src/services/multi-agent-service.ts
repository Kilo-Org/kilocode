// kilocode_change - new file

import { OrchestratorService, OrchestratorConfig } from "../orchestrator"
import {
	AgentRegistry,
	AgentRegistryConfig,
	PlannerAgent,
	PlannerConfig,
	ExecutorAgent,
	ExecutorConfig,
	VerifierAgent,
	VerifierConfig,
	ResearchAgent,
	ResearchAgentConfig,
} from "../agents"
import { Blackboard, BlackboardConfig } from "../orchestrator"
import { AIService } from "../ai"
import { DatabaseManager } from "../storage"
import { ParserService } from "../parser"
import { ExecutorService } from "../executor"
import { KnowledgeService, KnowledgeServiceConfig } from "../knowledge"
import * as vscode from "vscode"

export interface MultiAgentServiceConfig {
	workspaceRoot: string
	aiService: AIService
	databaseManager: DatabaseManager
	parserService: ParserService
	executorService: ExecutorService
	extensionContext: vscode.ExtensionContext
}

/**
 * Main service that integrates the multi-agent system with Kilo Code's UI modes
 */
export class MultiAgentService {
	private _orchestrator: OrchestratorService
	private _config: MultiAgentServiceConfig
	private _extensionContext: vscode.ExtensionContext

	constructor(config: MultiAgentServiceConfig) {
		this._config = config
		this._extensionContext = config.extensionContext

		// Initialize orchestrator with default agents
		const orchestratorConfig: OrchestratorConfig = {
			agentRegistry: {
				maxAgents: 10,
				defaultTimeout: 60000,
				taskQueueSize: 100,
				enablePersistence: true,
				enableMetrics: true,
				logLevel: "info",
			},
			blackboard: {
				maxEntries: 1000,
				defaultTTL: 3600000, // 1 hour
				enablePersistence: true,
				persistencePath: `${config.workspaceRoot}/.kilocode/blackboard.json`,
				cleanupInterval: 300000, // 5 minutes
			},
			workspaceRoot: config.workspaceRoot,
			enableAutoPlanning: true,
			enableAutoExecution: true,
			enableAutoVerification: true,
		}

		this._orchestrator = new OrchestratorService(orchestratorConfig)
		this.setupEventHandlers()

		console.log("[MultiAgentService] Initialized")
	}

	/**
	 * Start the multi-agent system
	 */
	async start(): Promise<void> {
		console.log("[MultiAgentService] Starting multi-agent system...")

		// Initialize default agents
		await this.initializeDefaultAgents()

		// Start orchestrator
		await this._orchestrator.start()

		console.log("[MultiAgentService] Multi-agent system started")
	}

	/**
	 * Stop the multi-agent system
	 */
	async stop(): Promise<void> {
		console.log("[MultiAgentService] Stopping multi-agent system...")

		await this._orchestrator.stop()

		console.log("[MultiAgentService] Multi-agent system stopped")
	}

	/**
	 * Process a request from a UI mode
	 */
	async processModeRequest(
		mode: "code" | "planner" | "orchestrator" | "architect",
		request: string,
		context?: any,
	): Promise<{
		success: boolean
		result?: any
		error?: string
	}> {
		console.log(`[MultiAgentService] Processing ${mode} mode request:`, request)

		try {
			switch (mode) {
				case "planner":
					return await this.handlePlannerMode(request, context)

				case "orchestrator":
					return await this.handleOrchestratorMode(request, context)

				case "architect":
					return await this.handleArchitectMode(request, context)

				case "code":
				default:
					return await this.handleCodeMode(request, context)
			}
		} catch (error) {
			console.error(`[MultiAgentService] Error processing ${mode} request:`, error)
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}

	/**
	 * Get current system status
	 */
	getSystemStatus(): {
		isRunning: boolean
		activePlans: number
		agentStats: any
		blackboardStats: any
		workspaceRoot: string
	} {
		return {
			...this._orchestrator.getStatus(),
			workspaceRoot: this._config.workspaceRoot,
		}
	}

	/**
	 * Get active execution plans
	 */
	getActivePlans(): any[] {
		return this._orchestrator.getActivePlans()
	}

	/**
	 * Get blackboard contents
	 */
	getBlackboardContents(): any[] {
		return this._orchestrator.getBlackboard().getAllEntries()
	}

	private async initializeDefaultAgents(): Promise<void> {
		console.log("[MultiAgentService] Initializing default agents...")

		const agentRegistry = this._orchestrator.getAgentRegistry()

		// Initialize planner agent
		const plannerConfig: PlannerConfig = {
			aiService: this._config.aiService,
			databaseManager: this._config.databaseManager,
			parserService: this._config.parserService,
			workspaceRoot: this._config.workspaceRoot,
		}

		// Initialize executor agent
		const executorConfig: ExecutorConfig = {
			executorService: this._config.executorService,
			workspaceRoot: this._config.workspaceRoot,
		}

		// Initialize verifier agent
		const verifierConfig: VerifierConfig = {
			workspaceRoot: this._config.workspaceRoot,
			testCommands: {
				odoo: ["python -m pytest", "python -m unittest"],
				django: ["python manage.py test"],
				generic: ["npm test", "python -m pytest"],
			},
			lintCommands: {
				python: ["flake8", "pylint"],
				javascript: ["eslint"],
				typescript: ["eslint", "tsc --noEmit"],
			},
		}

		// Initialize knowledge service for research agent
		const knowledgeService = new KnowledgeService({
			databaseManager: this._config.databaseManager,
			workspaceRoot: this._config.workspaceRoot,
		})

		// Initialize research agent
		const researchConfig: ResearchAgentConfig = {
			aiService: this._config.aiService,
			knowledgeService,
			workspaceRoot: this._config.workspaceRoot,
			id: "research-agent",
			name: "Research Agent",
			description: "Specialized agent for documentation research and knowledge retrieval",
			version: "1.0.0",
		}

		// Register the research agent
		await agentRegistry.registerAgent("research", researchConfig)

		await agentRegistry.initializeDefaultAgents({
			planner: plannerConfig,
			executor: executorConfig,
			verifier: verifierConfig,
		})

		console.log("[MultiAgentService] Default agents initialized")
	}

	private async handlePlannerMode(request: string, context?: any): Promise<any> {
		console.log("[MultiAgentService] Handling Planner mode request")

		// Create a planning request
		const plan = await this._orchestrator.processRequest(request, {
			...context,
			mode: "planner",
		})

		return {
			success: true,
			result: {
				type: "plan",
				plan,
				message: "Execution plan created successfully",
			},
		}
	}

	private async handleOrchestratorMode(request: string, context?: any): Promise<any> {
		console.log("[MultiAgentService] Handling Orchestrator mode request")

		// Process the request through the full orchestrator
		const plan = await this._orchestrator.processRequest(request, {
			...context,
			mode: "orchestrator",
		})

		return {
			success: true,
			result: {
				type: "orchestrated",
				plan,
				message: "Request processed through orchestrator",
			},
		}
	}

	private async handleArchitectMode(request: string, context?: any): Promise<any> {
		console.log("[MultiAgentService] Handling Architect mode request")

		// Architect mode focuses on high-level planning and design
		const enhancedRequest = `As an architect, analyze and design a solution for: ${request}`

		const plan = await this._orchestrator.processRequest(enhancedRequest, {
			...context,
			mode: "architect",
		})

		return {
			success: true,
			result: {
				type: "architecture",
				plan,
				message: "Architectural analysis and plan created",
			},
		}
	}

	private async handleCodeMode(request: string, context?: any): Promise<any> {
		console.log("[MultiAgentService] Handling Code mode request")

		// Code mode focuses on immediate code changes
		const blackboard = this._orchestrator.getBlackboard()

		// Store the request in blackboard for immediate access
		blackboard.write(
			`code_request:${Date.now()}`,
			{
				request,
				context,
				mode: "code",
			},
			"multi-agent-service",
		)

		// For code mode, we might want to execute more directly
		// This could integrate with the existing code execution pipeline

		return {
			success: true,
			result: {
				type: "code",
				message: "Code request queued for processing",
				requestId: `code_request_${Date.now()}`,
			},
		}
	}

	private setupEventHandlers(): void {
		// Handle orchestrator events
		this._orchestrator.on("planCreated", (plan: any) => {
			console.log("[MultiAgentService] Plan created:", plan.id)

			// Notify UI if needed
			this.notifyUI("planCreated", {
				planId: plan.id,
				title: plan.title,
				steps: plan.steps.length,
			})
		})

		this._orchestrator.on("planCompleted", (plan: any) => {
			console.log("[MultiAgentService] Plan completed:", plan.id)

			// Notify UI
			this.notifyUI("planCompleted", {
				planId: plan.id,
				status: plan.status,
			})
		})

		this._orchestrator.on("planFailed", (plan: any, error: any) => {
			console.error("[MultiAgentService] Plan failed:", plan.id, error)

			// Notify UI
			this.notifyUI("planFailed", {
				planId: plan.id,
				error: error.message || String(error),
			})
		})

		this._orchestrator.on("taskCompleted", (agent: any, task: any) => {
			console.log("[MultiAgentService] Task completed:", task.id)

			// Update blackboard with task result
			const blackboard = this._orchestrator.getBlackboard()
			blackboard.write(
				`task_result:${task.id}`,
				{
					task,
					result: task.output,
					completedAt: new Date(),
				},
				agent.config.id,
			)
		})

		this._orchestrator.on("taskFailed", (agent: any, task: any) => {
			console.error("[MultiAgentService] Task failed:", task.id)

			// Update blackboard with task failure
			const blackboard = this._orchestrator.getBlackboard()
			blackboard.write(
				`task_failure:${task.id}`,
				{
					task,
					error: task.error,
					failedAt: new Date(),
				},
				agent.config.id,
			)
		})
	}

	private notifyUI(event: string, data: any): void {
		// This could integrate with VS Code's notification system
		// or send events to the webview

		console.log(`[MultiAgentService] UI Notification: ${event}`, data)

		// Show VS Code notification for important events
		switch (event) {
			case "planCreated":
				vscode.window.showInformationMessage(`Execution plan created: ${data.title} (${data.steps} steps)`)
				break

			case "planCompleted":
				vscode.window.showInformationMessage(`Execution plan completed: ${data.planId}`)
				break

			case "planFailed":
				vscode.window.showErrorMessage(`Execution plan failed: ${data.planId} - ${data.error}`)
				break
		}
	}
}
