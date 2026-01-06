// kilocode_change - new file: Consolidated STT service - manages OpenAI Realtime transcription lifecycle
import { STTProviderConfig, STTEventEmitter, VisibleCodeGlossary, VADConfig, DEFAULT_VAD_CONFIG } from "./types"
import { STTSegment } from "../../shared/sttContract"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"
import { FFmpegCaptureService } from "./FFmpegCaptureService"
import { OpenAIWhisperClient } from "./OpenAIWhisperClient"

/**
 * Consolidated STT service - manages OpenAI Realtime transcription
 * One instance per ClineProvider (WebView)
 *
 * Coordinates FFmpegCaptureService and OpenAIWhisperClient to provide
 * low-latency streaming transcription via OpenAI Realtime API.
 *
 * Flow:
 * 1. All audio frames are streamed immediately to OpenAI (they buffer)
 * 2. We track voice activity locally via energy detection
 * 3. We only commit when we have enough voiced frames AND detect a pause
 * 4. OpenAI returns transcription events when we commit
 */
export class STTService {
	private readonly emitter: STTEventEmitter
	private readonly providerSettingsManager: ProviderSettingsManager

	// Services
	private audioCapture: FFmpegCaptureService
	private transcriptionClient: OpenAIWhisperClient | null = null

	// Segment-based state
	private textSegments: STTSegment[] = [] // All confirmed/polished segments
	private currentPreviewText: string = "" // Current streaming preview text

	// Session state
	private sessionId: string | null = null
	private isActive = false

	// Helps ignore late events from previous runs
	private internalSessionId = 0

	// VAD configuration and state
	private vadConfig: VADConfig = DEFAULT_VAD_CONFIG
	private totalFrameCount: number = 0 // Frames sent since last commit
	private voicedFrameCount: number = 0 // Frames with voice activity since last commit
	private lastVoicedAtMs: number = 0

	private readonly codeGlossary: VisibleCodeGlossary | null

	constructor(
		emitter: STTEventEmitter,
		providerSettingsManager: ProviderSettingsManager,
		codeGlossary: VisibleCodeGlossary | null = null,
	) {
		this.emitter = emitter
		this.providerSettingsManager = providerSettingsManager
		this.codeGlossary = codeGlossary
		this.audioCapture = new FFmpegCaptureService()
	}

