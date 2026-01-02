// kilocode_change - new file for BMAD-METHOD integration

/**
 * BMAD-METHOD Integration Type Definitions
 * This file contains all TypeScript interfaces and types for the BMAD integration
 */

/**
 * Represents a BMAD module (e.g., BMM, BMB, CIS, BMGD)
 */
export interface BmadModule {
	id: string
	name: string
	version: string
	description: string
	installedPath: string
	agents: BmadAgent[]
	workflows: BmadWorkflow[]
	templates: BmadTemplate[]
	config?: BmadModuleConfig
}

/**
 * Configuration specific to a BMAD module
 */
export interface BmadModuleConfig {
	outputFolder: string
	communicationLanguage: string
	userName?: string
	userSkillLevel?: "beginner" | "intermediate" | "advanced" | "expert"
	customSettings?: Record<string, any>
}

/**
 * Represents a BMAD agent (AI persona with specialized expertise)
 */
export interface BmadAgent {
	id: string
	name: string
	displayName?: string
	title?: string
	icon?: string
	role: string
	identity: string
	communicationStyle: string
	principles: string[]
	capabilities: AgentCapability[]
	triggers: AgentTrigger[]
	moduleId: string
	metadata?: AgentMetadata
}

/**
 * Metadata about an agent
 */
export interface AgentMetadata {
	id: string
	name: string
	author?: string
	version?: string
	tags?: string[]
}

/**
 * Agent capability or skill
 */
export interface AgentCapability {
	name: string
	description: string
	level?: "basic" | "intermediate" | "advanced" | "expert"
}

/**
 * Agent trigger (command or keyword that activates the agent)
 */
export interface AgentTrigger {
	trigger: string
	command?: string
	workflow?: string
	exec?: string
	description: string
}

/**
 * Represents a BMAD workflow (step-by-step process)
 */
export interface BmadWorkflow {
	id: string
	name: string
	description: string
	moduleId: string
	installedPath: string
	steps: WorkflowStep[]
	config: WorkflowConfig
	standalone?: boolean
	webBundle?: boolean
}

/**
 * Workflow configuration
 */
export interface WorkflowConfig {
	configSource?: string
	outputFolder?: string
	installedPath?: string
	instructions?: string
	template?: string
	requiredInputs?: Record<string, string>
	webBundleFiles?: string[]
	existingWorkflows?: Record<string, string>
}

/**
 * A single step in a workflow
 */
export interface WorkflowStep {
	id: string
	name: string
	description: string
	instructions?: string
	requiredTools?: string[]
	outputs?: string[]
	dependencies?: string[]
}

/**
 * Represents a BMAD template (project scaffolding)
 */
export interface BmadTemplate {
	id: string
	name: string
	description: string
	moduleId: string
	installedPath: string
	files: TemplateFile[]
	variables: TemplateVariable[]
	config?: TemplateConfig
}

/**
 * Template configuration
 */
export interface TemplateConfig {
	mainConfig?: string
	outputFolder?: string
	installedPath?: string
}

/**
 * A file in a template
 */
export interface TemplateFile {
	path: string
	content: string
	encoding?: "utf-8" | "binary"
}

/**
 * A variable in a template
 */
export interface TemplateVariable {
	name: string
	type: "string" | "number" | "boolean" | "array" | "object"
	description: string
	default?: any
	required?: boolean
	options?: any[]
}

/**
 * Active workflow session
 */
export interface WorkflowSession {
	id: string
	workflowId: string
	workflowName: string
	status: WorkflowStatus
	currentStep: string
	progress: number
	outputs: Record<string, any>
	startTime: Date
	endTime?: Date
	error?: string
	metadata?: Record<string, any>
}

/**
 * Workflow execution status
 */
export type WorkflowStatus = "running" | "paused" | "completed" | "cancelled" | "failed"

/**
 * Result of a workflow execution
 */
export interface WorkflowResult {
	success: boolean
	sessionId: string
	outputs: Record<string, any>
	error?: string
	completedSteps: string[]
	failedSteps: string[]
	duration: number
}

/**
 * Result of a single workflow step execution
 */
export interface StepResult {
	success: boolean
	stepId: string
	outputs: Record<string, any>
	error?: string
	duration: number
}

/**
 * Workflow progress information
 */
export interface WorkflowProgress {
	sessionId: string
	workflowId: string
	currentStep: string
	totalSteps: number
	completedSteps: number
	progress: number
	status: WorkflowStatus
	estimatedTimeRemaining?: number
}

