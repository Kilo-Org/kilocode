import { z } from "zod"

import { providerNames } from "./provider-settings.js"
import { clineMessageSchema } from "./message.js"
import { toolProtocolSchema } from "./tool.js" // kilocode_change

/**
 * TelemetrySetting
 */

export const telemetrySettings = ["unset", "enabled", "disabled"] as const

export const telemetrySettingsSchema = z.enum(telemetrySettings)

export type TelemetrySetting = z.infer<typeof telemetrySettingsSchema>

/**
 * TelemetryEventName
 */

export enum TelemetryEventName {
	// kilocode_change start
	COMMIT_MSG_GENERATED = "Commit Message Generated",

	INLINE_ASSIST_AUTO_TASK = "Inline Assist Auto Task",

	AUTOCOMPLETE_SUGGESTION_REQUESTED = "Autocomplete Suggestion Requested",
	AUTOCOMPLETE_LLM_REQUEST_COMPLETED = "Autocomplete LLM Request Completed",
	AUTOCOMPLETE_LLM_REQUEST_FAILED = "Autocomplete LLM Request Failed",
	AUTOCOMPLETE_LLM_SUGGESTION_RETURNED = "Autocomplete LLM Suggestion Returned",
	AUTOCOMPLETE_SUGGESTION_CACHE_HIT = "Autocomplete Suggestion Cache Hit",
	AUTOCOMPLETE_ACCEPT_SUGGESTION = "Autocomplete Accept Suggestion",
	AUTOCOMPLETE_SUGGESTION_FILTERED = "Autocomplete Suggestion Filtered",

	CHECKPOINT_FAILURE = "Checkpoint Failure",
	TOOL_ERROR = "Tool Error",
	MAX_COMPLETION_TOKENS_REACHED_ERROR = "Max Completion Tokens Reached Error",
	NOTIFICATION_CLICKED = "Notification Clicked",
	WEBVIEW_MEMORY_USAGE = "Webview Memory Usage",
	MEMORY_WARNING_SHOWN = "Memory Warning Shown",
	FREE_MODELS_LINK_CLICKED = "Free Models Link Clicked",
	CREATE_ORGANIZATION_LINK_CLICKED = "Create Organization Link Clicked",
	SUGGESTION_BUTTON_CLICKED = "Suggestion Button Clicked",
	NO_ASSISTANT_MESSAGES = "No Assistant Messages",
	AUTO_PURGE_STARTED = "Auto Purge Started",
	AUTO_PURGE_COMPLETED = "Auto Purge Completed",
	AUTO_PURGE_FAILED = "Auto Purge Failed",
	MANUAL_PURGE_TRIGGERED = "Manual Purge Triggered",
	GHOST_SERVICE_DISABLED = "Ghost Service Disabled",
	ASK_APPROVAL = "Ask Approval",
	MISSING_MANAGED_INDEXER = "Missing Managed Indexer",

	AGENT_MANAGER_OPENED = "Agent Manager Opened",
	AGENT_MANAGER_SESSION_STARTED = "Agent Manager Session Started",
	AGENT_MANAGER_SESSION_COMPLETED = "Agent Manager Session Completed",
	AGENT_MANAGER_SESSION_STOPPED = "Agent Manager Session Stopped",
	AGENT_MANAGER_SESSION_ERROR = "Agent Manager Session Error",
	AGENT_MANAGER_LOGIN_ISSUE = "Agent Manager Login Issue",
	// kilocode_change end

	TASK_CREATED = "Task Created",
	TASK_RESTARTED = "Task Reopened",
	TASK_COMPLETED = "Task Completed",
	TASK_MESSAGE = "Task Message",
	TASK_CONVERSATION_MESSAGE = "Conversation Message",
	LLM_COMPLETION = "LLM Completion",
	MODE_SWITCH = "Mode Switched",
	MODE_SELECTOR_OPENED = "Mode Selector Opened",
	TOOL_USED = "Tool Used",

	CHECKPOINT_CREATED = "Checkpoint Created",
	CHECKPOINT_RESTORED = "Checkpoint Restored",
	CHECKPOINT_DIFFED = "Checkpoint Diffed",

