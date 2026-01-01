// kilocode_change - new file

import { BaseAgent } from "./base-agent.js"
import type { AgentTask, AgentMessage, ExecutionPlan, PlanStep, OdooDependency } from "./types.js"
import type { AIService } from "../ai/ai-service.js"
import type { DatabaseManager } from "../storage/database-manager.js"
import type { ParserService } from "../parser/parser-service.js"

export interface PlannerConfig {
	aiService: AIService
	databaseManager: DatabaseManager
	parserService: ParserService
	workspaceRoot: string
}

export class PlannerAgent extends BaseAgent {
	private _aiService: AIService
	private _databaseManager: DatabaseManager
	private _parserService: ParserService
	private _workspaceRoot: string

	constructor(config: PlannerConfig) {
		super({
			id: "planner-001",
			name: "Kilo Code Planner",
			type: "planner",
			capabilities: [
				{
					name: "analyze_request",
					description: "Analyze user request and create execution plan",
					inputTypes: ["string", "object"],
					outputTypes: ["execution_plan"],
				},
				{
					name: "detect_dependencies",
					description: "Detect dependencies between files and components",
					inputTypes: ["file_list"],
					outputTypes: ["dependency_graph"],
				},
				{
					name: "create_steps",
					description: "Break down complex tasks into executable steps",
					inputTypes: ["execution_plan"],
					outputTypes: ["plan_steps"],
				},
			],
			enabled: true,
			priority: 1,
			maxConcurrentTasks: 3,
			timeout: 30000,
		})

		this._aiService = config.aiService
		this._databaseManager = config.databaseManager
		this._parserService = config.parserService
		this._workspaceRoot = config.workspaceRoot
	}

	protected async setupMessageHandlers(): Promise<void> {
		this._messageHandlers.set("request", async (message: AgentMessage) => {
			await this.handlePlanningRequest(message)
		})

		this._messageHandlers.set("plan_update", async (message: AgentMessage) => {
			await this.handlePlanUpdate(message)
		})
	}

	protected async processTask(task: AgentTask): Promise<any> {
		switch (task.type) {
			case "analyze_request":
				return await this.analyzeRequest(task.input)
			case "detect_dependencies":
				return await this.detectDependencies(task.input)
			case "create_steps":
				return await this.createExecutionSteps(task.input)
			default:
				throw new Error(`Unknown task type: ${task.type}`)
		}
	}

	private async analyzeRequest(input: { request: string; context?: any }): Promise<ExecutionPlan> {
		console.log("[Planner] Analyzing request:", input.request)

		try {
			// Get AI context for the request
			const aiResponse = await this._aiService.processQuery({
				query: `Analyze this development request and create a structured plan: ${input.request}`,
				currentFile: input.context?.currentFile,
				currentLine: input.context?.currentLine,
				sessionFiles: input.context?.sessionFiles || [],
				recentlyModified: input.context?.recentlyModified || [],
				projectType: input.context?.projectType || "generic",
			})

			// Detect project type
			const projectType = await this.detectProjectType()

			// Create execution plan
			const plan: ExecutionPlan = {
				id: `plan-${Date.now()}`,
				title: `Plan for: ${input.request.substring(0, 50)}...`,
				description: aiResponse.prompt,
				createdBy: this.config.id,
				createdAt: new Date(),
				updatedAt: new Date(),
				status: "draft",
				steps: [],
				context: {
					projectType,
					workspaceRoot: this._workspaceRoot,
					files: [],
					request: input.request,
					metadata: input.context,
				},
				priority: "medium",
			}

			// Create initial steps based on AI analysis
			plan.steps = await this.createInitialSteps(plan, aiResponse.contextResults)

			console.log(`[Planner] Created plan with ${plan.steps.length} steps`)
			return plan
		} catch (error) {
			console.error("[Planner] Error analyzing request:", error)
			throw error
		}
	}

	private async detectDependencies(input: { files: string[] }): Promise<OdooDependency[]> {
		console.log("[Planner] Detecting dependencies for files:", input.files)

		const dependencies: OdooDependency[] = []

		for (const filePath of input.files) {
			if (filePath.endsWith(".py")) {
				const pythonDeps = await this.detectPythonDependencies(filePath)
				dependencies.push(...pythonDeps)
			} else if (filePath.endsWith(".xml")) {
				const xmlDeps = await this.detectXmlDependencies(filePath)
				dependencies.push(...xmlDeps)
			}
		}

		console.log(`[Planner] Found ${dependencies.length} dependencies`)
		return dependencies
	}

	private async createExecutionSteps(input: { plan: ExecutionPlan }): Promise<PlanStep[]> {
		console.log("[Planner] Creating execution steps for plan:", input.plan.id)

		const steps: PlanStep[] = []

		// Analysis step
		steps.push({
			id: `${input.plan.id}-analysis`,
			description: "Analyze codebase and understand current state",
			type: "analysis",
			assignedAgent: "planner-001",
			dependencies: [],
			status: "pending",
			estimatedDuration: 5000,
		})

		// Code change steps
		const codeChanges = this.identifyCodeChanges(input.plan)
		for (let i = 0; i < codeChanges.length; i++) {
			const change = codeChanges[i]
			steps.push({
				id: `${input.plan.id}-code-${i}`,
				description: `Implement ${change.description}`,
				type: "code_change",
				assignedAgent: "executor-001",
				dependencies: i === 0 ? [`${input.plan.id}-analysis`] : [`${input.plan.id}-code-${i - 1}`],
				status: "pending",
				input: change,
				estimatedDuration: change.estimatedDuration,
			})
		}

		// Validation step
		steps.push({
			id: `${input.plan.id}-validation`,
			description: "Validate changes and run tests",
			type: "validation",
			assignedAgent: "verifier-001",
			dependencies: [`${input.plan.id}-code-${codeChanges.length - 1}`],
			status: "pending",
			estimatedDuration: 10000,
		})

		console.log(`[Planner] Created ${steps.length} execution steps`)
		return steps
	}

