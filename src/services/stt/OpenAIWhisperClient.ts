import { EventEmitter } from "events"
import WebSocket from "ws"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"
import { getOpenAiApiKey, getOpenAiBaseUrl } from "./utils/getOpenAiCredentials"

/**
 * Configuration for OpenAI Whisper transcription via Realtime API
 */
export interface OpenAIWhisperConfig {
	apiKey?: string
	baseURL?: string
	language?: string
	prompt?: string
	maxReconnectAttempts?: number
	reconnectDelayMs?: number
}

/**
 * OpenAI Realtime API session event types
 */
interface RealtimeSessionUpdateEvent {
	type: "session.update"
	session: {
		turn_detection: null | {
			type: "server_vad"
			threshold: number
			silence_duration_ms: number
		}
		input_audio_format: "pcm16"
		input_audio_transcription: {
			model: string
			language?: string
			prompt?: string
		}
	}
}

interface RealtimeAudioAppendEvent {
	type: "input_audio_buffer.append"
	audio: string
}

interface RealtimeAudioTranscriptDeltaEvent {
	type: "response.audio_transcript.delta"
	delta: string
	response_id: string
	item_id: string
	output_index: number
	content_index: number
}

interface RealtimeTranscriptionDeltaEvent {
	type: "conversation.item.input_audio_transcription.delta"
	delta: string
	item_id: string
}

interface RealtimeTranscriptionCompletedEvent {
	type: "conversation.item.input_audio_transcription.completed"
	transcript: string
	item_id: string
}

interface RealtimeTranscriptionFailedEvent {
	type: "conversation.item.input_audio_transcription.failed"
	error: {
		type: string
		code?: string
		message: string
	}
}

interface RealtimeErrorEvent {
	type: "error"
	error: {
		type: string
		code?: string
		message: string
	}
}

type RealtimeServerEvent =
	| RealtimeAudioTranscriptDeltaEvent
	| RealtimeTranscriptionDeltaEvent
	| RealtimeTranscriptionCompletedEvent
	| RealtimeTranscriptionFailedEvent
	| RealtimeErrorEvent
	| { type: string; [key: string]: unknown }

/**
 * WebSocket client for OpenAI Whisper transcription via Realtime API
 * Handles connection, session configuration, and real-time audio streaming for transcription-only use
 *
 * Events:
 * - 'transcriptionDelta': Emitted for live partial transcription updates (text: string)
 * - 'transcription': Emitted when a transcription segment is completed (text: string)
 * - 'speechStopped': Emitted when VAD detects end of speech (no data)
 * - 'error': Emitted when an error occurs (error: Error)
 * - 'connected': Emitted when WebSocket connection is established
 * - 'disconnected': Emitted when WebSocket connection is closed
 * - 'reconnecting': Emitted when attempting to reconnect (attempt: number)
 */
export class OpenAIWhisperClient extends EventEmitter {
	private ws: WebSocket | null = null
	private config: Required<OpenAIWhisperConfig>
	private providerSettingsManager: ProviderSettingsManager
	private reconnectAttempts = 0
	private reconnectTimeout: NodeJS.Timeout | null = null
	private isConnecting = false
	private isClosing = false
	private sessionConfigured = false
	private pendingAudioChunks: string[] = []
	private audioChunksSent: number = 0
	private currentPrompt: string = ""

	// Default configuration values
	// Server VAD is DISABLED - we use local VAD for better control over chunking
	private static readonly DEFAULT_CONFIG: Required<Omit<OpenAIWhisperConfig, "apiKey" | "baseURL" | "prompt">> = {
		language: "en",
		maxReconnectAttempts: 3,
		reconnectDelayMs: 2000,
	}

	constructor(providerSettingsManager: ProviderSettingsManager, config?: OpenAIWhisperConfig) {
		super()
		this.providerSettingsManager = providerSettingsManager
		this.config = {
			...OpenAIWhisperClient.DEFAULT_CONFIG,
			apiKey: config?.apiKey || "",
			baseURL: config?.baseURL || "wss://api.openai.com/v1/realtime",
			prompt: "",
			...config,
		}
		// Initialize current prompt from config
		this.currentPrompt = this.config.prompt || ""
	}