	TAB_SHOWN = "Tab Shown",
	MODE_SETTINGS_CHANGED = "Mode Setting Changed",
	CUSTOM_MODE_CREATED = "Custom Mode Created",

	CONTEXT_CONDENSED = "Context Condensed",
	SLIDING_WINDOW_TRUNCATION = "Sliding Window Truncation",

	CODE_ACTION_USED = "Code Action Used",
	PROMPT_ENHANCED = "Prompt Enhanced",

	TITLE_BUTTON_CLICKED = "Title Button Clicked",

	AUTHENTICATION_INITIATED = "Authentication Initiated",

	MARKETPLACE_ITEM_INSTALLED = "Marketplace Item Installed",
	MARKETPLACE_ITEM_REMOVED = "Marketplace Item Removed",
	MARKETPLACE_TAB_VIEWED = "Marketplace Tab Viewed",
	MARKETPLACE_INSTALL_BUTTON_CLICKED = "Marketplace Install Button Clicked",

	SHARE_BUTTON_CLICKED = "Share Button Clicked",
	SHARE_ORGANIZATION_CLICKED = "Share Organization Clicked",
	SHARE_PUBLIC_CLICKED = "Share Public Clicked",
	SHARE_CONNECT_TO_CLOUD_CLICKED = "Share Connect To Cloud Clicked",

	ACCOUNT_CONNECT_CLICKED = "Account Connect Clicked",
	ACCOUNT_CONNECT_SUCCESS = "Account Connect Success",
	ACCOUNT_LOGOUT_CLICKED = "Account Logout Clicked",
	ACCOUNT_LOGOUT_SUCCESS = "Account Logout Success",

	FEATURED_PROVIDER_CLICKED = "Featured Provider Clicked",

	UPSELL_DISMISSED = "Upsell Dismissed",
	UPSELL_CLICKED = "Upsell Clicked",

	SCHEMA_VALIDATION_ERROR = "Schema Validation Error",
	DIFF_APPLICATION_ERROR = "Diff Application Error",
	SHELL_INTEGRATION_ERROR = "Shell Integration Error",
	CONSECUTIVE_MISTAKE_ERROR = "Consecutive Mistake Error",
	CODE_INDEX_ERROR = "Code Index Error",
	TELEMETRY_SETTINGS_CHANGED = "Telemetry Settings Changed",
	MODEL_CACHE_EMPTY_RESPONSE = "Model Cache Empty Response",
}

/**
 * TelemetryProperties
 */

export const staticAppPropertiesSchema = z.object({
	appName: z.string(),
	appVersion: z.string(),
	vscodeVersion: z.string(),
	platform: z.string(),
	editorName: z.string(),
	// kilocode_change start
	wrapped: z.boolean(),
	wrapper: z.string().nullable(),
	wrapperTitle: z.string().nullable(),
	wrapperCode: z.string().nullable(),
	wrapperVersion: z.string().nullable(),
	machineId: z.string().nullable(),
	vscodeIsTelemetryEnabled: z.boolean().nullable(),
	// kilocode_change end
	hostname: z.string().optional(),
})

export type StaticAppProperties = z.infer<typeof staticAppPropertiesSchema>

export const dynamicAppPropertiesSchema = z.object({
	language: z.string(),
	mode: z.string(),
})

export type DynamicAppProperties = z.infer<typeof dynamicAppPropertiesSchema>

export const cloudAppPropertiesSchema = z.object({
	cloudIsAuthenticated: z.boolean().optional(),
})

export type CloudAppProperties = z.infer<typeof cloudAppPropertiesSchema>

export const appPropertiesSchema = z.object({
	...staticAppPropertiesSchema.shape,
	...dynamicAppPropertiesSchema.shape,
	...cloudAppPropertiesSchema.shape,
})

export type AppProperties = z.infer<typeof appPropertiesSchema>

export const taskPropertiesSchema = z.object({
	taskId: z.string().optional(),
	parentTaskId: z.string().optional(),
	apiProvider: z.enum(providerNames).optional(),
	modelId: z.string().optional(),
	diffStrategy: z.string().optional(),
	isSubtask: z.boolean().optional(),
	todos: z
		.object({
			total: z.number(),
			completed: z.number(),
			inProgress: z.number(),
			pending: z.number(),
		})
		.optional(),
	// kilocode_change start
	currentTaskSize: z.number().optional(),
	taskHistorySize: z.number().optional(),
	toolStyle: toolProtocolSchema.optional(),
	// kilocode_change end
})

