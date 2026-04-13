import { describe, it, expect } from "bun:test"
import { BrowserProvider } from "../../webview-ui/src/utils/speech-providers/browser-provider"

describe("BrowserProvider", () => {
	it("has correct id and metadata", () => {
		expect(BrowserProvider.id).toBe("browser")
		expect(BrowserProvider.tier).toBe("free")
		expect(BrowserProvider.requiresApiKey).toBe(false)
	})

	it("does not require an API key", () => {
		expect(BrowserProvider.requiresApiKey).toBe(false)
	})

	it("has no SSML capabilities", () => {
		expect(BrowserProvider.capabilities.ssml).toBe(false)
		expect(BrowserProvider.capabilities.styles).toBe(false)
		expect(BrowserProvider.capabilities.emphasis).toBe(false)
		expect(BrowserProvider.capabilities.pronunciations).toBe(false)
	})

	it("reports no audio formats", () => {
		expect(BrowserProvider.capabilities.audioFormats).toEqual([])
	})

	it("returns empty voices when speechSynthesis is unavailable", () => {
		// In bun/node there is no speechSynthesis global
		expect(BrowserProvider.getVoices()).toEqual([])
	})

	it("stop does not throw when speechSynthesis is unavailable", () => {
		expect(() => BrowserProvider.stop()).not.toThrow()
	})

	it("synthesize rejects when speechSynthesis is unavailable", async () => {
		await expect(
			BrowserProvider.synthesize("hello", { voiceId: "test" }),
		).rejects.toThrow("speechSynthesis is not available")
	})

	it("has no testConnection method", () => {
		expect(BrowserProvider.testConnection).toBeUndefined()
	})

	it("implements SpeechProvider interface shape", () => {
		expect(typeof BrowserProvider.getVoices).toBe("function")
		expect(typeof BrowserProvider.synthesize).toBe("function")
		expect(typeof BrowserProvider.stop).toBe("function")
		expect(typeof BrowserProvider.name).toBe("string")
		expect(typeof BrowserProvider.description).toBe("string")
		expect(typeof BrowserProvider.freeAllowance).toBe("string")
	})
})
