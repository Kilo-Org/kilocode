import { z } from "zod"

import { type Keys } from "./type-fu.js"
import {
	type ProviderSettings,
	PROVIDER_SETTINGS_KEYS,
	providerSettingsEntrySchema,
	providerSettingsSchema,
} from "./provider-settings.js"
import { historyItemSchema } from "./history.js"
import { codebaseIndexModelsSchema, codebaseIndexConfigSchema } from "./codebase-index.js"
import { experimentsSchema } from "./experiment.js"
import { telemetrySettingsSchema } from "./telemetry.js"
import { modeConfigSchema } from "./mode.js"
import { customModePromptsSchema, customSupportPromptsSchema } from "./mode.js"
import { languagesSchema } from "./vscode.js"
import {
	fastApplyModelSchema,
	autocompleteServiceSettingsSchema,
	fastApplyApiProviderSchema,
} from "./kilocode/kilocode.js"

/**
 * Default delay in milliseconds after writes to allow diagnostics to detect potential problems.
 * This delay is particularly important for Go and other languages where tools like goimports
 * need time to automatically clean up unused imports.
 */
export const DEFAULT_WRITE_DELAY_MS = 1000

/**
 * Default terminal output character limit constant.
 * This provides a reasonable default that aligns with typical terminal usage
 * while preventing context window explosions from extremely long lines.
 */
export const DEFAULT_TERMINAL_OUTPUT_CHARACTER_LIMIT = 50_000

/**
 * Minimum checkpoint timeout in seconds.
 */
export const MIN_CHECKPOINT_TIMEOUT_SECONDS = 10

/**
 * Maximum checkpoint timeout in seconds.
 */
export const MAX_CHECKPOINT_TIMEOUT_SECONDS = 60

/**
 * Default checkpoint timeout in seconds.
 */
export const DEFAULT_CHECKPOINT_TIMEOUT_SECONDS = 15

/**
 * GlobalSettings
 */