export type TaskProperties = z.infer<typeof taskPropertiesSchema>

export const gitPropertiesSchema = z.object({
	repositoryUrl: z.string().optional(),
	repositoryName: z.string().optional(),
	defaultBranch: z.string().optional(),
})

export type GitProperties = z.infer<typeof gitPropertiesSchema>

export const telemetryPropertiesSchema = z.object({
	...appPropertiesSchema.shape,
	...taskPropertiesSchema.shape,
	...gitPropertiesSchema.shape,
})

export type TelemetryProperties = z.infer<typeof telemetryPropertiesSchema>

/**
 * TelemetryEvent
 */

export type TelemetryEvent = {
	event: TelemetryEventName
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	properties?: Record<string, any>
}

/**
 * RooCodeTelemetryEvent
 */

export const rooCodeTelemetryEventSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.enum([
			// kilocode_change start
			TelemetryEventName.COMMIT_MSG_GENERATED, // kilocode_change
			TelemetryEventName.INLINE_ASSIST_AUTO_TASK, // kilocode_change
			TelemetryEventName.AUTOCOMPLETE_SUGGESTION_REQUESTED, // kilocode_change
			TelemetryEventName.AUTOCOMPLETE_LLM_REQUEST_COMPLETED, // kilocode_change
			TelemetryEventName.AUTOCOMPLETE_LLM_REQUEST_FAILED, // kilocode_change
			TelemetryEventName.AUTOCOMPLETE_LLM_SUGGESTION_RETURNED, // kilocode_change
			TelemetryEventName.AUTOCOMPLETE_SUGGESTION_CACHE_HIT, // kilocode_change
			TelemetryEventName.AUTOCOMPLETE_ACCEPT_SUGGESTION, // kilocode_change
			TelemetryEventName.AUTOCOMPLETE_SUGGESTION_FILTERED, // kilocode_change
			TelemetryEventName.WEBVIEW_MEMORY_USAGE, // kilocode_change
			TelemetryEventName.AUTO_PURGE_STARTED, // kilocode_change
			TelemetryEventName.AUTO_PURGE_COMPLETED, // kilocode_change
			TelemetryEventName.AUTO_PURGE_FAILED, // kilocode_change
			TelemetryEventName.MANUAL_PURGE_TRIGGERED, // kilocode_change
			TelemetryEventName.GHOST_SERVICE_DISABLED, // kilocode_change
			TelemetryEventName.AGENT_MANAGER_OPENED, // kilocode_change
			TelemetryEventName.AGENT_MANAGER_SESSION_STARTED, // kilocode_change
			TelemetryEventName.AGENT_MANAGER_SESSION_COMPLETED, // kilocode_change
			TelemetryEventName.AGENT_MANAGER_SESSION_STOPPED, // kilocode_change
			TelemetryEventName.AGENT_MANAGER_SESSION_ERROR, // kilocode_change
			TelemetryEventName.AGENT_MANAGER_LOGIN_ISSUE, // kilocode_change
			// kilocode_change end

			TelemetryEventName.TASK_CREATED,
			TelemetryEventName.TASK_RESTARTED,
			TelemetryEventName.TASK_COMPLETED,
			TelemetryEventName.TASK_CONVERSATION_MESSAGE,
			TelemetryEventName.MODE_SWITCH,
			TelemetryEventName.MODE_SELECTOR_OPENED,
			TelemetryEventName.TOOL_USED,
			TelemetryEventName.CHECKPOINT_CREATED,
			TelemetryEventName.CHECKPOINT_RESTORED,
			TelemetryEventName.CHECKPOINT_DIFFED,
			TelemetryEventName.CODE_ACTION_USED,
			TelemetryEventName.PROMPT_ENHANCED,
			TelemetryEventName.TITLE_BUTTON_CLICKED,
			TelemetryEventName.AUTHENTICATION_INITIATED,
			TelemetryEventName.MARKETPLACE_ITEM_INSTALLED,
			TelemetryEventName.MARKETPLACE_ITEM_REMOVED,
			TelemetryEventName.MARKETPLACE_TAB_VIEWED,
			TelemetryEventName.MARKETPLACE_INSTALL_BUTTON_CLICKED,
			TelemetryEventName.SHARE_BUTTON_CLICKED,
			TelemetryEventName.SHARE_ORGANIZATION_CLICKED,
			TelemetryEventName.SHARE_PUBLIC_CLICKED,
			TelemetryEventName.SHARE_CONNECT_TO_CLOUD_CLICKED,
			TelemetryEventName.ACCOUNT_CONNECT_CLICKED,
			TelemetryEventName.ACCOUNT_CONNECT_SUCCESS,
			TelemetryEventName.ACCOUNT_LOGOUT_CLICKED,
			TelemetryEventName.ACCOUNT_LOGOUT_SUCCESS,
			TelemetryEventName.FEATURED_PROVIDER_CLICKED,
			TelemetryEventName.UPSELL_DISMISSED,
			TelemetryEventName.UPSELL_CLICKED,
			TelemetryEventName.SCHEMA_VALIDATION_ERROR,
			TelemetryEventName.DIFF_APPLICATION_ERROR,
			TelemetryEventName.SHELL_INTEGRATION_ERROR,
			TelemetryEventName.CONSECUTIVE_MISTAKE_ERROR,
			TelemetryEventName.CODE_INDEX_ERROR,
			TelemetryEventName.MODEL_CACHE_EMPTY_RESPONSE,
			TelemetryEventName.CONTEXT_CONDENSED,
			TelemetryEventName.SLIDING_WINDOW_TRUNCATION,
			TelemetryEventName.TAB_SHOWN,
			TelemetryEventName.MODE_SETTINGS_CHANGED,
			TelemetryEventName.CUSTOM_MODE_CREATED,
		]),
		properties: telemetryPropertiesSchema,
	}),
	z.object({
		type: z.literal(TelemetryEventName.TELEMETRY_SETTINGS_CHANGED),
		properties: z.object({
			...telemetryPropertiesSchema.shape,
			previousSetting: telemetrySettingsSchema,
			newSetting: telemetrySettingsSchema,
		}),
	}),
	z.object({
		type: z.literal(TelemetryEventName.TASK_MESSAGE),
		properties: z.object({
			...telemetryPropertiesSchema.shape,
			taskId: z.string(),
			message: clineMessageSchema,
		}),
	}),
	z.object({
		type: z.literal(TelemetryEventName.LLM_COMPLETION),
		properties: z.object({
			...telemetryPropertiesSchema.shape,
			inputTokens: z.number(),
			outputTokens: z.number(),
			cacheReadTokens: z.number().optional(),
			cacheWriteTokens: z.number().optional(),
			cost: z.number().optional(),
		}),
	}),
])

