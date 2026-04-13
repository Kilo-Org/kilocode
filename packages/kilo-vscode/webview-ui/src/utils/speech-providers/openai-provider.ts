import type { SpeechProvider, SpeechVoice, SynthesisOptions } from "../../types/voice"

const controller: { current: AbortController | undefined } = { current: undefined }

interface OpenAIVoiceEntry {
	id: string
	name: string
	gender: "Female" | "Male" | "Unknown"
	description: string
}

const OPENAI_VOICES: OpenAIVoiceEntry[] = [
	{ id: "alloy", name: "Alloy", gender: "Unknown", description: "Balanced, neutral voice" },
	{ id: "ash", name: "Ash", gender: "Unknown", description: "Warm, measured voice" },
	{ id: "ballad", name: "Ballad", gender: "Unknown", description: "Expressive, melodic voice" },
	{ id: "coral", name: "Coral", gender: "Female", description: "Clear, bright voice" },
	{ id: "echo", name: "Echo", gender: "Male", description: "Smooth, resonant voice" },
	{ id: "fable", name: "Fable", gender: "Unknown", description: "Storytelling, narrative voice" },
	{ id: "nova", name: "Nova", gender: "Female", description: "Energetic, modern voice" },
	{ id: "onyx", name: "Onyx", gender: "Male", description: "Deep, authoritative voice" },
	{ id: "sage", name: "Sage", gender: "Unknown", description: "Calm, thoughtful voice" },
	{ id: "shimmer", name: "Shimmer", gender: "Female", description: "Light, sparkling voice" },
]

function mapVoice(v: OpenAIVoiceEntry): SpeechVoice {
	return {
		id: v.id,
		name: v.name,
		locale: "en-US",
		gender: v.gender,
		description: v.description,
		provider: "openai",
	}
}

export const OpenAIProvider: SpeechProvider = {
	id: "openai",
	name: "OpenAI TTS ($5 free credit)",
	tier: "freeTier",
	requiresApiKey: true,
	description: "OpenAI text-to-speech with natural-sounding voices",
	freeAllowance: "$5 free credit on signup",
	capabilities: {
		ssml: false,
		styles: false,
		emphasis: false,
		pronunciations: false,
		audioFormats: ["mp3", "opus", "aac", "flac"],
	},

	getVoices(): SpeechVoice[] {
		return OPENAI_VOICES.map(mapVoice)
	},

	async synthesize(text: string, opts: SynthesisOptions): Promise<Blob> {
		controller.current?.abort()
		const ac = new AbortController()
		controller.current = ac

		const apiKey = opts.apiKey ?? ""

		const body = {
			model: "tts-1",
			input: text,
			voice: opts.voiceId,
			speed: opts.rate ?? 1.0,
			response_format: "mp3",
		}

		const resp = await fetch("https://api.openai.com/v1/audio/speech", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
			signal: ac.signal,
		})

		if (!resp.ok) {
			throw new Error(`OpenAI TTS error: ${resp.status} ${resp.statusText}`)
		}

		return resp.blob()
	},

	stop(): void {
		controller.current?.abort()
		controller.current = undefined
	},

	async testConnection(apiKey: string): Promise<boolean> {
		try {
			const resp = await fetch("https://api.openai.com/v1/models", {
				headers: { Authorization: `Bearer ${apiKey}` },
			})
			return resp.ok
		} catch {
			return false
		}
	},
}
