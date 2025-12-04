/**
 * Telemetry Event Types
 * All events are prefixed with 'cli_' to distinguish from extension telemetry
 */

/**
 * Telemetry event names
 */
export enum TelemetryEvent {
	// Session Events
	SESSION_STARTED = "cli_session_started",
	SESSION_ENDED = "cli_session_ended",

	// Command Events
	COMMAND_EXECUTED = "cli_command_executed",
	COMMAND_FAILED = "cli_command_failed",

	// Message Events
	USER_MESSAGE_SENT = "cli_user_message_sent",
	ASSISTANT_MESSAGE_RECEIVED = "cli_assistant_message_received",

	// Task Events
	TASK_CREATED = "cli_task_created",
	TASK_COMPLETED = "cli_task_completed",
	TASK_FAILED = "cli_task_failed",
	TASK_CANCELLED = "cli_task_cancelled",

	// Configuration Events
	CONFIG_LOADED = "cli_config_loaded",
	CONFIG_SAVED = "cli_config_saved",
	PROVIDER_CHANGED = "cli_provider_changed",
	MODEL_CHANGED = "cli_model_changed",
	MODE_CHANGED = "cli_mode_changed",
	THEME_CHANGED = "cli_theme_changed",

	// Tool Usage Events
	TOOL_EXECUTED = "cli_tool_executed",
	TOOL_APPROVED = "cli_tool_approved",
	TOOL_REJECTED = "cli_tool_rejected",

	// MCP Events
	MCP_TOOL_USED = "cli_mcp_tool_used",
	MCP_RESOURCE_ACCESSED = "cli_mcp_resource_accessed",

	// Approval Events
	APPROVAL_REQUESTED = "cli_approval_requested",
	APPROVAL_AUTO_APPROVED = "cli_approval_auto_approved",
	APPROVAL_AUTO_REJECTED = "cli_approval_auto_rejected",
	APPROVAL_MANUAL_APPROVED = "cli_approval_manual_approved",
	APPROVAL_MANUAL_REJECTED = "cli_approval_manual_rejected",

	// CI Mode Events
	CI_MODE_STARTED = "cli_ci_mode_started",
	CI_MODE_COMPLETED = "cli_ci_mode_completed",
	CI_MODE_TIMEOUT = "cli_ci_mode_timeout",

	// Parallel Mode Events
	PARALLEL_MODE_STARTED = "cli_parallel_mode_started",
	PARALLEL_MODE_COMPLETED = "cli_parallel_mode_completed",
	PARALLEL_MODE_ERRORED = "cli_parallel_mode_errored",

	// Error Events
	ERROR_OCCURRED = "cli_error_occurred",
	EXCEPTION_CAUGHT = "cli_exception_caught",

	// Performance Events
	PERFORMANCE_METRICS = "cli_performance_metrics",
	API_REQUEST_COMPLETED = "cli_api_request_completed",

	// Extension Communication Events
	EXTENSION_INITIALIZED = "cli_extension_initialized",
	EXTENSION_MESSAGE_SENT = "cli_extension_message_sent",
	EXTENSION_MESSAGE_RECEIVED = "cli_extension_message_received",

	// Authentication Events
	AUTH_TOKEN_UPDATED = "cli_auth_token_updated",
	AUTH_FAILED = "cli_auth_failed",

	// Workflow Events
	WORKFLOW_PATTERN_DETECTED = "cli_workflow_pattern_detected",
	FEATURE_USED = "cli_feature_used",
}

/**
 * Base properties included in all telemetry events
 */
export interface BaseProperties {
	// CLI Information
	cliVersion: string
	nodeVersion: string
	platform: string
	architecture: string

	// Session Information
	sessionId: string
	sessionDuration?: number

	// Workspace Information
	workspaceHash?: string // Anonymized workspace identifier

	// Mode Information
	mode: string
	ciMode: boolean

	// User Information (anonymized)
	cliUserId: string
	kilocodeUserId?: string
}

/**
 * Session event properties
 */
export interface SessionEventProperties extends BaseProperties {
	// Initialization arguments
	initialMode?: string
	initialWorkspace?: string
	hasPrompt: boolean
	hasTimeout: boolean
	timeoutSeconds?: number
}

/**
 * Command execution event properties
 */
export interface CommandEventProperties extends BaseProperties {
	commandType: string
	commandArgs?: string[]
	executionTime: number
	success: boolean
	errorMessage?: string
}

/**
 * Message event properties
 */