export type RooCodeTelemetryEvent = z.infer<typeof rooCodeTelemetryEventSchema>

/**
 * TelemetryEventSubscription
 */

export type TelemetryEventSubscription =
	| { type: "include"; events: TelemetryEventName[] }
	| { type: "exclude"; events: TelemetryEventName[] }

/**
 * TelemetryPropertiesProvider
 */

export interface TelemetryPropertiesProvider {
	getTelemetryProperties(): Promise<TelemetryProperties>
}

/**
 * TelemetryClient
 */

export interface TelemetryClient {
	subscription?: TelemetryEventSubscription

	setProvider(provider: TelemetryPropertiesProvider): void
	capture(options: TelemetryEvent): Promise<void>
	// kilocode_change start
	captureException(error: Error, properties?: Record<string | number, unknown>): void
	updateIdentity(kilocodeToken: string): Promise<void>
	// kilocode_change end
	updateTelemetryState(isOptedIn: boolean): void
	isTelemetryEnabled(): boolean
	shutdown(): Promise<void>
}

/**
 * Expected API error codes that should not be reported to telemetry.
 * These are normal/expected errors that users can't do much about.
 */
export const EXPECTED_API_ERROR_CODES = new Set([
	402, // Payment required - billing issues
	429, // Rate limit - expected when hitting API limits
])

