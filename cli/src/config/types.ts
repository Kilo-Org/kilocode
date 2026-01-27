/**
 * CLI Configuration Types
 *
 * Re-exports types from @kilocode/core-schemas for runtime validation
 * and backward compatibility with existing code.
 */

import type { ProviderConfig as CoreProviderConfig, CLIConfig as CoreCLIConfig } from "@kilocode/core-schemas"

// ProviderConfig with index signature for dynamic property access (backward compatibility)
export type ProviderConfig = CoreProviderConfig & { [key: string]: unknown }

// ============================================
// HOOKS TYPES - Claude Code compatible hooks
// ============================================

/**
 * Hook event types supported by Kilo CLI
 * Matches Claude Code hook events where applicable
 */
export type HookEvent =
	| "PreToolUse" // Runs before tool calls (can block them)
	| "PostToolUse" // Runs after tool calls complete
	| "PermissionRequest" // Runs when a permission dialog is shown (can allow or deny)
	| "Notification" // Runs when notifications are sent
	| "UserPromptSubmit" // Runs when user submits a prompt, before processing
	| "Stop" // Runs when the agent finishes responding
	| "PreCompact" // Runs before a compact/condense operation
	| "SessionStart" // Runs when a session starts or resumes
	| "SessionEnd" // Runs when a session ends

/**
 * Individual hook command definition
 * Matches Claude Code hook command structure
 */
export interface HookCommand {
	/** Type of hook - currently only "command" is supported */
	type: "command"
	/** Shell command to execute. Receives JSON input on stdin. */
	command: string
	/** Optional timeout in milliseconds (default: 30000) */
	timeout?: number
}

/**
 * Hook matcher entry - matches specific tools/patterns for an event
 * Matches Claude Code matcher structure
 */
export interface HookMatcher {
	/**
	 * Pattern to match against tool names or other event-specific identifiers
	 * - Empty string or "*" matches all
	 * - Pipe-separated values match any (e.g., "Edit|Write")
	 * - Exact string matches that specific tool/identifier
	 */
	matcher: string
	/** Array of hooks to execute when matcher matches */
	hooks: HookCommand[]
}

/**
 * Hooks configuration - maps events to matchers
 * Matches Claude Code hooks configuration structure
 */
export interface HooksConfig {
	PreToolUse?: HookMatcher[]
	PostToolUse?: HookMatcher[]
	PermissionRequest?: HookMatcher[]
	Notification?: HookMatcher[]
	UserPromptSubmit?: HookMatcher[]
	Stop?: HookMatcher[]
	PreCompact?: HookMatcher[]
	SessionStart?: HookMatcher[]
	SessionEnd?: HookMatcher[]
}

/**
 * Hook execution result from a hook command
 */
export interface HookResult {
	/** Exit code from the hook command */
	exitCode: number
	/** Stdout from the hook command */
	stdout: string
	/** Stderr from the hook command */
	stderr: string
	/** Parsed JSON decision from stdout (if valid JSON) */
	decision?: HookDecision
}

/**
 * Hook decision returned via JSON stdout
 * Matches Claude Code hook decision structure
 */
export interface HookDecision {
	/** Permission decision - "allow" or "deny" */
	permissionDecision?: "allow" | "deny"
	/** Reason for the decision (shown to user/agent) */
	permissionDecisionReason?: string
	/** Additional data to pass back */
	[key: string]: unknown
}

/**
 * Input data passed to hooks via stdin
 */
export interface HookInput {
	/** The hook event type */
	hook_event: HookEvent
	/** Tool name (for tool-related events) */
	tool_name?: string
	/** Tool input parameters (for PreToolUse) */
	tool_input?: Record<string, unknown>
	/** Tool output/result (for PostToolUse) */
	tool_output?: unknown
	/** User prompt text (for UserPromptSubmit) */
	prompt?: string
	/** Session ID */
	session_id?: string
	/** Workspace path */
	workspace?: string
	/** Additional event-specific data */
	[key: string]: unknown
}

// CLIConfig with our enhanced ProviderConfig type and hooks support
export interface CLIConfig extends Omit<CoreCLIConfig, "providers"> {
	providers: ProviderConfig[]
	/** Lifecycle hooks configuration */
	hooks?: HooksConfig
}

