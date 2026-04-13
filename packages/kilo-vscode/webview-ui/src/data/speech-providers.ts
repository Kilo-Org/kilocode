import type { SpeechProvider } from "../types/voice"

const providers = new Map<string, SpeechProvider>()

export const SpeechProviderRegistry = {
	register(provider: SpeechProvider): void {
		providers.set(provider.id, provider)
	},
	get(id: string): SpeechProvider | undefined {
		return providers.get(id)
	},
	list(): SpeechProvider[] {
		return [...providers.values()]
	},
	listByTier(tier: "free" | "freeTier"): SpeechProvider[] {
		return [...providers.values()].filter((p) => p.tier === tier)
	},
}