/**
 * Patterns in error messages that indicate expected errors (rate limits, etc.)
 * These are checked when no numeric error code is available.
 */
const EXPECTED_ERROR_MESSAGE_PATTERNS = [
	/^429\b/, // Message starts with "429"
	/rate limit/i, // Contains "rate limit" (case insensitive)
]

/**
 * Interface representing the error structure from OpenAI SDK.
 * OpenAI SDK errors (APIError, AuthenticationError, RateLimitError, etc.)
 * have a numeric `status` property and may contain nested error metadata.
 *
 * @see https://github.com/openai/openai-node/blob/master/src/error.ts
 */
interface OpenAISdkError {
	/** HTTP status code of the error response */
	status: number
	/** Optional error code (may be numeric or string) */
	code?: number | string
	/** Primary error message */
	message: string
	/** Nested error object containing additional details from the API response */
	error?: {
		message?: string
		metadata?: {
			/** Raw error message from upstream provider (e.g., OpenRouter upstream errors) */
			raw?: string
		}
	}
}

/**
 * Type guard to check if an error object is an OpenAI SDK error.
 * OpenAI SDK errors (APIError and subclasses) have: status, code, message properties.
 */
function isOpenAISdkError(error: unknown): error is OpenAISdkError {
	return (
		typeof error === "object" &&
		error !== null &&
		"status" in error &&
		typeof (error as OpenAISdkError).status === "number"
	)
}

/**
 * Extracts the HTTP status code from an error object.
 * Supports OpenAI SDK errors that have a status property.
 * @param error - The error to extract status from
 * @returns The status code if available, undefined otherwise
 */
export function getErrorStatusCode(error: unknown): number | undefined {
	if (isOpenAISdkError(error)) {
		return error.status
	}
	return undefined
}

/**
 * Extracts the most descriptive error message from an OpenAI SDK error.
 * Prioritizes nested metadata (upstream provider errors) over the standard message.
 * @param error - The error to extract message from
 * @returns The best available error message, or undefined if not an OpenAI SDK error
 */
export function getErrorMessage(error: unknown): string | undefined {
	if (isOpenAISdkError(error)) {
		// Prioritize nested metadata which may contain upstream provider details
		return error.error?.metadata?.raw || error.error?.message || error.message
	}
	return undefined
}

/**
 * Helper to check if an API error should be reported to telemetry.
 * Filters out expected errors like rate limits by checking both error codes and messages.
 * @param errorCode - The HTTP error code (if available)
 * @param errorMessage - The error message (if available)
 * @returns true if the error should be reported, false if it should be filtered out
 */
export function shouldReportApiErrorToTelemetry(errorCode?: number, errorMessage?: string): boolean {
	// Check numeric error code
	if (errorCode !== undefined && EXPECTED_API_ERROR_CODES.has(errorCode)) {
		return false
	}

	// Check error message for expected patterns (e.g., "429 Rate limit exceeded")
	if (errorMessage) {
		for (const pattern of EXPECTED_ERROR_MESSAGE_PATTERNS) {
			if (pattern.test(errorMessage)) {
				return false
			}
		}
	}

	return true
}

/**
 * Generic API provider error class for structured error tracking via PostHog.
 * Can be reused by any API provider.
 */
export class ApiProviderError extends Error {
	constructor(
		message: string,
		public readonly provider: string,
		public readonly modelId: string,
		public readonly operation: string,
		public readonly errorCode?: number,
	) {
		super(message)
		this.name = "ApiProviderError"
	}
}

/**
 * Type guard to check if an error is an ApiProviderError.
 * Used by telemetry to automatically extract structured properties.
 */
export function isApiProviderError(error: unknown): error is ApiProviderError {
	return (
		error instanceof Error &&
		error.name === "ApiProviderError" &&
		"provider" in error &&
		"modelId" in error &&
		"operation" in error
	)
}

/**
 * Extracts properties from an ApiProviderError for telemetry.
 * Returns the structured properties that can be merged with additionalProperties.
 */
export function extractApiProviderErrorProperties(error: ApiProviderError): Record<string, unknown> {
	return {
		provider: error.provider,
		modelId: error.modelId,
		operation: error.operation,
		...(error.errorCode !== undefined && { errorCode: error.errorCode }),
	}
}
