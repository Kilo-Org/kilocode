/**
 * Mock implementation of @roo-code/types for benchmarks
 * Provides essential type definitions without full workspace dependencies
 */

// Telemetry types
export enum TelemetryEventName {
	GHOST_SUGGESTION_GENERATED = "ghost_suggestion_generated",
	GHOST_SUGGESTION_ACCEPTED = "ghost_suggestion_accepted",
	GHOST_SUGGESTION_REJECTED = "ghost_suggestion_rejected",
	GHOST_ENGINE_ERROR = "ghost_engine_error",
}

// Ghost service settings
export interface GhostServiceSettings {
	enabled: boolean
	enableCustomProvider: boolean
	enableInlineCompletions: boolean
	enableDecorations: boolean
	maxSuggestions: number
	debounceMs: number
	timeoutMs: number
}

// Provider settings
export interface ProviderSettings {
	apiProvider: string
	modelId: string
	apiKey?: string
	baseUrl?: string
	maxTokens?: number
	temperature?: number
}

// API configuration
export interface ApiConfiguration {
	id: string
	name: string
	apiProvider: string
	modelId: string
	settings: ProviderSettings
}

// Mock RooCode events for API
export interface RooCodeAPIEvents {
	taskCreated: [string, ...unknown[]]
	taskStarted: [string, ...unknown[]]
	taskCompleted: [string, any, any, any, ...unknown[]]
	providerProfileChanged: [string, ...unknown[]]
}

// Export commonly used types
export type RooCodeSettings = Record<string, any>

// Mock provider profile data schema (simplified)
export const virtualQuotaFallbackProfileDataSchema = {
	parse: (data: any) => data,
	safeParse: (data: any) => ({ success: true, data }),
}
