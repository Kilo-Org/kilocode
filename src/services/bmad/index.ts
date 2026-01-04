// kilocode_change - new file for BMAD-METHOD integration exports

/**
 * BMAD-METHOD Integration Service
 * Main entry point for BMAD integration with Kilo Code
 */

// Type definitions
export type * from "./types"

// Configuration
export {
	BmadConfigManager,
	getBmadConfigManager,
	disposeBmadConfigManager,
	DEFAULT_BMAD_CONFIG,
	BMAD_CONFIG_KEYS,
} from "./config"

// Integration service
export {
	BmadIntegrationService,
	getBmadIntegrationService,
	disposeBmadIntegrationService,
} from "./BmadIntegrationService"

// Mode manager
export { BmadModeManager } from "./BmadModeManager"
export type { AgentModeMapping } from "./BmadModeManager"

// Agent registry
export { BmadAgentRegistry } from "./BmadAgentRegistry"
export type { AgentMetadataExtended, AgentSearchCriteria, AgentRecommendation } from "./BmadAgentRegistry"

// Modes integrator
export { BmadModesIntegrator, getBmadModesIntegrator, disposeBmadModesIntegrator } from "./BmadModesIntegrator"

// Workflow engine
export { BmadWorkflowEngine } from "./BmadWorkflowEngine"
export type {
	WorkflowExecutionContext,
	WorkflowStepExecution,
	WorkflowEventType,
	WorkflowEventListener,
} from "./BmadWorkflowEngine"

// Workflow tools
export { BmadWorkflowTools, createBmadWorkflowTools } from "./tools"
export type { ExecuteWorkflowToolParams, ListWorkflowsResult, GetWorkflowDetailsResult } from "./tools"

// Template manager
export { BmadTemplateManager, createBmadTemplateManager } from "./BmadTemplateManager"
export type {
	TemplateInitializationOptions,
	TemplateInitializationResult,
	TemplateValidationResult,
} from "./BmadTemplateManager"

// Knowledge base
export { BmadKnowledgeBase, createBmadKnowledgeBase } from "./BmadKnowledgeBase"
export type {
	KnowledgeEntry,
	KnowledgeSearchResult,
	KnowledgeBaseStats,
	KnowledgeBaseConfig,
} from "./BmadKnowledgeBase"