	private async detectProjectType(): Promise<"odoo" | "django" | "generic"> {
		// Check for Odoo indicators
		const manifestFiles = ["__manifest__.py", "__openerp__.py"]
		for (const manifest of manifestFiles) {
			try {
				const fs = require("fs").promises
				await fs.access(require("path").join(this._workspaceRoot, manifest))
				return "odoo"
			} catch {
				// File doesn't exist
			}
		}

		// Check for Django indicators
		const djangoFiles = ["settings.py", "manage.py"]
		for (const file of djangoFiles) {
			try {
				const fs = require("fs").promises
				await fs.access(require("path").join(this._workspaceRoot, file))
				return "django"
			} catch {
				// File doesn't exist
			}
		}

		return "generic"
	}

	private async createInitialSteps(plan: ExecutionPlan, contextResults: any[]): Promise<PlanStep[]> {
		const steps: PlanStep[] = []

		// Based on AI context results, create appropriate steps
		if (contextResults.length > 0) {
			steps.push({
				id: `${plan.id}-context-analysis`,
				description: "Analyze relevant codebase context",
				type: "analysis",
				assignedAgent: this.config.id,
				dependencies: [],
				status: "pending",
				input: { contextResults },
				estimatedDuration: 3000,
			})
		}

		return steps
	}

	private async detectPythonDependencies(filePath: string): Promise<OdooDependency[]> {
		const dependencies: OdooDependency[] = []

		try {
			// Use parser service to analyze Python file
			const parseResult = await this._parserService.parseFile(filePath)

			// Look for _inherit, _name, and other Odoo-specific patterns in the parsed symbols
			// This is a simplified implementation
			if (parseResult && parseResult.symbols) {
				for (const symbol of parseResult.symbols) {
					if (symbol.name && (symbol.name.includes("_inherit") || symbol.name.includes("_name"))) {
						// Add dependency based on symbol analysis
						dependencies.push({
							type: "python_model",
							source: filePath,
							target: "odoo.models",
							dependencyType: "inherits",
							description: `Python model inheritance detected: ${symbol.name}`,
							confidence: 0.8,
						})
					}
				}
			}
		} catch (error) {
			console.warn(`[Planner] Error parsing Python file ${filePath}:`, error)
		}

		return dependencies
	}

	private async detectXmlDependencies(filePath: string): Promise<OdooDependency[]> {
		const dependencies: OdooDependency[] = []

		try {
			// Parse XML file for Odoo-specific patterns
			const content = require("fs").promises.readFile(filePath, "utf8")
			const xmlContent = await content

			// Look for record references, view inheritance, etc.
			const recordRefs = xmlContent.match(/ref="([^"]+)"/g) || []
			for (const ref of recordRefs) {
				const refId = ref.match(/ref="([^"]+)"/)?.[1]
				if (refId) {
					dependencies.push({
						type: "xml_view",
						source: filePath,
						target: refId,
						dependencyType: "references",
						description: `XML references ${refId}`,
						confidence: 0.8,
					})
				}
			}

			// Look for view inheritance
			const inheritIds = xmlContent.match(/inherit_id="([^"]+)"/g) || []
			for (const inheritId of inheritIds) {
				const id = inheritId.match(/inherit_id="([^"]+)"/)?.[1]
				if (id) {
					dependencies.push({
						type: "xml_view",
						source: filePath,
						target: id,
						dependencyType: "extends",
						description: `XML view inherits from ${id}`,
						confidence: 0.9,
					})
				}
			}
		} catch (error) {
			console.warn(`[Planner] Error parsing XML file ${filePath}:`, error)
		}

		return dependencies
	}

	private identifyCodeChanges(plan: ExecutionPlan): Array<{ description: string; estimatedDuration: number }> {
		// This is a simplified implementation
		// In a real scenario, this would use AI to identify specific code changes needed
		const changes = []

		if (plan.context.request.toLowerCase().includes("create")) {
			changes.push({
				description: "Create new files/models",
				estimatedDuration: 8000,
			})
		}

		if (
			plan.context.request.toLowerCase().includes("update") ||
			plan.context.request.toLowerCase().includes("modify")
		) {
			changes.push({
				description: "Update existing files",
				estimatedDuration: 6000,
			})
		}

		if (plan.context.request.toLowerCase().includes("test")) {
			changes.push({
				description: "Create or update tests",
				estimatedDuration: 5000,
			})
		}

		// Default change if nothing specific identified
		if (changes.length === 0) {
			changes.push({
				description: "Implement requested changes",
				estimatedDuration: 7000,
			})
		}

		return changes
	}

	private async handlePlanningRequest(message: AgentMessage): Promise<void> {
		console.log("[Planner] Handling planning request:", message.content)

		const task: AgentTask = {
			id: `task-${Date.now()}`,
			type: "analyze_request",
			assignedTo: this.config.id,
			createdBy: message.from,
			status: "pending",
			priority: message.priority,
			input: message.content,
			createdAt: new Date(),
			updatedAt: new Date(),
		}

		try {
			const result = await this.executeTask(task)
			await this.sendMessage(message.from, "plan_created", result, message.priority)
		} catch (error) {
			await this.sendMessage(
				message.from,
				"plan_failed",
				{ error: error instanceof Error ? error.message : String(error) },
				"high",
			)
		}
	}

	private async handlePlanUpdate(message: AgentMessage): Promise<void> {
		console.log("[Planner] Handling plan update:", message.content)
		// Handle plan updates and modifications
	}
}