// Re-export all config types from core-schemas
export {
	// Provider schemas
	providerConfigSchema,
	kilocodeProviderSchema,
	anthropicProviderSchema,
	openAINativeProviderSchema,
	openAIProviderSchema,
	openAIResponsesProviderSchema,
	openRouterProviderSchema,
	ollamaProviderSchema,
	lmStudioProviderSchema,
	glamaProviderSchema,
	liteLLMProviderSchema,
	deepInfraProviderSchema,
	unboundProviderSchema,
	requestyProviderSchema,
	vercelAiGatewayProviderSchema,
	ioIntelligenceProviderSchema,
	ovhCloudProviderSchema,
	inceptionProviderSchema,
	bedrockProviderSchema,
	vertexProviderSchema,
	geminiProviderSchema,
	mistralProviderSchema,
	moonshotProviderSchema,
	minimaxProviderSchema,
	deepSeekProviderSchema,
	doubaoProviderSchema,
	qwenCodeProviderSchema,
	xaiProviderSchema,
	groqProviderSchema,
	chutesProviderSchema,
	cerebrasProviderSchema,
	sambaNovaProviderSchema,
	zaiProviderSchema,
	fireworksProviderSchema,
	featherlessProviderSchema,
	rooProviderSchema,
	claudeCodeProviderSchema,
	vsCodeLMProviderSchema,
	huggingFaceProviderSchema,
	syntheticProviderSchema,
	virtualQuotaFallbackProviderSchema,
	humanRelayProviderSchema,
	fakeAIProviderSchema,
	// Provider types (ProviderConfig and CLIConfig are defined locally with index signature)
	type KilocodeProviderConfig,
	type AnthropicProviderConfig,
	type OpenAINativeProviderConfig,
	type OpenAIProviderConfig,
	type OpenAIResponsesProviderConfig,
	type OpenRouterProviderConfig,
	type OllamaProviderConfig,
	type LMStudioProviderConfig,
	type GlamaProviderConfig,
	type LiteLLMProviderConfig,
	type DeepInfraProviderConfig,
	type UnboundProviderConfig,
	type RequestyProviderConfig,
	type VercelAiGatewayProviderConfig,
	type IOIntelligenceProviderConfig,
	type OVHCloudProviderConfig,
	type InceptionProviderConfig,
	type BedrockProviderConfig,
	type VertexProviderConfig,
	type GeminiProviderConfig,
	type MistralProviderConfig,
	type MoonshotProviderConfig,
	type MinimaxProviderConfig,
	type DeepSeekProviderConfig,
	type DoubaoProviderConfig,
	type QwenCodeProviderConfig,
	type XAIProviderConfig,
	type GroqProviderConfig,
	type ChutesProviderConfig,
	type CerebrasProviderConfig,
	type SambaNovaProviderConfig,
	type ZAIProviderConfig,
	type FireworksProviderConfig,
	type FeatherlessProviderConfig,
	type RooProviderConfig,
	type ClaudeCodeProviderConfig,
	type VSCodeLMProviderConfig,
	type HuggingFaceProviderConfig,
	type SyntheticProviderConfig,
	type VirtualQuotaFallbackProviderConfig,
	type HumanRelayProviderConfig,
	type FakeAIProviderConfig,
	// Type guard
	isProviderConfig,
	// Auto-approval schemas
	autoApprovalConfigSchema,
	autoApprovalReadSchema,
	autoApprovalWriteSchema,
	autoApprovalBrowserSchema,
	autoApprovalRetrySchema,
	autoApprovalMcpSchema,
	autoApprovalModeSchema,
	autoApprovalSubtasksSchema,
	autoApprovalExecuteSchema,
	autoApprovalQuestionSchema,
	autoApprovalTodoSchema,
	// Auto-approval types
	type AutoApprovalConfig,
	type AutoApprovalReadConfig,
	type AutoApprovalWriteConfig,
	type AutoApprovalBrowserConfig,
	type AutoApprovalRetryConfig,
	type AutoApprovalMcpConfig,
	type AutoApprovalModeConfig,
	type AutoApprovalSubtasksConfig,
	type AutoApprovalExecuteConfig,
	type AutoApprovalQuestionConfig,
	type AutoApprovalTodoConfig,
	// CLI config schema (CLIConfig type is defined locally)
	cliConfigSchema,
	isValidConfig,
	// ValidationResult is defined in validation.ts, not re-exported here to avoid conflict
	// History
	historyEntrySchema,
	historyDataSchema,
	type HistoryEntry,
	type HistoryData,
} from "@kilocode/core-schemas"
