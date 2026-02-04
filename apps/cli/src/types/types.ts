import type { ProviderName, ReasoningEffortExtended } from "@roo-code/types"
import type { OutputFormat } from "./json-events.js"

export const supportedProviders = [
	"anthropic",
	"openai-native",
	"gemini",
	"openrouter",
	"vercel-ai-gateway",
	"roo",
] as const satisfies ProviderName[]

export type SupportedProvider = (typeof supportedProviders)[number]

export function isSupportedProvider(provider: string): provider is SupportedProvider {
	return supportedProviders.includes(provider as SupportedProvider)
}

export type ReasoningEffortFlagOptions = ReasoningEffortExtended | "unspecified" | "disabled"

export type FlagOptions = {
	promptFile?: string
	workspace?: string
	print: boolean
	extension?: string
	debug: boolean
	yes: boolean
	dangerouslySkipPermissions: boolean
	apiKey?: string
	provider?: SupportedProvider
	model?: string
	mode?: string
	reasoningEffort?: ReasoningEffortFlagOptions
	ephemeral: boolean
	oneshot: boolean
	outputFormat?: OutputFormat
}

export enum OnboardingProviderChoice {
	Roo = "roo",
	Byok = "byok",
}

export interface OnboardingResult {
	choice: OnboardingProviderChoice
	token?: string
	skipped: boolean
}

export interface CliSettings {
	onboardingProviderChoice?: OnboardingProviderChoice
	/** Default mode to use (e.g., "code", "architect", "ask", "debug") */
	mode?: string
	/** Default provider to use */
	provider?: SupportedProvider
	/** Default model to use */
	model?: string
	/** Default reasoning effort level */
	reasoningEffort?: ReasoningEffortFlagOptions
	/** Auto-approve all prompts (use with caution) */
	dangerouslySkipPermissions?: boolean
	/** Exit upon task completion */
	oneshot?: boolean
}
