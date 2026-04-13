import type { SpeechProvider, SpeechVoice, SynthesisOptions } from "../../types/voice"

const controller: { current: AbortController | undefined } = { current: undefined }

interface GoogleVoiceEntry {
	id: string
	name: string
	locale: string
	gender: "Female" | "Male"
	description: string
}

const GOOGLE_VOICES: GoogleVoiceEntry[] = [
	// en-US Neural2
	{ id: "en-US-Neural2-A", name: "Neural2-A (US)", locale: "en-US", gender: "Male", description: "Natural American male voice" },
	{ id: "en-US-Neural2-C", name: "Neural2-C (US)", locale: "en-US", gender: "Female", description: "Clear, professional American female" },
	{ id: "en-US-Neural2-D", name: "Neural2-D (US)", locale: "en-US", gender: "Male", description: "Warm, conversational American male" },
	{ id: "en-US-Neural2-E", name: "Neural2-E (US)", locale: "en-US", gender: "Female", description: "Bright, friendly American female" },
	{ id: "en-US-Neural2-F", name: "Neural2-F (US)", locale: "en-US", gender: "Female", description: "Calm, composed American female" },
	{ id: "en-US-Neural2-G", name: "Neural2-G (US)", locale: "en-US", gender: "Female", description: "Energetic, youthful American female" },
	{ id: "en-US-Neural2-H", name: "Neural2-H (US)", locale: "en-US", gender: "Female", description: "Soft, gentle American female" },
	{ id: "en-US-Neural2-I", name: "Neural2-I (US)", locale: "en-US", gender: "Male", description: "Deep, authoritative American male" },
	{ id: "en-US-Neural2-J", name: "Neural2-J (US)", locale: "en-US", gender: "Male", description: "Casual, relaxed American male" },
	// en-GB Neural2
	{ id: "en-GB-Neural2-A", name: "Neural2-A (UK)", locale: "en-GB", gender: "Female", description: "Natural British female voice" },
	{ id: "en-GB-Neural2-B", name: "Neural2-B (UK)", locale: "en-GB", gender: "Male", description: "Warm, professional British male" },
	{ id: "en-GB-Neural2-C", name: "Neural2-C (UK)", locale: "en-GB", gender: "Female", description: "Clear, articulate British female" },
	{ id: "en-GB-Neural2-D", name: "Neural2-D (UK)", locale: "en-GB", gender: "Male", description: "Confident, polished British male" },
	// en-AU Neural2
	{ id: "en-AU-Neural2-A", name: "Neural2-A (AU)", locale: "en-AU", gender: "Female", description: "Friendly Australian female voice" },
	{ id: "en-AU-Neural2-B", name: "Neural2-B (AU)", locale: "en-AU", gender: "Male", description: "Warm, natural Australian male" },
	{ id: "en-AU-Neural2-C", name: "Neural2-C (AU)", locale: "en-AU", gender: "Female", description: "Bright, cheerful Australian female" },
	{ id: "en-AU-Neural2-D", name: "Neural2-D (AU)", locale: "en-AU", gender: "Male", description: "Strong, confident Australian male" },
	// en-IN Neural2
	{ id: "en-IN-Neural2-A", name: "Neural2-A (IN)", locale: "en-IN", gender: "Female", description: "Clear Indian English female voice" },
	{ id: "en-IN-Neural2-B", name: "Neural2-B (IN)", locale: "en-IN", gender: "Male", description: "Professional Indian English male" },
	// en-US Studio
	{ id: "en-US-Studio-O", name: "Studio-O (US)", locale: "en-US", gender: "Female", description: "Premium studio-quality American female" },
	{ id: "en-US-Studio-Q", name: "Studio-Q (US)", locale: "en-US", gender: "Male", description: "Premium studio-quality American male" },
]

function mapVoice(v: GoogleVoiceEntry): SpeechVoice {
	return {
		id: v.id,
		name: v.name,
		locale: v.locale,
		gender: v.gender,
		description: v.description,
		provider: "google",
	}
}

export const GoogleProvider: SpeechProvider = {
	id: "google",
	name: "Google Cloud TTS (4M chars/mo free)",
	tier: "freeTier",
	requiresApiKey: true,
	description: "Google Cloud Text-to-Speech with Neural2 and Studio voices",
	freeAllowance: "4M chars/month (WaveNet: 1M)",
	capabilities: {
		ssml: true,
		styles: false,
		emphasis: false,
		pronunciations: false,
		audioFormats: ["MP3", "OGG_OPUS", "LINEAR16"],
	},

	getVoices(): SpeechVoice[] {
		return GOOGLE_VOICES.map(mapVoice)
	},

	async synthesize(text: string, opts: SynthesisOptions): Promise<Blob> {
		controller.current?.abort()
		const ac = new AbortController()
		controller.current = ac

		const apiKey = opts.apiKey ?? ""
		const voiceName = opts.voiceId
		const languageCode = voiceName.split("-").slice(0, 2).join("-")

		const body = {
			input: { text },
			voice: { languageCode, name: voiceName },
			audioConfig: {
				audioEncoding: opts.audioFormat ?? "MP3",
				pitch: opts.pitch ?? 0,
				speakingRate: opts.rate ?? 1.0,
			},
		}

		const resp = await fetch(
			`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
				signal: ac.signal,
			},
		)

		if (!resp.ok) {
			throw new Error(`Google TTS error: ${resp.status} ${resp.statusText}`)
		}

		const json: { audioContent: string } = await resp.json()
		const binaryString = atob(json.audioContent)
		const bytes = Uint8Array.from(binaryString, (c) => c.charCodeAt(0))

		return new Blob([bytes], { type: "audio/mpeg" })
	},

	stop(): void {
		controller.current?.abort()
		controller.current = undefined
	},

	async testConnection(apiKey: string): Promise<boolean> {
		try {
			const resp = await fetch(
				`https://texttospeech.googleapis.com/v1/voices?key=${apiKey}&languageCode=en-US`,
			)
			return resp.ok
		} catch {
			return false
		}
	},
}
