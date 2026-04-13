import type { SpeechProvider } from "../types/voice"
import { BrowserProvider } from "../utils/speech-providers/browser-provider"
import { AzureProvider } from "../utils/speech-providers/azure-provider"
import { GoogleProvider } from "../utils/speech-providers/google-provider"
import { OpenAIProvider } from "../utils/speech-providers/openai-provider"
import { ElevenLabsProvider } from "../utils/speech-providers/elevenlabs-provider"
import { PollyProvider } from "../utils/speech-providers/polly-provider"

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

// Register built-in providers (browser first as default)
SpeechProviderRegistry.register(BrowserProvider)
SpeechProviderRegistry.register(AzureProvider)
SpeechProviderRegistry.register(GoogleProvider)
SpeechProviderRegistry.register(OpenAIProvider)
SpeechProviderRegistry.register(ElevenLabsProvider)
SpeechProviderRegistry.register(PollyProvider)
