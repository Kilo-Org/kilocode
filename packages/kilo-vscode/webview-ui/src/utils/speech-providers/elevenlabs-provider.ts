import type { SpeechProvider, SpeechVoice, SynthesisOptions } from "../../types/voice"

const controller: { current: AbortController | undefined } = { current: undefined }

interface ElevenLabsVoiceEntry {
	id: string
	name: string
	gender: "Female" | "Male"
	description: string
}

const ELEVENLABS_VOICES: ElevenLabsVoiceEntry[] = [
	{ id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", gender: "Female", description: "Calm, natural narration voice" },
	{ id: "AZnzlk1XvdvUeBnXmlld", name: "Domi", gender: "Female", description: "Strong, confident voice" },
	{ id: "EXAVITQu4vr4xnSDxMaL", name: "Bella", gender: "Female", description: "Soft, warm storytelling voice" },
	{ id: "ErXwobaYiN019PkySvjV", name: "Antoni", gender: "Male", description: "Well-rounded, expressive male" },
	{ id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli", gender: "Female", description: "Young, cheerful female voice" },
	{ id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh", gender: "Male", description: "Deep, narrative male voice" },
	{ id: "VR6AewLTigWG4xSOukaG", name: "Arnold", gender: "Male", description: "Crisp, authoritative male" },
	{ id: "pNInz6obpgDQGcFmaJgB", name: "Adam", gender: "Male", description: "Clear, professional male voice" },
	{ id: "yoZ06aMxZJJ28mfd3POQ", name: "Sam", gender: "Male", description: "Raspy, authentic male voice" },
	{ id: "jsCqWAovK2LkecY7zXl4", name: "Gigi", gender: "Female", description: "Lively, animated female voice" },
]

function mapVoice(v: ElevenLabsVoiceEntry): SpeechVoice {
	return {
		id: v.id,
		name: v.name,
		locale: "en-US",
		gender: v.gender,
		description: v.description,
		provider: "elevenlabs",
	}
}

export const ElevenLabsProvider: SpeechProvider = {
	id: "elevenlabs",
	name: "ElevenLabs (10K chars/mo free)",
	tier: "freeTier",
	requiresApiKey: true,
	description: "ElevenLabs high-quality AI voice synthesis",
	freeAllowance: "10K chars/month",
	capabilities: {
		ssml: false,
		styles: false,
		emphasis: false,
		pronunciations: false,
		audioFormats: ["mp3_44100_128"],
	},

	getVoices(): SpeechVoice[] {
		return ELEVENLABS_VOICES.map(mapVoice)
	},

	async synthesize(text: string, opts: SynthesisOptions): Promise<Blob> {
		controller.current?.abort()
		const ac = new AbortController()
		controller.current = ac

		const apiKey = opts.apiKey ?? ""
		const voiceId = opts.voiceId

		const body = {
			text,
			model_id: "eleven_monolingual_v1",
			voice_settings: {
				stability: 0.5,
				similarity_boost: 0.75,
			},
		}

		const resp = await fetch(
			`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
			{
				method: "POST",
				headers: {
					"xi-api-key": apiKey,
					"Content-Type": "application/json",
					Accept: "audio/mpeg",
				},
				body: JSON.stringify(body),
				signal: ac.signal,
			},
		)

		if (!resp.ok) {
			throw new Error(`ElevenLabs TTS error: ${resp.status} ${resp.statusText}`)
		}

		return resp.blob()
	},

	stop(): void {
		controller.current?.abort()
		controller.current = undefined
	},

	async testConnection(apiKey: string): Promise<boolean> {
		try {
			const resp = await fetch("https://api.elevenlabs.io/v1/user", {
				headers: { "xi-api-key": apiKey },
			})
			return resp.ok
		} catch {
			return false
		}
	},
}
