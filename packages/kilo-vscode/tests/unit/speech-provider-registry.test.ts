import { describe, it, expect } from "bun:test"
import { SpeechProviderRegistry } from "../../webview-ui/src/data/speech-providers"
import type { SpeechProvider, SpeechVoice, SynthesisOptions } from "../../webview-ui/src/types/voice"

function stub(overrides: Partial<SpeechProvider> & { id: string }): SpeechProvider {
	return {
		name: overrides.id,
		tier: "free",
		requiresApiKey: false,
		description: "stub",
		freeAllowance: "unlimited",
		capabilities: {
			ssml: false,
			styles: false,
			emphasis: false,
			pronunciations: false,
			audioFormats: [],
		},
		getVoices(): SpeechVoice[] {
			return []
		},
		synthesize(_text: string, _opts: SynthesisOptions): Promise<void> {
			return Promise.resolve()
		},
		stop() {},
		...overrides,
	}
}

describe("SpeechProviderRegistry", () => {
	it("registers and retrieves a provider", () => {
		const provider = stub({ id: "test-get" })
		SpeechProviderRegistry.register(provider)
		expect(SpeechProviderRegistry.get("test-get")).toBe(provider)
	})

	it("returns undefined for unknown provider", () => {
		expect(SpeechProviderRegistry.get("nonexistent")).toBeUndefined()
	})

	it("lists all registered providers", () => {
		const a = stub({ id: "list-a" })
		const b = stub({ id: "list-b" })
		SpeechProviderRegistry.register(a)
		SpeechProviderRegistry.register(b)
		const all = SpeechProviderRegistry.list()
		expect(all).toContain(a)
		expect(all).toContain(b)
	})

	it("filters by tier", () => {
		const free = stub({ id: "tier-free", tier: "free" })
		const paid = stub({ id: "tier-paid", tier: "freeTier" })
		SpeechProviderRegistry.register(free)
		SpeechProviderRegistry.register(paid)
		const result = SpeechProviderRegistry.listByTier("free")
		expect(result).toContain(free)
		expect(result).not.toContain(paid)
	})

	it("overwrites provider with same id", () => {
		const first = stub({ id: "overwrite", name: "first" })
		const second = stub({ id: "overwrite", name: "second" })
		SpeechProviderRegistry.register(first)
		SpeechProviderRegistry.register(second)
		expect(SpeechProviderRegistry.get("overwrite")?.name).toBe("second")
	})
})
