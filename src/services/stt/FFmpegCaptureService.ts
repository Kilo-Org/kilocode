// kilocode_change - new file: FFmpeg-based PCM16 audio capture for OpenAI Realtime API
import { EventEmitter } from "events"
import { spawn, ChildProcess } from "child_process"
import * as os from "os"
import { findFFmpeg } from "./FFmpegDeviceEnumerator"

/**
 * Calculate RMS energy of PCM16 audio frame
 * Returns normalized energy level (0-1 scale)
 *
 * @param pcm16 - Int16Array of PCM16 samples
 * @returns Energy level from 0 (silence) to 1 (max volume)
 */
function calculateFrameEnergy(pcm16: Int16Array): number {
	// Guard against empty buffer to prevent division by zero
	if (pcm16.length === 0) {
		return 0
	}

	let sum = 0
	for (let i = 0; i < pcm16.length; i++) {
		const normalized = pcm16[i] / 32768 // Normalize to -1 to 1
		sum += normalized * normalized // Square for RMS
	}
	const rms = Math.sqrt(sum / pcm16.length)
	return Math.min(rms, 1.0) // Cap at 1.0
}

/**
 * FFmpegCaptureService - Captures audio in PCM16 format using FFmpeg for streaming to OpenAI Realtime API
 *
 * Key features:
 * - Outputs PCM16 to stdout (not WebM files)
 * - Sample rate: 24kHz (required by Realtime API)
 * - Continuous streaming (not segmented chunks)
 * - Event-driven Buffer emission for WebSocket transmission
 *
 * Architecture:
 * Microphone → FFmpeg (PCM16) → stdout → Buffer events → WebSocket client
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class FFmpegCaptureService extends EventEmitter {
	private ffmpegProcess: ChildProcess | null = null
	private isCapturing: boolean = false
	private platform: string
	private captureStartTime: number = 0
	private audioChunkCount: number = 0
	private deviceId: string | undefined

	constructor(deviceId?: string) {
		super()
		this.platform = os.platform()
		this.deviceId = deviceId

		// Resolve FFmpeg path once (cached globally)
		const result = findFFmpeg()

		if (!result.available) {
			console.error("❌ [FFmpegCapture] FFmpeg not found during initialization")
			console.error("→ Install: https://ffmpeg.org/download.html")
		} else {
			console.log(`✅ [FFmpegCapture] FFmpeg resolved to: ${result.path}`)
		}
	}

	/**
	 * Start capturing audio in PCM16 format
	 * Emits 'audioData' events with Buffer chunks ready for WebSocket transmission
	 */
	async start(): Promise<void> {
		if (this.isCapturing) {
			throw new Error("Audio capture already in progress")
		}

		// Get FFmpeg path from global cache
		const result = findFFmpeg()
		if (!result.available || !result.path) {
			throw new Error(
				"FFmpeg not found. Please install FFmpeg to use speech-to-text.\n" +
					"Installation: https://ffmpeg.org/download.html",
			)
		}

		try {
			const args = this.buildFFmpegArgs()

			console.log("🔍 [FFmpegCapture] Spawning FFmpeg...")
			console.log("🔍 [FFmpegCapture] Path:", result.path)
			console.log("🔍 [FFmpegCapture] Args:", JSON.stringify(args))

			// Use absolute path from cache (not "ffmpeg")
			this.ffmpegProcess = spawn(result.path, args, {
				stdio: ["ignore", "pipe", "pipe"],
			})

			console.log("✅ [FFmpegCapture] Process spawned, PID:", this.ffmpegProcess.pid)

			this.isCapturing = true
			this.captureStartTime = Date.now()
			this.audioChunkCount = 0

			// Stream PCM16 data from stdout
			this.ffmpegProcess.stdout?.on("data", (buffer: Buffer) => {
				if (this.isCapturing) {
					this.audioChunkCount++

					// Calculate energy from PCM16 buffer
					const int16Array = new Int16Array(
						buffer.buffer,
						buffer.byteOffset,
						buffer.byteLength / Int16Array.BYTES_PER_ELEMENT,
					)
					const energy = calculateFrameEnergy(int16Array)
					// console.log(`🎙️ [FFmpegCapture] Energy: ${energy.toFixed(3)}`)

					// Emit both events
					this.emit("audioData", buffer)
					this.emit("audioEnergy", energy)
				}
			})

			this.ffmpegProcess.stderr?.on("data", (data: Buffer) => {
				const message = data.toString()
				// Log FFmpeg output for debugging (not emitted as errors unless critical)
				if (message.includes("Error") || message.includes("Cannot")) {
					console.error("[RealtimeAudioCapture] FFmpeg error:", message)
					this.emit("error", new Error(`FFmpeg error: ${message}`))
				}
			})

			this.ffmpegProcess.on("error", (error: Error) => {
				console.error("❌ [RealtimeAudioCapture] Process error:", error)
				console.error("❌ [RealtimeAudioCapture] Error details:", {
					errno: (error as any).errno,
					code: (error as any).code,
					syscall: (error as any).syscall,
					path: (error as any).path,
					spawnargs: (error as any).spawnargs,
				})
				console.error("❌ [RealtimeAudioCapture] Current PATH:", process.env.PATH)
				console.error("❌ [RealtimeAudioCapture] Which platform:", this.platform)
				this.emit("error", error)
				this.cleanup()
			})

			this.ffmpegProcess.on("exit", (code: number | null, signal: string | null) => {
				if (code !== null && code !== 0 && this.isCapturing) {
					const error = new Error(`FFmpeg exited with code ${code}${signal ? ` (signal: ${signal})` : ""}`)
					console.error("[RealtimeAudioCapture] Process exit:", error)
					this.emit("error", error)
				}
				this.cleanup()
			})

			this.emit("ready")
		} catch (error) {
			this.cleanup()
			throw error
		}
	}

	async stop(): Promise<void> {
		if (!this.isCapturing) {
			return
		}

		this.isCapturing = false

		if (this.ffmpegProcess) {
			return new Promise<void>((resolve) => {
				if (!this.ffmpegProcess) {
					resolve()
					return
				}

				// Set up cleanup timeout
				const timeout = setTimeout(() => {
					if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
						this.ffmpegProcess.kill("SIGKILL")
					}
					this.cleanup()
					resolve()
				}, 2000)

				// Listen for process exit
				this.ffmpegProcess.once("exit", () => {
					clearTimeout(timeout)
					this.cleanup()
					resolve()
				})

				// Send SIGTERM for graceful shutdown
				this.ffmpegProcess.kill("SIGTERM")
			})
		}
	}

	getCaptureDuration(): number {
		if (!this.isCapturing) {
			return 0
		}
		return Date.now() - this.captureStartTime
	}

	isActive(): boolean {
		return this.isCapturing
	}

	private buildFFmpegArgs(): string[] {
		const baseArgs = this.getPlatformInputArgs()

		// PCM16 output configuration (required by OpenAI Realtime API)
		const outputArgs = [
			"-acodec",
			"pcm_s16le", // PCM16 format
			"-ar",
			"24000", // 24kHz sample rate (Realtime API requirement)
			"-ac",
			"1", // Mono
			"-f",
			"s16le", // Raw PCM16 format
			"-", // Output to stdout
		]

		return [...baseArgs, ...outputArgs]
	}

	private getPlatformInputArgs(): string[] {
		switch (this.platform) {
			case "darwin": // macOS
				// AVFoundation: device ID is already stored in format ":deviceId" (e.g., ":3")
				// or use ":default" if no device selected
				return ["-f", "avfoundation", "-i", this.deviceId || ":default"]

			case "linux":
				// PulseAudio: device ID is stored as just the number (e.g., "0")
				return ["-f", "pulse", "-i", this.deviceId || "default"]

			case "win32": // Windows
				// DirectShow: device ID is stored as the device name, need to format as "audio=Device Name"
				return ["-f", "dshow", "-i", this.deviceId ? `audio=${this.deviceId}` : "audio=default"]

			default:
				throw new Error(`Unsupported platform: ${this.platform}`)
		}
	}

	private cleanup(): void {
		this.isCapturing = false

		if (this.ffmpegProcess) {
			// Remove all listeners to prevent memory leaks
			this.ffmpegProcess.stdout?.removeAllListeners()
			this.ffmpegProcess.stderr?.removeAllListeners()
			this.ffmpegProcess.removeAllListeners()

			// Ensure process is terminated
			if (!this.ffmpegProcess.killed) {
				this.ffmpegProcess.kill("SIGKILL")
			}

			this.ffmpegProcess = null
		}

		this.emit("stopped")
	}
}

/**
 * Event interface for FFmpegCaptureService
 */
export interface FFmpegCaptureServiceEvents {
	ready: () => void
	audioData: (buffer: Buffer) => void
	audioEnergy: (energy: number) => void
	error: (error: Error) => void
	stopped: () => void
}

// Type-safe event emitter interface
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface FFmpegCaptureService {
	on<K extends keyof FFmpegCaptureServiceEvents>(event: K, listener: FFmpegCaptureServiceEvents[K]): this

	off<K extends keyof FFmpegCaptureServiceEvents>(event: K, listener: FFmpegCaptureServiceEvents[K]): this

	emit<K extends keyof FFmpegCaptureServiceEvents>(
		event: K,
		...args: Parameters<FFmpegCaptureServiceEvents[K]>
	): boolean
}