export interface MessageEventProperties extends BaseProperties {
	messageLength: number
	hasImages: boolean
	imageCount?: number
	isFollowup: boolean
	taskId?: string
}

/**
 * Task event properties
 */
export interface TaskEventProperties extends BaseProperties {
	taskId: string
	taskDuration?: number
	messageCount?: number
	toolUsageCount?: number
	approvalCount?: number
	errorCount?: number
	completionReason?: string
}

/**
 * Configuration event properties
 */
export interface ConfigEventProperties extends BaseProperties {
	configVersion: string
	providerCount: number
	selectedProvider: string
	selectedModel?: string
	telemetryEnabled: boolean
	autoApprovalEnabled: boolean
}

/**
 * Provider change event properties
 */
export interface ProviderChangeEventProperties extends BaseProperties {
	previousProvider?: string
	newProvider: string
	previousModel?: string
	newModel?: string
}

/**
 * Theme change event properties
 */
export interface ThemeChangeEventProperties extends BaseProperties {
	previousTheme: string
	newTheme: string
}

/**
 * Tool usage event properties
 */
export interface ToolEventProperties extends BaseProperties {
	toolName: string
	toolCategory: string
	executionTime: number
	success: boolean
	isOutsideWorkspace?: boolean
	isProtected?: boolean
	errorMessage?: string
}

/**
 * MCP event properties
 */
export interface MCPEventProperties extends BaseProperties {
	serverName: string
	toolName?: string
	resourceUri?: string
	executionTime: number
	success: boolean
	errorMessage?: string
}

/**
 * Approval event properties
 */
export interface ApprovalEventProperties extends BaseProperties {
	approvalType: string // tool, command, followup, retry
	toolName?: string
	commandName?: string
	autoApproved: boolean
	autoRejected: boolean
	responseTime?: number
	isOutsideWorkspace?: boolean
	isProtected?: boolean
}

/**
 * CI mode event properties
 */
export interface CIModeEventProperties extends BaseProperties {
	promptLength: number
	timeoutSeconds?: number
	exitReason: string
	totalDuration: number
	taskCompleted: boolean
	approvalCount: number
	autoApprovalCount: number
	autoRejectionCount: number
}

/**
 * Error event properties
 */
export interface ErrorEventProperties extends BaseProperties {
	errorType: string
	errorMessage: string
	errorStack?: string
	errorContext?: string
	isFatal: boolean
}

/**
 * Performance metrics properties
 */
export interface PerformanceMetricsProperties extends BaseProperties {
	// Memory metrics (in bytes)
	memoryHeapUsed: number
	memoryHeapTotal: number
	memoryRSS: number
	memoryExternal: number

	// CPU metrics
	cpuUsagePercent?: number

	// Timing metrics (in milliseconds)
	averageCommandTime?: number
	averageApiResponseTime?: number
	averageToolExecutionTime?: number

	// Operation counts
	totalCommands: number
	totalMessages: number
	totalToolExecutions: number
	totalApiRequests: number
	totalFileOperations: number
}

/**
 * API request event properties
 */
export interface APIRequestProperties extends BaseProperties {
	provider: string
	model: string
	requestType: string
	responseTime: number
	inputTokens?: number
	outputTokens?: number
	cacheReadTokens?: number
	cacheWriteTokens?: number
	cost?: number
	success: boolean
	errorMessage?: string
}

/**
 * Extension communication event properties
 */
export interface ExtensionEventProperties extends BaseProperties {
	messageType: string
	direction: "sent" | "received"
	processingTime?: number
	success: boolean
	errorMessage?: string
}

/**
 * Authentication event properties
 */
export interface AuthEventProperties extends BaseProperties {
	authMethod: string
	success: boolean
	errorMessage?: string
}

/**
 * Workflow pattern event properties
 */
export interface WorkflowPatternProperties extends BaseProperties {
	patternType: string
	commandSequence?: string[]
	frequency: number
	duration: number
}

/**
 * Feature usage event properties
 */
export interface FeatureUsageProperties extends BaseProperties {
	featureName: string
	usageCount: number
	firstUsed: boolean
}

/**
 * Type guard to check if properties are valid
 */
export function isValidEventProperties(properties: unknown): properties is BaseProperties {
	return (
		typeof properties === "object" &&
		properties !== null &&
		typeof (properties as Record<string, unknown>).cliVersion === "string" &&
		typeof (properties as Record<string, unknown>).sessionId === "string" &&
		typeof (properties as Record<string, unknown>).mode === "string" &&
		typeof (properties as Record<string, unknown>).ciMode === "boolean"
	)
}
