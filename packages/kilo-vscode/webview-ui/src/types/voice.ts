export interface VoicePreset {
	name: string
	voiceId: string
	pitch: number
	rate: number
	volume: number | null
	style: string
	styleDegree: number
	sentencePause: number
	paragraphBreak: number
	emphasis: string
	pronunciations: PronunciationEntry[]
	audioFormat: string
}

export interface PronunciationEntry {
	word: string
	pronounceAs: string
}

export interface FavoritesConfig {
	starredVoices: string[]
	presets: VoicePreset[]
	order: string[]
}

export interface SpeechSettings {
	enabled: boolean
	autoSpeak: boolean
	volume: number
	interactionMode: string
	interruptOnType: boolean
	debugMode: boolean
	sentimentIntensity: number
	multiVoiceMode: boolean
	azure: {
		apiKey: string
		region: string
		voiceId: string
	}
	tuning: {
		pitch: number
		rate: number
		volume: number | null
		style: string
		styleDegree: number
		sentencePause: number
		paragraphBreak: number
		emphasis: string
		pronunciations: PronunciationEntry[]
		audioFormat: string
	}
	favorites: FavoritesConfig
	presets: VoicePreset[]
}

export const DEFAULT_SPEECH_SETTINGS: SpeechSettings = {
	enabled: false,
	autoSpeak: false,
	volume: 80,
	interactionMode: "assist",
	interruptOnType: true,
	debugMode: false,
	sentimentIntensity: 70,
	multiVoiceMode: false,
	azure: {
		apiKey: "",
		region: "westus",
		voiceId: "en-GB-MaisieNeural",
	},
	tuning: {
		pitch: 0,
		rate: 1.0,
		volume: null,
		style: "default",
		styleDegree: 1.0,
		sentencePause: 250,
		paragraphBreak: 500,
		emphasis: "moderate",
		pronunciations: [],
		audioFormat: "audio-24khz-48kbitrate-mono-mp3",
	},
	favorites: {
		starredVoices: ["en-GB-MaisieNeural"],
		presets: [],
		order: ["en-GB-MaisieNeural"],
	},
	presets: [],
}