	async start(config: STTProviderConfig, language?: string): Promise<void> {
		this.cancel()

		this.sessionId = `stt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
		if (config.vadConfig) {
			this.vadConfig = { ...DEFAULT_VAD_CONFIG, ...config.vadConfig }
		}

		// New session
		this.internalSessionId++
		this.isActive = true // Set BEFORE audio starts to avoid dropping first frames
		this.textSegments = []
		this.currentPreviewText = ""

		// Reset VAD state
		this.totalFrameCount = 0
		this.voicedFrameCount = 0
		this.lastVoicedAtMs = 0

		// The prompt is making it hallucinate more so remove it for now
		// const prompt = await this.codeGlossary?.getGlossary()
		try {
			this.transcriptionClient = new OpenAIWhisperClient(this.providerSettingsManager, {
				apiKey: config.apiKey || "",
				language: language || config.language || "en",
				// prompt,
			})

			this.setupEventHandlers()

			await this.audioCapture.start()
			await this.transcriptionClient?.connect()

			this.emitter.onStarted(this.sessionId)
		} catch (error) {
			console.log("🎙️ [STTService] ❌ Error during start:", {
				errorType: error instanceof Error ? error.constructor.name : typeof error,
				errorMessage: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			})

			this.isActive = false
			const errorMessage = error instanceof Error ? error.message : "Failed to start"
			this.emitter.onStopped("error", undefined, errorMessage)
			await this.cleanupOnError()
			this.sessionId = null
			throw error
		}
	}

	async stop(): Promise<string> {
		if (!this.isActive) {
			return this.getFullText()
		}

		this.isActive = false // Prevent new audio + late deltas
		const currentSession = this.internalSessionId

		try {
			await this.stopCapture()

			// Only commit if we have voiced data
			if (this.voicedFrameCount > 0 && this.transcriptionClient?.isConnected()) {
				this.commit()
			}

			// Wait for any pending transcriptions to arrive
			await new Promise((resolve) => setTimeout(resolve, 1000))

			// Convert any remaining preview to confirmed
			if (this.currentPreviewText.trim()) {
				this.textSegments.push({ text: this.currentPreviewText.trim(), isPreview: false })
				this.currentPreviewText = ""
			}

			const finalText = this.getFullText()
			await this.transcriptionClient?.disconnect()

			// Only reset if this is still the latest session
			if (this.internalSessionId === currentSession) {
				this.resetSession()
			}

			this.emitter.onStopped("completed", finalText)
			return finalText
		} catch (error) {
			console.error("🎙️ [STTService] Error during stop:", error)

			await this.disconnectClient()
			const finalText = this.getFullText()

			if (this.internalSessionId === currentSession) {
				this.resetSession()
			}

			const errorMessage = error instanceof Error ? error.message : "Failed to stop"
			this.emitter.onStopped("error", finalText, errorMessage)
			return finalText
		}
	}

	cancel(): void {
		if (!this.transcriptionClient) {
			return
		}

		try {
			this.isActive = false

			this.transcriptionClient.disconnect().catch(() => {}) // Ignore during cancel
			this.audioCapture.stop().catch(() => {}) // Ignore during cancel

			this.resetSession()
			this.emitter.onStopped("cancelled")
		} catch (_error) {}

		this.cleanup()
	}

	getSessionId(): string | null {
		return this.sessionId
	}

	isRecording(): boolean {
		return this.isActive
	}

	private setupEventHandlers(): void {
		this.connectAudioToClient()
		this.forwardTranscriptionEvents()
		this.handleErrors()
	}

	/**
	 * Connect audio capture to transcription client with local VAD logic
	 *
	 * Strategy:
	 * - Stream ALL audio to OpenAI immediately (they buffer until we commit)
	 * - Track voice activity locally via energy detection
	 * - Only commit when: enough voiced frames AND at a pause
	 * - Never commit empty/silent buffers to avoid hallucination
	 */
	private connectAudioToClient(): void {
		// Stream all audio immediately - OpenAI buffers until we commit
		this.audioCapture.on("audioData", (pcm16Buffer: Buffer) => {
			if (!this.isActive) return

			// Always stream to OpenAI (they buffer until we commit)
			this.transcriptionClient?.sendAudioChunk(pcm16Buffer)
			this.totalFrameCount++

			// Check if we should commit based on voice activity
			if (this.shouldCommit()) {
				this.commit()
			}
		})

		// Track voice activity separately via energy detection
		this.audioCapture.on("audioEnergy", (energy: number) => {
			if (!this.isActive) return

			if (energy > this.vadConfig.energyThreshold) {
				this.lastVoicedAtMs = Date.now()
				this.voicedFrameCount++
			}
			this.emitter.onVolume(energy)
		})
	}

	/**
	 * Check if conditions met for committing current audio chunk
	 * Requirements:
	 * 1. Minimum total duration (prevents tiny fragments)
	 * 2. Minimum voiced duration (ensures meaningful speech content)
	 * 3. Natural pause detected (between-word silence)
	 */
	private shouldCommit(): boolean {
		if (this.voicedFrameCount === 0) {
			return false
		}

		const now = Date.now()
		const silenceSinceMs = now - this.lastVoicedAtMs
		const bufferedMs = this.totalFrameCount * this.vadConfig.frameDurationMs
		const voicedMs = this.voicedFrameCount * this.vadConfig.frameDurationMs

		// Requirements (absolute time only - no percentage)
		const hasMinDuration = bufferedMs >= this.vadConfig.minChunkMs // 1000ms total
		const hasMinVoice = voicedMs >= 500 // 500ms of actual speech
		const atPause = silenceSinceMs >= this.vadConfig.shortPauseMs // 150ms between-word pause

		// Debug logging
		if (bufferedMs >= 2000 && bufferedMs % 1000 < 20) {
			console.log(
				`🎙️ [STTService] 🔍 Check: buffered=${bufferedMs}ms, voiced=${voicedMs}ms, silence=${silenceSinceMs}ms | min=${hasMinDuration}, voice=${hasMinVoice}, pause=${atPause}`,
			)
		}

		// Safety cap: force commit if too long
		const atSafetyCap = bufferedMs >= this.vadConfig.maxChunkMs && atPause

		// Commit when all requirements met
		if (hasMinDuration && hasMinVoice && atPause) {
			console.log(
				`🎙️ [STTService] ✓ Commit: pause detected (${silenceSinceMs}ms silence, ${bufferedMs}ms total, ${voicedMs}ms voiced)`,
			)
			return true
		}

		// Safety cap
		if (atSafetyCap && hasMinVoice) {
			console.log(`🎙️ [STTService] ✓ Commit: safety cap (${bufferedMs}ms total, ${voicedMs}ms voiced)`)
			return true
		}

		return false
	}

	/**
	 * Commit buffered audio to OpenAI for transcription
	 * Only called when we have voiced data
	 */
	private commit(): void {
		if (this.voicedFrameCount === 0) {
			return
		}

		const bufferedMs = this.totalFrameCount * this.vadConfig.frameDurationMs
		const voicedMs = this.voicedFrameCount * this.vadConfig.frameDurationMs

		this.transcriptionClient?.sendInputBufferCommit()

		// Reset counters for next segment
		this.totalFrameCount = 0
		this.voicedFrameCount = 0
	}

	private forwardTranscriptionEvents(): void {
		if (!this.transcriptionClient) return

		// Delta events: incremental word-by-word streaming (gpt-4o-mini-transcribe)
		// Each delta adds new text to build up the current preview
		this.transcriptionClient.on("transcriptionDelta", (delta: string) => {
			if (!this.isActive) return

			const trimmedDelta = delta.trim()
			this.currentPreviewText = (this.currentPreviewText + " " + trimmedDelta).trim()
			this.emitCurrentState()
		})

		// Completed event: OpenAI sends polished/corrected text after commit
		this.transcriptionClient.on("transcription", (text: string) => {
			if (!this.isActive) return

			const trimmed = text.trim()
			if (!trimmed) return

			// Convert preview to confirmed segment
			this.textSegments.push({ text: trimmed, isPreview: false })
			this.currentPreviewText = ""

			// Emit updated state
			this.emitCurrentState()
		})
	}

	/**
	 * Build and emit current transcript state
	 * Sends complete segments array to WebView
	 */
	private emitCurrentState(): void {
		const allSegments: STTSegment[] = [...this.textSegments]

		// Add current preview if any
		if (this.currentPreviewText.trim()) {
			allSegments.push({ text: this.currentPreviewText.trim(), isPreview: true })
		}

		this.emitter.onTranscript(allSegments, false)
	}

	private handleErrors(): void {
		this.audioCapture.on("error", (error: Error) => {
			console.error("🎙️ [STTService] Audio capture error:", error)
			this.handleRecoverableError(error)
		})

		if (this.transcriptionClient) {
			this.transcriptionClient.on("error", (error: Error) => {
				console.error("🎙️ [STTService] Transcription API error:", error)
				this.handleRecoverableError(error)
			})
		}
	}

	/**
	 * Handle recoverable errors by emitting to UI and cleaning up
	 */
	private async handleRecoverableError(error: Error): Promise<void> {
		console.warn("🎙️ [STTService] ⚠️ handleRecoverableError called:", {
			errorMessage: error.message,
			isActive: this.isActive,
			sessionId: this.sessionId,
		})

		// Immediately stop processing to prevent any new audio/data from being processed
		this.isActive = false

		// Send error to frontend immediately
		console.warn("🎙️ [STTService] 📤 Calling emitter.onStopped with error:", {
			reason: "error",
			text: undefined,
			errorMessage: error.message,
		})
		this.emitter.onStopped("error", undefined, error.message)

		// Cleanup resources asynchronously
		try {
			await this.cleanupOnError()
		} catch (cleanupError) {
			console.error("🎙️ [STTService] Failed to cleanup after error:", cleanupError)
		}
	}

	/**
	 * Get full text for onComplete callback
	 * Joins all confirmed segment texts
	 */
	private getFullText(): string {
		return this.textSegments
			.map((s) => s.text)
			.join("")
			.trim()
	}

	private async stopCapture(): Promise<void> {
		try {
			await this.audioCapture.stop()
		} catch (error) {
			console.error("🎙️ [STTService] Error stopping audio capture:", error)
		}
	}

	private async disconnectClient(): Promise<void> {
		try {
			await this.transcriptionClient?.disconnect()
		} catch (error) {
			console.error("🎙️ [STTService] Error disconnecting client:", error)
		}
	}

	private resetSession(): void {
		this.textSegments = []
		this.currentPreviewText = ""
	}

	private async cleanupOnError(): Promise<void> {
		this.isActive = false

		await Promise.allSettled(
			[this.audioCapture?.stop().catch(() => {}), this.transcriptionClient?.disconnect().catch(() => {})].filter(
				Boolean,
			),
		)

		this.resetSession()
	}

	private cleanup(): void {
		this.transcriptionClient = null
		this.sessionId = null
	}
}
