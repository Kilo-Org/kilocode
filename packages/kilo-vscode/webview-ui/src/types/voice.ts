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
  provider: string
  azure: {
    apiKey: string
    region: string
    voiceId: string
  }
  google?: { apiKey: string }
  openai?: { apiKey: string }
  elevenlabs?: { apiKey: string }
  polly?: { accessKeyId: string; secretAccessKey: string; region: string }
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
  enabled: true,
  autoSpeak: true,
  volume: 80,
  interactionMode: "assist",
  interruptOnType: true,
  debugMode: false,
  sentimentIntensity: 70,
  multiVoiceMode: false,
  provider: "browser",
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

export interface SpeechVoice {
  id: string
  name: string
  locale: string
  gender: "Female" | "Male" | "Unknown"
  description: string
  provider: string
  styles?: string[]
}

export interface SynthesisOptions {
  voiceId: string
  pitch?: number
  rate?: number
  volume?: number
  style?: string
  styleDegree?: number
  emphasis?: string
  pronunciations?: PronunciationEntry[]
  audioFormat?: string
  apiKey?: string
  region?: string
}

export interface SpeechProvider {
  id: string
  name: string
  tier: "free" | "freeTier"
  requiresApiKey: boolean
  description: string
  freeAllowance: string
  capabilities: {
    ssml: boolean
    styles: boolean
    emphasis: boolean
    pronunciations: boolean
    audioFormats: string[]
  }
  getVoices(): SpeechVoice[]
  synthesize(text: string, opts: SynthesisOptions): Promise<Blob | void>
  stop(): void
  testConnection?(apiKey: string, region?: string): Promise<boolean>
}