	/**
	 * Connect to OpenAI Realtime API WebSocket
	 * Automatically configures session for transcription-only mode
	 */
	async connect(): Promise<void> {
		if (this.isConnecting) {
			throw new Error("Connection already in progress")
		}

		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			return
		}

		this.isConnecting = true
		this.isClosing = false

		try {
			// Get API key if not provided in config
			if (!this.config.apiKey) {
				const apiKey = await getOpenAiApiKey(this.providerSettingsManager)
				if (!apiKey) {
					throw new Error(
						"OpenAI API key not configured. Please add an OpenAI or OpenAI-native provider in your settings.",
					)
				}
				this.config.apiKey = apiKey
			}

			// Get base URL if not provided in config
			if (this.config.baseURL === "wss://api.openai.com/v1/realtime") {
				const baseUrl = await getOpenAiBaseUrl(this.providerSettingsManager)
				if (baseUrl && baseUrl !== "https://api.openai.com/v1") {
					// Convert HTTP(S) base URL to WebSocket URL
					// Remove trailing /v1 if present to avoid duplication
					const cleanBaseUrl = baseUrl.replace(/\/v1\/?$/, "")
					const wsBaseUrl = cleanBaseUrl.replace(/^https?:/, "wss:")
					this.config.baseURL = `${wsBaseUrl}/v1/realtime`
				}
			}

			// Construct WebSocket URL with model parameter
			// Note: Use the model name without date suffix
			const wsUrl = `${this.config.baseURL}?model=gpt-4o-realtime-preview`

			// Create WebSocket connection
			this.ws = new WebSocket(wsUrl, {
				headers: {
					Authorization: `Bearer ${this.config.apiKey}`,
					"OpenAI-Beta": "realtime=v1",
				},
			})

			this.setupWebSocketHandlers()

			// Wait for connection to open
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error("WebSocket connection timeout"))
				}, 10000)

				const onOpen = () => {
					clearTimeout(timeout)
					this.ws!.off("open", onOpen)
					this.ws!.off("error", onError)
					resolve()
				}

				const onError = (error: Error) => {
					clearTimeout(timeout)
					this.ws!.off("open", onOpen)
					this.ws!.off("error", onError)
					reject(new Error(`WebSocket connection failed: ${error.message}`))
				}

				this.ws!.once("open", onOpen)
				this.ws!.once("error", onError)
			})

			this.isConnecting = false
			this.reconnectAttempts = 0
			this.emit("connected")
		} catch (error) {
			this.isConnecting = false
			this.ws = null
			throw error
		}
	}

	/**
	 * Setup WebSocket event handlers
	 */
	private setupWebSocketHandlers(): void {
		if (!this.ws) return

		this.ws.on("open", () => {
			this.configureSession()
		})

		this.ws.on("message", (data: Buffer | string) => {
			this.handleServerMessage(data)
		})

		this.ws.on("error", (error: Error) => {
			this.emit("error", new Error(`WebSocket error: ${error.message}`))
		})

		this.ws.on("close", (code: number, reason: Buffer) => {
			this.sessionConfigured = false
			this.pendingAudioChunks = []
			this.emit("disconnected", { code, reason: reason.toString() })

			// Attempt reconnection if not intentionally closed
			if (!this.isClosing && this.reconnectAttempts < this.config.maxReconnectAttempts) {
				this.scheduleReconnect()
			}
		})
	}

	/**
	 * Configure session for transcription-only mode (no TTS)
	 *
	 * Server VAD is DISABLED - we use local VAD for better control over chunking.
	 * This prevents the server from automatically segmenting audio and allows us
	 * to commit audio at natural word boundaries detected by our local VAD.
	 */
	private configureSession(): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

		const sessionUpdate: RealtimeSessionUpdateEvent = {
			type: "session.update",
			session: {
				// DISABLE server_vad - we do our own local VAD
				turn_detection: null,
				input_audio_format: "pcm16",
				input_audio_transcription: {
					model: "gpt-4o-mini-transcribe",
					language: this.config.language,
					// Pass prompt for code glossary - hallucination prevented by not sending silent audio
					prompt: this.currentPrompt,
				},
			},
		}

		console.log("🎙️ [OpenAIWhisperClient] Session configured with server_vad DISABLED (local VAD enabled)")
		this.ws.send(JSON.stringify(sessionUpdate))
		this.sessionConfigured = true

		// Send any pending audio chunks
		this.flushPendingAudioChunks()
	}

	/**
	 * Update the transcription prompt dynamically during an active session
	 */
	updateTranscriptionPrompt(prompt: string): void {
		// If unchanged, skip update (optimization)
		if (prompt === this.currentPrompt) {
			return
		}
		this.currentPrompt = prompt

		if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.sessionConfigured) {
			return
		}

		// Send session update with ALL required fields (OpenAI requires model)
		const promptUpdate = {
			type: "session.update",
			session: {
				input_audio_transcription: {
					model: "gpt-4o-mini-transcribe",
					language: this.config.language,
					prompt: this.currentPrompt,
				},
			},
		}

		console.log(`🎙️ [OpenAIWhisperClient] Updating transcription prompt dynamically (${prompt.length} chars)`)
		this.ws.send(JSON.stringify(promptUpdate))
	}

	/**
	 * Handle incoming server messages
	 */
	private handleServerMessage(data: string | Buffer): void {
		try {
			const messageText = typeof data === "string" ? data : data.toString()
			const message = JSON.parse(messageText) as RealtimeServerEvent

			switch (message.type) {
				case "conversation.item.input_audio_transcription.delta":
					// Live word-by-word transcription updates
					if ("delta" in message && message.delta) {
						const deltaText = String(message.delta)
						console.log(`🎙️ [OpenAIWhisperClient] Delta text: "${deltaText}"`)
						this.emit("transcriptionDelta", deltaText)
					}
					break

				case "conversation.item.input_audio_transcription.completed":
					// Segment completed - this has better combined text
					if ("transcript" in message && message.transcript) {
						const transcriptText = String(message.transcript)
						console.log(`🎙️ [OpenAIWhisperClient] ✅ Completed text: "${transcriptText}"`)
						this.emit("transcription", transcriptText)
					}
					break

				case "conversation.item.input_audio_transcription.failed": {
					const errorMsg =
						typeof message.error === "object" && message.error !== null && "message" in message.error
							? String(message.error.message)
							: "Unknown error"
					console.error("🎙️ [OpenAIWhisperClient] Transcription failed:", errorMsg)
					this.emit("error", new Error(`Transcription failed: ${errorMsg}`))
					break
				}

				// Server VAD events are disabled - we use local VAD instead
				// case "input_audio_buffer.speech_started":
				// case "input_audio_buffer.speech_stopped":

				case "error": {
					const errorMsg =
						typeof message.error === "object" && message.error !== null && "message" in message.error
							? String(message.error.message)
							: "Unknown error"

					// Ignore "buffer too small" errors - these are expected when we try to commit
					// but there isn't enough audio yet. Not a real problem.
					if (errorMsg.includes("buffer too small") || errorMsg.includes("buffer only has 0.00ms")) {
						break
					}

					console.error("🎙️ [OpenAIWhisperClient] API error:", errorMsg)
					this.emit("error", new Error(`Realtime API error: ${errorMsg}`))
					break
				}

				// Silently ignore other event types (session.created, session.updated, etc.)
				default:
					break
			}
		} catch (error) {
			console.error("🎙️ [OpenAIWhisperClient] Failed to parse server message:", error)
			this.emit("error", new Error(`Failed to parse server message: ${error}`))
		}
	}

	/**
	 * Send manual commit to force transcription of buffered audio
	 * This allows getting transcription updates even while user is still speaking,
	 * without waiting for VAD silence detection.
	 *
	 * Use case: Call periodically (e.g., every 1-2 seconds) to get interim results
	 * during long continuous speech.
	 */
	sendInputBufferCommit(): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.sessionConfigured) {
			return
		}
		try {
			const commitEvent = { type: "input_audio_buffer.commit", event_id: `commit_${Date.now()}` }
			this.ws.send(JSON.stringify(commitEvent))
		} catch (error) {
			console.error("🎙️ [OpenAIWhisperClient] Failed to send commit:", error)
			this.emit("error", new Error(`Failed to send commit: ${error}`))
		}
	}

	/**
	 * Send PCM16 audio chunk to the API
	 * @param pcm16Buffer Raw PCM16 audio data (16-bit, 24kHz, mono)
	 */
	sendAudioChunk(pcm16Buffer: Buffer): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			return
		}

		const base64Audio = pcm16Buffer.toString("base64")
		if (!this.sessionConfigured) {
			// Queue audio chunk if session not configured yet
			this.pendingAudioChunks.push(base64Audio)
			return
		}

		try {
			this.ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: base64Audio }))
			this.audioChunksSent++
		} catch (error) {
			console.error("🎙️ [OpenAIWhisperClient] Failed to send audio chunk:", error)
			this.emit("error", new Error(`Failed to send audio chunk: ${error}`))
		}
	}

	/**
	 * Flush pending audio chunks after session configuration
	 */
	private flushPendingAudioChunks(): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.sessionConfigured) {
			return
		}

		for (const base64Audio of this.pendingAudioChunks) {
			const audioEvent: RealtimeAudioAppendEvent = {
				type: "input_audio_buffer.append",
				audio: base64Audio,
			}

			try {
				this.ws.send(JSON.stringify(audioEvent))
			} catch (error) {
				this.emit("error", new Error(`Failed to send pending audio chunk: ${error}`))
			}
		}

		this.pendingAudioChunks = []
	}

	/**
	 * Schedule reconnection attempt
	 */
	private scheduleReconnect(): void {
		if (this.reconnectTimeout) {
			return
		}

		this.reconnectAttempts++
		this.emit("reconnecting", this.reconnectAttempts)

		this.reconnectTimeout = setTimeout(async () => {
			this.reconnectTimeout = null

			try {
				await this.connect()
			} catch (error) {
				this.emit("error", new Error(`Reconnection attempt ${this.reconnectAttempts} failed: ${error}`))

				// Schedule next attempt if not exceeded max
				if (this.reconnectAttempts < this.config.maxReconnectAttempts) {
					this.scheduleReconnect()
				}
			}
		}, this.config.reconnectDelayMs)
	}

	/**
	 * Disconnect from the WebSocket
	 */
	async disconnect(): Promise<void> {
		this.isClosing = true

		// Clear reconnection timeout
		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout)
			this.reconnectTimeout = null
		}

		// Close WebSocket
		if (this.ws) {
			this.ws.close(1000, "Client disconnect")
			this.ws = null
		}

		this.sessionConfigured = false
		this.pendingAudioChunks = []
		this.reconnectAttempts = 0
	}

	/**
	 * Check if client is connected
	 */
	isConnected(): boolean {
		return this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.sessionConfigured
	}

	/**
	 * Get current connection state
	 */
	getConnectionState(): "connecting" | "connected" | "disconnected" | "reconnecting" {
		if (this.isConnecting) return "connecting"
		if (this.reconnectAttempts > 0) return "reconnecting"
		if (this.ws && this.ws.readyState === WebSocket.OPEN) return "connected"
		return "disconnected"
	}

	/**
	 * Get current configuration values
	 */
	getConfig(): Readonly<Required<OpenAIWhisperConfig>> {
		return { ...this.config }
	}
}
