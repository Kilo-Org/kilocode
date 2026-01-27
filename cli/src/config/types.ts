/**
 * CLI Configuration Types
 *
 * Re-exports types from @kilocode/core-schemas for runtime validation
 * and backward compatibility with existing code.
 */

import type { ProviderConfig as CoreProviderConfig, CLIConfig as CoreCLIConfig } from "@kilocode/core-schemas"

// ProviderConfig with index signature for dynamic property access (backward compatibility)
export type ProviderConfig = CoreProviderConfig & { [key: string]: unknown }

// CLIConfig with our enhanced ProviderConfig type
export interface CLIConfig extends Omit<CoreCLIConfig, "providers"> {
	providers: ProviderConfig[]
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