export const globalSettingsSchema = z.object({
	currentApiConfigName: z.string().optional(),
	listApiConfigMeta: z.array(providerSettingsEntrySchema).optional(),
	pinnedApiConfigs: z.record(z.string(), z.boolean()).optional(),

	lastShownAnnouncementId: z.string().optional(),
	customInstructions: z.string().optional(),
	taskHistory: z.array(historyItemSchema).optional(),
	dismissedUpsells: z.array(z.string()).optional(),

	// Image generation settings (experimental) - flattened for simplicity
	imageGenerationProvider: z.enum(["openrouter", "kilocode"]).optional(), // kilocode_change: Updated from "roo" to "kilocode"
	openRouterImageApiKey: z.string().optional(),
	openRouterImageGenerationSelectedModel: z.string().optional(),
	kiloCodeImageApiKey: z.string().optional(),

	condensingApiConfigId: z.string().optional(),
	customCondensingPrompt: z.string().optional(),

	autoApprovalEnabled: z.boolean().optional(),
	yoloMode: z.boolean().optional(), // kilocode_change
	yoloGatekeeperApiConfigId: z.string().optional(), // kilocode_change: AI gatekeeper for YOLO mode
	alwaysAllowReadOnly: z.boolean().optional(),
	alwaysAllowReadOnlyOutsideWorkspace: z.boolean().optional(),
	alwaysAllowWrite: z.boolean().optional(),
	alwaysAllowWriteOutsideWorkspace: z.boolean().optional(),
	alwaysAllowWriteProtected: z.boolean().optional(),
	alwaysAllowDelete: z.boolean().optional(), // kilocode_change
	writeDelayMs: z.number().min(0).optional(),
	alwaysAllowBrowser: z.boolean().optional(),
	requestDelaySeconds: z.number().optional(),
	alwaysAllowMcp: z.boolean().optional(),
	alwaysAllowModeSwitch: z.boolean().optional(),
	alwaysAllowSubtasks: z.boolean().optional(),
	alwaysAllowExecute: z.boolean().optional(),
	alwaysAllowFollowupQuestions: z.boolean().optional(),
	followupAutoApproveTimeoutMs: z.number().optional(),
	allowedCommands: z.array(z.string()).optional(),
	deniedCommands: z.array(z.string()).optional(),
	commandExecutionTimeout: z.number().optional(),
	commandTimeoutAllowlist: z.array(z.string()).optional(),
	preventCompletionWithOpenTodos: z.boolean().optional(),
	allowedMaxRequests: z.number().nullish(),
	allowedMaxCost: z.number().nullish(),
	autoCondenseContext: z.boolean().optional(),
	autoCondenseContextPercent: z.number().optional(),
	maxConcurrentFileReads: z.number().optional(),
	allowVeryLargeReads: z.boolean().optional(), // kilocode_change

	/**
	 * Whether to include current time in the environment details
	 * @default true
	 */
	includeCurrentTime: z.boolean().optional(),
	/**
	 * Whether to include current cost in the environment details
	 * @default true
	 */
	includeCurrentCost: z.boolean().optional(),
	/**
	 * Maximum number of git status file entries to include in the environment details.
	 * Set to 0 to disable git status. The header (branch, commits) is always included when > 0.
	 * @default 0
	 */
	maxGitStatusFiles: z.number().optional(),

	/**
	 * Whether to include diagnostic messages (errors, warnings) in tool outputs
	 * @default true
	 */
	includeDiagnosticMessages: z.boolean().optional(),
	/**
	 * Maximum number of diagnostic messages to include in tool outputs
	 * @default 50
	 */
	maxDiagnosticMessages: z.number().optional(),

	browserToolEnabled: z.boolean().optional(),
	browserViewportSize: z.string().optional(),
	showAutoApproveMenu: z.boolean().optional(), // kilocode_change
	showTaskTimeline: z.boolean().optional(), // kilocode_change
	sendMessageOnEnter: z.boolean().optional(), // kilocode_change: Enter key behavior
	showTimestamps: z.boolean().optional(), // kilocode_change
	showDiffStats: z.boolean().optional(), // kilocode_change
	hideCostBelowThreshold: z.number().min(0).optional(), // kilocode_change
	localWorkflowToggles: z.record(z.string(), z.boolean()).optional(), // kilocode_change
	globalWorkflowToggles: z.record(z.string(), z.boolean()).optional(), // kilocode_change
	localRulesToggles: z.record(z.string(), z.boolean()).optional(), // kilocode_change
	globalRulesToggles: z.record(z.string(), z.boolean()).optional(), // kilocode_change
	screenshotQuality: z.number().optional(),
	remoteBrowserEnabled: z.boolean().optional(),
	remoteBrowserHost: z.string().optional(),
	cachedChromeHostUrl: z.string().optional(),

	enableCheckpoints: z.boolean().optional(),
	checkpointTimeout: z
		.number()
		.int()
		.min(MIN_CHECKPOINT_TIMEOUT_SECONDS)
		.max(MAX_CHECKPOINT_TIMEOUT_SECONDS)
		.optional(),

	// kilocode_change start - Auto-purge settings
	autoPurgeEnabled: z.boolean().optional(),
	autoPurgeDefaultRetentionDays: z.number().min(1).optional(),
	autoPurgeFavoritedTaskRetentionDays: z.number().min(1).nullable().optional(),
	autoPurgeCompletedTaskRetentionDays: z.number().min(1).optional(),
	autoPurgeIncompleteTaskRetentionDays: z.number().min(1).optional(),
	autoPurgeLastRunTimestamp: z.number().optional(),
	// kilocode_change end

	ttsEnabled: z.boolean().optional(),
	ttsSpeed: z.number().optional(),
	soundEnabled: z.boolean().optional(),
	soundVolume: z.number().optional(),
	systemNotificationsEnabled: z.boolean().optional(), // kilocode_change
	selectedMicrophoneDevice: z
		.object({
			id: z.string(),
			name: z.string(),
			platform: z.string(),
		})
		.nullable()
		.optional(), // kilocode_change: Selected microphone device for STT (matches MicrophoneDevice from sttContract.ts)

	maxOpenTabsContext: z.number().optional(),
	maxWorkspaceFiles: z.number().optional(),
	showRooIgnoredFiles: z.boolean().optional(),
	enableSubfolderRules: z.boolean().optional(),
	maxReadFileLine: z.number().optional(),
	maxImageFileSize: z.number().optional(),
	maxTotalImageSize: z.number().optional(),

	terminalOutputLineLimit: z.number().optional(),
	terminalOutputCharacterLimit: z.number().optional(),
	terminalShellIntegrationTimeout: z.number().optional(),
	terminalShellIntegrationDisabled: z.boolean().optional(),
	terminalCommandDelay: z.number().optional(),
	terminalPowershellCounter: z.boolean().optional(),
	terminalZshClearEolMark: z.boolean().optional(),
	terminalZshOhMy: z.boolean().optional(),
	terminalZshP10k: z.boolean().optional(),
	terminalZdotdir: z.boolean().optional(),
	terminalCompressProgressBar: z.boolean().optional(),

	diagnosticsEnabled: z.boolean().optional(),

	rateLimitSeconds: z.number().optional(),
	diffEnabled: z.boolean().optional(),
	fuzzyMatchThreshold: z.number().optional(),
	experiments: experimentsSchema.optional(),

	// kilocode_change start: Morph fast apply
	morphApiKey: z.string().optional(),
	fastApplyModel: fastApplyModelSchema.optional(),
	fastApplyApiProvider: fastApplyApiProviderSchema.optional(),
	// kilocode_change end

	codebaseIndexModels: codebaseIndexModelsSchema.optional(),
	codebaseIndexConfig: codebaseIndexConfigSchema.optional(),

	language: languagesSchema.optional(),

	telemetrySetting: telemetrySettingsSchema.optional(),

	mcpEnabled: z.boolean().optional(),
	enableMcpServerCreation: z.boolean().optional(),
	mcpMarketplaceCatalog: z.any().optional(), // kilocode_change: MCP marketplace catalog

	mode: z.string().optional(),
	modeApiConfigs: z.record(z.string(), z.string()).optional(),
	customModes: z.array(modeConfigSchema).optional(),
	customModePrompts: customModePromptsSchema.optional(),
	customSupportPrompts: customSupportPromptsSchema.optional(),
	enhancementApiConfigId: z.string().optional(),
	dismissedNotificationIds: z.string().array().optional(), // kilocode_change
	commitMessageApiConfigId: z.string().optional(), // kilocode_change
	terminalCommandApiConfigId: z.string().optional(), // kilocode_change
	ghostServiceSettings: autocompleteServiceSettingsSchema, // kilocode_change
	hasPerformedOrganizationAutoSwitch: z.boolean().optional(), // kilocode_change
	includeTaskHistoryInEnhance: z.boolean().optional(),
	historyPreviewCollapsed: z.boolean().optional(),
	reasoningBlockCollapsed: z.boolean().optional(),
	/**
	 * Controls the keyboard behavior for sending messages in the chat input.
	 * - "send": Enter sends message, Shift+Enter creates newline (default)
	 * - "newline": Enter creates newline, Shift+Enter/Ctrl+Enter sends message
	 * @default "send"
	 */
	enterBehavior: z.enum(["send", "newline"]).optional(),
	profileThresholds: z.record(z.string(), z.number()).optional(),
	hasOpenedModeSelector: z.boolean().optional(),
	hasCompletedOnboarding: z.boolean().optional(), // kilocode_change: Track if user has completed onboarding flow
	lastModeExportPath: z.string().optional(),
	lastModeImportPath: z.string().optional(),
	appendSystemPrompt: z.string().optional(), // kilocode_change: Custom text to append to system prompt (CLI only)
})

