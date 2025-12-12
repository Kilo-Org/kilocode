// kilocode_change - new file: STT service type definitions
import { STTSegment } from "../../shared/sttContract"

/**
 * Interface for providing code glossary context to STT service
 * Implementations capture visible code and format it as a prompt
 */
export interface VisibleCodeGlossary {
	getGlossary(): Promise<string>
}

/**
 * Voice Activity Detection (VAD) configuration
 *
 * Configuration guide:
 * - energyThreshold (0.02 default): Voice detection sensitivity
 *   - Lower = more sensitive (may pick up background noise)
 *   - Higher = less sensitive (may miss quiet speech)
 *   - Typical range: 0.01 - 0.03
 *
 * - shortPauseMs (300ms default): Natural pause detection for commits
 *   - Detects brief pauses between phrases/breaths
 *   - Too low: commits too frequently, may split words
 *   - Too high: delays transcription
 *   - Typical range: 200-500ms
 *
 * - minChunkMs (1000ms default): Minimum audio before allowing commit
 *   - Prevents tiny fragments from being committed
 *   - Typical range: 500-1500ms
 *
 * - maxChunkMs (10000ms default): Safety cap for continuous speech
 *   - Forces commit during pauses if buffer grows too large
 *   - Typical range: 8000-15000ms
 *
 * - minVoicedRatio (0.3 default): Minimum voice content required
 *   - Prevents committing silent/empty buffers (causes hallucination)
 *   - Typical range: 0.2-0.5
 */
export interface VADConfig {
	/** Energy threshold for voiced frames (0-1 scale) */
	energyThreshold: number

	/** Minimum chunk duration in ms before allowing commit */
	minChunkMs: number

	/** Short pause duration in ms (word gap detection) */
	shortPauseMs: number

	/** Maximum chunk duration in ms (safety cap for continuous speech) */
	maxChunkMs: number

	/** Frame duration in ms (depends on FFmpeg buffer size) */
	frameDurationMs: number

	/** Minimum ratio of voiced frames required to commit (0-1 scale) */
	minVoicedRatio: number
}

/**
 * Default VAD configuration
 * Conservative settings to avoid committing empty/silent buffers
 */
export const DEFAULT_VAD_CONFIG: VADConfig = {
	energyThreshold: 0.02, // Voice detection threshold
	minChunkMs: 1000, // Minimum 1 second of audio before allowing commit
	shortPauseMs: 150, // 150ms pause for commits (catches natural between-word pauses)
	maxChunkMs: 10000, // Safety cap at 10 seconds
	frameDurationMs: 20, // Typical for 24kHz audio
	minVoicedRatio: 0.3, // Require 30% voice activity before committing
}

/**
 * Configuration passed to STT provider
 */
export interface STTProviderConfig {
	apiKey?: string
	language?: string
	prompt?: string // Code glossary/context for better accuracy
	vadConfig?: Partial<VADConfig> // Override VAD configuration
}

/**
 * Callbacks providers use to emit events
 * This is the bridge between provider internals and the WebView event system
 */
export interface STTEventEmitter {
	onStarted: (sessionId: string) => void
	onTranscript: (segments: STTSegment[], isFinal: boolean) => void
	onVolume: (level: number) => void
	onStopped: (reason: "completed" | "cancelled" | "error", text?: string, error?: string) => void
}

/**
 * Internal state tracking for providers
 */
export interface STTSessionState {
	sessionId: string
	isRecording: boolean
	language?: string
}

/**
 * Progressive transcription result
 * Emitted during recording with real-time transcription updates
 */
export interface ProgressiveResult {
	chunkId: number
	text: string
	isInterim: boolean
	confidence: number
	totalDuration: number
	sequenceNumber: number
}

/**
 * Configuration for transcription service
 */
export interface TranscriptionServiceConfig {
	apiKey: string
	language?: string
	prompt?: string // Optional context prompt for code identifiers
}
