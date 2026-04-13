import type { SpeechProvider, SpeechVoice, SynthesisOptions } from "../../types/voice"

const controller: { current: AbortController | undefined } = { current: undefined }

interface PollyVoiceEntry {
	id: string
	name: string
	locale: string
	gender: "Female" | "Male"
	engine: "neural" | "standard"
	description: string
}

const POLLY_VOICES: PollyVoiceEntry[] = [
	// en-GB
	{ id: "Amy", name: "Amy (UK)", locale: "en-GB", gender: "Female", engine: "neural", description: "Clear, professional British female" },
	{ id: "Emma", name: "Emma (UK)", locale: "en-GB", gender: "Female", engine: "neural", description: "Warm, friendly British female" },
	{ id: "Brian", name: "Brian (UK)", locale: "en-GB", gender: "Male", engine: "neural", description: "Authoritative British male" },
	{ id: "Arthur", name: "Arthur (UK)", locale: "en-GB", gender: "Male", engine: "neural", description: "Mature, polished British male" },
	// en-US
	{ id: "Joanna", name: "Joanna (US)", locale: "en-US", gender: "Female", engine: "neural", description: "Clear, versatile American female" },
	{ id: "Kendra", name: "Kendra (US)", locale: "en-US", gender: "Female", engine: "neural", description: "Warm, professional American female" },
	{ id: "Kimberly", name: "Kimberly (US)", locale: "en-US", gender: "Female", engine: "neural", description: "Bright, energetic American female" },
	{ id: "Salli", name: "Salli (US)", locale: "en-US", gender: "Female", engine: "neural", description: "Soft, natural American female" },
	{ id: "Joey", name: "Joey (US)", locale: "en-US", gender: "Male", engine: "neural", description: "Casual, friendly American male" },
	{ id: "Justin", name: "Justin (US)", locale: "en-US", gender: "Male", engine: "neural", description: "Young, youthful American male" },
	{ id: "Kevin", name: "Kevin (US)", locale: "en-US", gender: "Male", engine: "neural", description: "Young, child-like American male" },
	{ id: "Matthew", name: "Matthew (US)", locale: "en-US", gender: "Male", engine: "neural", description: "Calm, measured American male" },
	{ id: "Ruth", name: "Ruth (US)", locale: "en-US", gender: "Female", engine: "neural", description: "Gentle, composed American female" },
	{ id: "Stephen", name: "Stephen (US)", locale: "en-US", gender: "Male", engine: "neural", description: "Confident, articulate American male" },
	// en-AU
	{ id: "Olivia", name: "Olivia (AU)", locale: "en-AU", gender: "Female", engine: "neural", description: "Natural Australian female voice" },
	// en-NZ
	{ id: "Aria", name: "Aria (NZ)", locale: "en-NZ", gender: "Female", engine: "neural", description: "Clear, modern New Zealand female" },
	// en-ZA
	{ id: "Ayanda", name: "Ayanda (ZA)", locale: "en-ZA", gender: "Female", engine: "neural", description: "Warm South African female voice" },
	// en-IE
	{ id: "Niamh", name: "Niamh (IE)", locale: "en-IE", gender: "Female", engine: "neural", description: "Melodic, charming Irish female" },
	// en-IN
	{ id: "Raveena", name: "Raveena (IN)", locale: "en-IN", gender: "Female", engine: "neural", description: "Clear Indian English female voice" },
	{ id: "Kajal", name: "Kajal (IN)", locale: "en-IN", gender: "Female", engine: "neural", description: "Professional Indian English female" },
]

function mapVoice(v: PollyVoiceEntry): SpeechVoice {
	return {
		id: v.id,
		name: v.name,
		locale: v.locale,
		gender: v.gender,
		description: v.description,
		provider: "polly",
	}
}

export const PollyProvider: SpeechProvider = {
	id: "polly",
	name: "Amazon Polly (5M chars/mo free)",
	tier: "freeTier",
	requiresApiKey: true,
	description: "Amazon Polly neural text-to-speech with SSML support",
	freeAllowance: "5M chars/month (12 months)",
	capabilities: {
		ssml: true,
		styles: false,
		emphasis: true,
		pronunciations: true,
		audioFormats: ["mp3", "ogg_vorbis", "pcm"],
	},

	getVoices(): SpeechVoice[] {
		return POLLY_VOICES.map(mapVoice)
	},

	async synthesize(text: string, opts: SynthesisOptions): Promise<Blob> {
		controller.current?.abort()
		const ac = new AbortController()
		controller.current = ac

		const apiKey = opts.apiKey ?? ""
		const region = opts.region ?? "us-east-1"

		// NOTE: Production use requires AWS Signature V4 authentication.
		// This simplified implementation uses an API key header for development/proxy scenarios.
		// For direct AWS access, use the AWS SDK or implement SigV4 signing.
		const body = {
			Text: text,
			OutputFormat: opts.audioFormat ?? "mp3",
			VoiceId: opts.voiceId,
			Engine: "neural",
			SampleRate: "24000",
		}

		const resp = await fetch(
			`https://polly.${region}.amazonaws.com/v1/speech`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Api-Key": apiKey,
				},
				body: JSON.stringify(body),
				signal: ac.signal,
			},
		)

		if (!resp.ok) {
			throw new Error(`Amazon Polly error: ${resp.status} ${resp.statusText}`)
		}

		return resp.blob()
	},

	stop(): void {
		controller.current?.abort()
		controller.current = undefined
	},

	async testConnection(_apiKey: string, _region?: string): Promise<boolean> {
		// NOTE: AWS Signature V4 authentication is required for direct Polly API access.
		// Connection testing would need SigV4 signing or an intermediary proxy.
		// For now, return false to indicate the connection cannot be verified from the browser.
		try {
			return false
		} catch {
			return false
		}
	},
}