export type GlobalSettings = z.infer<typeof globalSettingsSchema>

export const GLOBAL_SETTINGS_KEYS = globalSettingsSchema.keyof().options

/**
 * RooCodeSettings
 */

export const rooCodeSettingsSchema = providerSettingsSchema.merge(globalSettingsSchema)

export type RooCodeSettings = GlobalSettings & ProviderSettings

/**
 * SecretState
 */
export const SECRET_STATE_KEYS = [
	"apiKey",
	"glamaApiKey", // kilocode_change
	"openRouterApiKey",
	"awsAccessKey",
	"awsApiKey",
	"awsSecretKey",
	"awsSessionToken",
	"openAiApiKey",
	"ollamaApiKey",
	"geminiApiKey",
	"openAiNativeApiKey",
	"cerebrasApiKey",
	"deepSeekApiKey",
	"doubaoApiKey",
	"moonshotApiKey",
	"mistralApiKey",
	"minimaxApiKey",
	"unboundApiKey",
	"requestyApiKey",
	"xaiApiKey",
	"groqApiKey",
	"chutesApiKey",
	"litellmApiKey",
	"deepInfraApiKey",
	"codeIndexOpenAiKey",
	"codeIndexQdrantApiKey",
	// kilocode_change start
	"minimaxApiKey",
	"kilocodeToken",
	"syntheticApiKey",
	"ovhCloudAiEndpointsApiKey",
	"inceptionLabsApiKey",
	// kilocode_change end
	"codebaseIndexOpenAiCompatibleApiKey",
	"codebaseIndexGeminiApiKey",
	"codebaseIndexMistralApiKey",
	"codebaseIndexVercelAiGatewayApiKey",
	"codebaseIndexOpenRouterApiKey",
	"huggingFaceApiKey",
	"sambaNovaApiKey",
	"zaiApiKey",
	"fireworksApiKey",
	"featherlessApiKey",
	"ioIntelligenceApiKey",
	"vercelAiGatewayApiKey",
	"sapAiCoreServiceKey", // kilocode_change
	"basetenApiKey",
	"codebaseIndexVoyageApiKey", // kilocode_change
	"corethinkApiKey",
] as const

