import { describe, it, expect } from "bun:test"
import { AzureProvider } from "../../webview-ui/src/utils/speech-providers/azure-provider"
import { AZURE_VOICES } from "../../webview-ui/src/data/azure-voices"

describe("AzureProvider", () => {
	it("has correct id and metadata", () => {
		expect(AzureProvider.id).toBe("azure")
		expect(AzureProvider.tier).toBe("freeTier")
		expect(AzureProvider.requiresApiKey).toBe(true)
	})

	it("has full SSML capabilities", () => {
		expect(AzureProvider.capabilities.ssml).toBe(true)
		expect(AzureProvider.capabilities.styles).toBe(true)
		expect(AzureProvider.capabilities.emphasis).toBe(true)
		expect(AzureProvider.capabilities.pronunciations).toBe(true)
	})

	it("supports multiple audio formats", () => {
		expect(AzureProvider.capabilities.audioFormats.length).toBeGreaterThan(0)
		expect(AzureProvider.capabilities.audioFormats).toContain("audio-24khz-48kbitrate-mono-mp3")
	})

	it("maps all AZURE_VOICES to SpeechVoice format", () => {
		const voices = AzureProvider.getVoices()
		expect(voices.length).toBe(AZURE_VOICES.length)
	})

	it("sets provider field to azure on every voice", () => {
		const voices = AzureProvider.getVoices()
		for (const v of voices) {
			expect(v.provider).toBe("azure")
		}
	})

	it("preserves voice id, name, locale, and gender", () => {
		const voices = AzureProvider.getVoices()
		const first = AZURE_VOICES[0]
		const mapped = voices[0]
		expect(mapped.id).toBe(first.id)
		expect(mapped.name).toBe(first.name)
		expect(mapped.locale).toBe(first.locale)
		expect(mapped.gender).toBe(first.gender)
	})

	it("includes styles when present on source voice", () => {
		const source = AZURE_VOICES.find((v) => v.styles.length > 0)
		if (!source) return
		const voices = AzureProvider.getVoices()
		const mapped = voices.find((v) => v.id === source.id)
		expect(mapped?.styles).toEqual(source.styles)
	})

	it("omits styles when source voice has none", () => {
		const source = AZURE_VOICES.find((v) => v.styles.length === 0)
		if (!source) return
		const voices = AzureProvider.getVoices()
		const mapped = voices.find((v) => v.id === source.id)
		expect(mapped?.styles).toBeUndefined()
	})

	it("has a testConnection method", () => {
		expect(typeof AzureProvider.testConnection).toBe("function")
	})

	it("stop does not throw", () => {
		expect(() => AzureProvider.stop()).not.toThrow()
	})

	it("implements SpeechProvider interface shape", () => {
		expect(typeof AzureProvider.getVoices).toBe("function")
		expect(typeof AzureProvider.synthesize).toBe("function")
		expect(typeof AzureProvider.stop).toBe("function")
		expect(typeof AzureProvider.name).toBe("string")
		expect(typeof AzureProvider.description).toBe("string")
		expect(typeof AzureProvider.freeAllowance).toBe("string")
	})
})
