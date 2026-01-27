import type { ProviderName, ReasoningEffortExtended } from "@roo-code/types"

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
	prompt?: string
	extension?: string
	debug: boolean
	yes: boolean
	apiKey?: string
	provider: SupportedProvider
	model?: string
	mode?: string
	reasoningEffort?: ReasoningEffortFlagOptions
	exitOnComplete: boolean
	waitOnComplete: boolean
	ephemeral: boolean
	tui: boolean
}

export enum OnboardingProviderChoice {
	Roo = "roo",
	Byok = "byok",
}

export interface OnboardingResult {
	choice: OnboardingProviderChoice
	authenticated?: boolean
	skipped: boolean
}

export interface CliSettings {
	onboardingProviderChoice?: OnboardingProviderChoice
}