// Global secrets that are part of GlobalSettings (not ProviderSettings)
export const GLOBAL_SECRET_KEYS = [
	"openRouterImageApiKey", // For image generation
	"kiloCodeImageApiKey",
] as const

// Type for the actual secret storage keys
type ProviderSecretKey = (typeof SECRET_STATE_KEYS)[number]
type GlobalSecretKey = (typeof GLOBAL_SECRET_KEYS)[number]

// Type representing all secrets that can be stored
export type SecretState = Pick<ProviderSettings, Extract<ProviderSecretKey, keyof ProviderSettings>> & {
	[K in GlobalSecretKey]?: string
}

export const isSecretStateKey = (key: string): key is Keys<SecretState> =>
	SECRET_STATE_KEYS.includes(key as ProviderSecretKey) || GLOBAL_SECRET_KEYS.includes(key as GlobalSecretKey)

/**
 * GlobalState
 */

export type GlobalState = Omit<RooCodeSettings, Keys<SecretState>>

export const GLOBAL_STATE_KEYS = [...GLOBAL_SETTINGS_KEYS, ...PROVIDER_SETTINGS_KEYS].filter(
	(key: Keys<RooCodeSettings>) => !isSecretStateKey(key),
) as Keys<GlobalState>[]

export const isGlobalStateKey = (key: string): key is Keys<GlobalState> =>
	GLOBAL_STATE_KEYS.includes(key as Keys<GlobalState>)

/**
 * Evals
 */

// Default settings when running evals (unless overridden).
export const EVALS_SETTINGS: RooCodeSettings = {
	apiProvider: "openrouter",

	lastShownAnnouncementId: "jul-09-2025-3-23-0",

	pinnedApiConfigs: {},

	autoApprovalEnabled: true,
	alwaysAllowReadOnly: true,
	alwaysAllowReadOnlyOutsideWorkspace: false,
	alwaysAllowWrite: true,
	alwaysAllowWriteOutsideWorkspace: false,
	alwaysAllowWriteProtected: false,
	alwaysAllowDelete: true, // kilocode_change
	writeDelayMs: 1000,
	alwaysAllowBrowser: true,
	requestDelaySeconds: 10,
	alwaysAllowMcp: true,
	alwaysAllowModeSwitch: true,
	alwaysAllowSubtasks: true,
	alwaysAllowExecute: true,
	alwaysAllowFollowupQuestions: true,
	followupAutoApproveTimeoutMs: 0,
	allowedCommands: ["*"],
	commandExecutionTimeout: 20,
	commandTimeoutAllowlist: [],
	preventCompletionWithOpenTodos: false,

	browserToolEnabled: false,
	browserViewportSize: "900x600",
	screenshotQuality: 75,
	remoteBrowserEnabled: false,

	ttsEnabled: false,
	ttsSpeed: 1,
	soundEnabled: false,
	soundVolume: 0.5,
	dismissedNotificationIds: [], // kilocode_change
	systemNotificationsEnabled: true, // kilocode_change
	ghostServiceSettings: {}, // kilocode_change

	terminalOutputLineLimit: 500,
	terminalOutputCharacterLimit: DEFAULT_TERMINAL_OUTPUT_CHARACTER_LIMIT,
	terminalShellIntegrationTimeout: 30000,
	terminalCommandDelay: 0,
	terminalPowershellCounter: false,
	terminalZshOhMy: true,
	terminalZshClearEolMark: true,
	terminalZshP10k: false,
	terminalZdotdir: true,
	terminalCompressProgressBar: true,
	terminalShellIntegrationDisabled: true,

	diagnosticsEnabled: true,

	diffEnabled: true,
	fuzzyMatchThreshold: 1,

	enableCheckpoints: false,

	// kilocode_change start - Auto-purge defaults
	autoPurgeEnabled: false,
	autoPurgeDefaultRetentionDays: 30,
	autoPurgeFavoritedTaskRetentionDays: null, // null = never purge
	autoPurgeCompletedTaskRetentionDays: 30,
	autoPurgeIncompleteTaskRetentionDays: 7,
	// kilocode_change end

	rateLimitSeconds: 0,
	maxOpenTabsContext: 20,
	maxWorkspaceFiles: 200,
	maxGitStatusFiles: 20,
	showRooIgnoredFiles: true,
	maxReadFileLine: 500 /*kilocode_change*/, // -1 to enable full file reading.

	includeDiagnosticMessages: true,
	maxDiagnosticMessages: 50,

	language: "en",
	telemetrySetting: "enabled",

	mcpEnabled: false,

	mode: "code", // "architect",

	customModes: [],
}

export const EVALS_TIMEOUT = 5 * 60 * 1_000
