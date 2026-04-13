import type { SpeechProvider, SpeechVoice, SynthesisOptions } from "../../types/voice"

function available(): boolean {
	return typeof speechSynthesis !== "undefined"
}

function mapVoice(v: SpeechSynthesisVoice): SpeechVoice {
	const gender: SpeechVoice["gender"] = "Unknown"
	return {
		id: v.voiceURI,
		name: v.name,
		locale: v.lang,
		gender,
		description: v.localService ? "Local browser voice" : "Remote browser voice",
		provider: "browser",
	}
}

export const BrowserProvider: SpeechProvider = {
	id: "browser",
	name: "Browser (Web Speech API)",
	tier: "free",
	requiresApiKey: false,
	description: "Built-in browser speech synthesis, works offline with no API key",
	freeAllowance: "Unlimited",
	capabilities: {
		ssml: false,
		styles: false,
		emphasis: false,
		pronunciations: false,
		audioFormats: [],
	},

	getVoices(): SpeechVoice[] {
		if (!available()) return []
		return speechSynthesis.getVoices().map(mapVoice)
	},

	synthesize(text: string, opts: SynthesisOptions): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!available()) {
				reject(new Error("speechSynthesis is not available"))
				return
			}

			const utterance = new SpeechSynthesisUtterance(text)

			// Apply voice selection
			const voices = speechSynthesis.getVoices()
			const match = voices.find((v) => v.voiceURI === opts.voiceId)
			if (match) utterance.voice = match

			if (opts.pitch !== undefined) utterance.pitch = Math.max(0, Math.min(2, 1 + opts.pitch / 100))
			if (opts.rate !== undefined) utterance.rate = Math.max(0.1, Math.min(10, opts.rate))
			if (opts.volume !== undefined) utterance.volume = Math.max(0, Math.min(1, opts.volume / 100))

			utterance.onend = () => resolve()
			utterance.onerror = (ev) => reject(new Error(`Browser speech error: ${ev.error}`))

			speechSynthesis.speak(utterance)
		})
	},

	stop(): void {
		if (!available()) return
		speechSynthesis.cancel()
	},
}