/**
 * BMAD integration configuration
 */
export interface BmadConfig {
	enabled: boolean
	installationPath: string
	activeModules: string[]
	defaultWorkflow: string | null
	autoSyncModes: boolean
	syncInterval: number
	knowledgeBaseEnabled: boolean
	partyModeEnabled: boolean
	customModulesPath: string | null
	debugMode: boolean
}

/**
 * BMAD installation information
 */
export interface BmadInstallation {
	version: string
	installedAt: Date
	modules: BmadModule[]
	config: BmadConfig
	isValid: boolean
	validationErrors?: string[]
}

/**
 * Agent capabilities for mode mapping
 */
export interface AgentCapabilities {
	canWriteFiles: boolean
	canExecuteCommands: boolean
	canReadFiles: boolean
	canUseBrowser: boolean
	canUseMcp: boolean
	supportedTools: string[]
	restrictedPatterns?: string[]
}

/**
 * Workflow execution options
 */
export interface WorkflowExecutionOptions {
	sessionId?: string
	inputs?: Record<string, any>
	skipValidation?: boolean
	timeout?: number
	onProgress?: (progress: WorkflowProgress) => void
	onStepComplete?: (stepId: string, result: StepResult) => void
	onError?: (error: Error) => void
}

/**
 * Mode mapping configuration
 */
export interface ModeMappingConfig {
	includeAllAgents: boolean
	excludedAgents?: string[]
	customAgentMappings?: Record<string, Partial<ModeConfig>>
	prefix?: string
	suffix?: string
}

/**
 * Import from @roo-code/types for mode configuration
 */
import type { ModeConfig } from "@roo-code/types"

/**
 * Extended mode configuration with BMAD-specific properties
 */
export interface BmadModeConfig extends ModeConfig {
	bmadAgentId?: string
	bmadModuleId?: string
	bmadCapabilities?: AgentCapabilities
	associatedWorkflows?: string[]
}

/**
 * Knowledge base entry
 */
export interface KnowledgeEntry {
	id: string
	moduleId: string
	category: string
	title: string
	content: string
	tags: string[]
	relatedAgents?: string[]
	relatedWorkflows?: string[]
}

/**
 * Party mode configuration
 */
export interface PartyModeConfig {
	enabled: boolean
	agents: string[]
	maxDuration?: number
	allowUserInterruption: boolean
	theme?: "professional" | "creative" | "technical" | "casual"
}

/**
 * Party mode session
 */
export interface PartyModeSession {
	id: string
	agents: string[]
	status: "active" | "paused" | "ended"
	messages: PartyModeMessage[]
	startTime: Date
	endTime?: Date
}

/**
 * Message in a party mode session
 */
export interface PartyModeMessage {
	id: string
	agentId: string
	agentName: string
	content: string
	timestamp: Date
	type: "statement" | "question" | "response" | "action"
}

/**
 * Module installation result
 */
export interface ModuleInstallationResult {
	success: boolean
	moduleId: string
	version: string
	error?: string
	warnings?: string[]
}

/**
 * Module validation result
 */
export interface ModuleValidationResult {
	isValid: boolean
	moduleId: string
	errors: ValidationError[]
	warnings: ValidationWarning[]
}

/**
 * Validation error
 */
export interface ValidationError {
	path: string
	message: string
	code: string
}

/**
 * Validation warning
 */
export interface ValidationWarning {
	path: string
	message: string
	code: string
}

/**
 * Sync result for modes
 */
export interface ModeSyncResult {
	success: boolean
	addedModes: string[]
	updatedModes: string[]
	removedModes: string[]
	errors: string[]
}

/**
 * Cache entry
 */
export interface CacheEntry<T> {
	data: T
	timestamp: number
	ttl: number
}

/**
 * BMAD service events
 */
export type BmadServiceEvent =
	| { type: "initialized"; data: BmadInstallation }
	| { type: "moduleLoaded"; data: BmadModule }
	| { type: "workflowStarted"; data: WorkflowSession }
	| { type: "workflowCompleted"; data: WorkflowResult }
	| { type: "workflowFailed"; data: { sessionId: string; error: string } }
	| { type: "modeSynced"; data: ModeSyncResult }
	| { type: "error"; data: { message: string; details?: any } }

/**
 * Event listener for BMAD service events
 */
export type BmadEventListener = (event: BmadServiceEvent) => void
