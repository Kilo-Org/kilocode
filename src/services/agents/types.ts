// kilocode_change - new file

export interface AgentMessage {
	id: string
	from: string
	to: string
	type: "request" | "response" | "broadcast"
	content: any
	timestamp: Date
	priority: "low" | "medium" | "high" | "urgent"
}

export interface AgentCapability {
	name: string
	description: string
	inputTypes: string[]
	outputTypes: string[]
	dependencies?: string[]
}

export interface AgentConfig {
	id: string
	name: string
	type: "planner" | "executor" | "verifier" | "orchestrator"
	capabilities: AgentCapability[]
	enabled: boolean
	priority: number
	maxConcurrentTasks: number
	timeout: number
}

export interface AgentTask {
	id: string
	type: string
	assignedTo: string
	createdBy: string
	status: "pending" | "in_progress" | "completed" | "failed" | "cancelled"
	priority: "low" | "medium" | "high" | "urgent"
	input: any
	output?: any
	error?: string
	createdAt: Date
	updatedAt: Date
	startedAt?: Date
	completedAt?: Date
	dependencies?: string[]
	metadata?: Record<string, any>
}

export interface AgentState {
	id: string
	config: AgentConfig
	currentTasks: AgentTask[]
	completedTasks: AgentTask[]
	status: "idle" | "busy" | "error" | "offline"
	lastActivity: Date
	stats: {
		tasksCompleted: number
		tasksFailed: number
		averageExecutionTime: number
		successRate: number
	}
}

export interface PlanStep {
	id: string
	description: string
	type: "analysis" | "code_change" | "validation" | "test" | "documentation"
	assignedAgent: string
	dependencies: string[]
	input?: any
	output?: any
	status: "pending" | "in_progress" | "completed" | "failed" | "skipped"
	estimatedDuration?: number
	actualDuration?: number
	error?: string
	metadata?: Record<string, any>
}

export interface ExecutionPlan {
	id: string
	title: string
	description: string
	createdBy: string
	createdAt: Date
	updatedAt: Date
	status: "draft" | "active" | "completed" | "failed" | "cancelled"
	steps: PlanStep[]
	context: {
		projectType: "odoo" | "django" | "generic"
		workspaceRoot: string
		files: string[]
		request: string
		metadata?: Record<string, any>
	}
	priority: "low" | "medium" | "high" | "urgent"
	estimatedDuration?: number
	actualDuration?: number
}

export interface ValidationResult {
	isValid: boolean
	errors: string[]
	warnings: string[]
	suggestions: string[]
	metadata?: Record<string, any>
}

export interface CodeChange {
	filePath: string
	type: "create" | "update" | "delete"
	content?: string
	oldContent?: string
	edits?: Array<{
		startLine: number
		endLine: number
		newText: string
		reason: string
	}>
	metadata?: Record<string, any>
}

export interface OdooDependency {
	type: "python_model" | "xml_view" | "menu_item" | "access_right" | "data_file"
	source: string
	target: string
	dependencyType: "inherits" | "references" | "extends" | "requires"
	description: string
	confidence: number
}

export interface AgentRegistryConfig {
	maxAgents: number
	defaultTimeout: number
	taskQueueSize: number
	enablePersistence: boolean
	enableMetrics: boolean
	logLevel: "debug" | "info" | "warn" | "error"
}

export interface BlackboardEntry {
	key: string
	value: any
	agentId?: string
	timestamp: Date
	expiresAt?: Date
	accessCount: number
	lastAccessed: Date
	metadata?: Record<string, any>
}

export interface AgentMetrics {
	agentId: string
	timestamp: Date
	metrics: {
		taskCount: number
		successRate: number
		averageResponseTime: number
		memoryUsage: number
		cpuUsage: number
		errorCount: number
	}
}
