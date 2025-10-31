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
