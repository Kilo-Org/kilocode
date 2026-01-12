// kilocode_change - new file: FFmpeg device enumeration utilities
import { execSync } from "child_process"
import * as os from "os"
import { MicrophoneDevice } from "../../shared/sttContract"

/**
 * Global cache for FFmpeg path (shared across all instances)
 * undefined = not yet checked, null = not found, string = found path
 */
let cachedFFmpegPath: string | null | undefined = undefined

// Platform-specific fallback paths
const fallbackPaths: Record<string, string[]> = {
	darwin: ["/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg"],
	linux: ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/snap/bin/ffmpeg"],
	win32: [
		"C:\\ffmpeg\\bin\\ffmpeg.exe",
		"C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
		"C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe",
	],
}

/**
 * Find FFmpeg executable using platform-specific fallback paths
 * Results are cached globally across all instances
 */
export function findFFmpeg(forceRecheck = false): { available: boolean; path?: string; error?: string } {
	if (cachedFFmpegPath !== undefined && !forceRecheck) {
		return {
			available: cachedFFmpegPath !== null,
			path: cachedFFmpegPath || undefined,
			error: cachedFFmpegPath === null ? "FFmpeg not found" : undefined,
		}
	}

	const platform = os.platform()
	try {
		execSync("ffmpeg -version", { stdio: "ignore" })
		cachedFFmpegPath = "ffmpeg"
		return { available: true, path: "ffmpeg" }
	} catch {
		console.log(`🎙️ [FFmpeg] ❌ 'ffmpeg' not in PATH, trying fallback paths...`)
	}

	const platformPaths = fallbackPaths[platform] || []
	for (const fallbackPath of platformPaths) {
		try {
			execSync(`"${fallbackPath}" -version`, { stdio: "ignore" })
			cachedFFmpegPath = fallbackPath
			return { available: true, path: fallbackPath }
		} catch {
			continue
		}
	}

	// Cache the "not found" result to avoid repeated path checks
	cachedFFmpegPath = null
	return {
		available: false,
		error: "FFmpeg not found. Install from https://ffmpeg.org/download.html",
	}
}

/**
 * List available microphone devices using FFmpeg
 * Platform-independent method that returns normalized device information
 */
export async function listMicrophoneDevices(): Promise<MicrophoneDevice[]> {
	const platform = os.platform()
	const result = findFFmpeg()

	if (!result.available || !result.path) {
		throw new Error("FFmpeg not found. Please install FFmpeg to list microphone devices.")
	}

	try {
		switch (platform) {
			case "darwin":
				return await listAvFoundationDevices(result.path)
			case "linux":
				return await listPulseDevices(result.path)
			case "win32":
				return await listDShowDevices(result.path)
			default:
				throw new Error(`Unsupported platform: ${platform}`)
		}
	} catch (error) {
		console.error("❌ [FFmpegCapture] Error listing devices:", error)
		throw error
	}
}

/**
 * List devices using macOS AVFoundation
 */
async function listAvFoundationDevices(ffmpegPath: string): Promise<MicrophoneDevice[]> {
	const devices: MicrophoneDevice[] = []
	try {
		// Use -list_devices to enumerate AVFoundation devices
		const output = execSync(`"${ffmpegPath}" -f avfoundation -list_devices true -i "" 2>&1 || true`, {
			encoding: "utf-8",
			maxBuffer: 10 * 1024 * 1024,
		})

		let inAudioSection = false
		const lines = output.split("\n")

		for (const line of lines) {
			if (line.includes("AVFoundation audio devices:")) {
				inAudioSection = true
				continue
			}
			if (line.includes("AVFoundation video devices:")) {
				inAudioSection = false
				continue
			}

			if (inAudioSection) {
				// Match pattern: [AVFoundation input device @ ...] [0] Device Name
				const match = line.match(/\[(\d+)\]\s+(.+)/)
				if (match) {
					// AVFoundation requires format ":deviceId" (e.g., ":3")
					const id = `:${match[1]}`
					const name = match[2].trim()
					devices.push({ id, name, platform: "darwin" })
				}
			}
		}
	} catch (error) {
		console.error("❌ [FFmpegCapture] Error listing AVFoundation devices:", error)
	}

	return devices
}

/**
 * List devices using PulseAudio (Linux)
 */
async function listPulseDevices(ffmpegPath: string): Promise<MicrophoneDevice[]> {
	const devices: MicrophoneDevice[] = []
	try {
		// Use -list_devices to enumerate PulseAudio devices
		const output = execSync(`"${ffmpegPath}" -f pulse -list_devices true -i "" 2>&1 || true`, {
			encoding: "utf-8",
			maxBuffer: 10 * 1024 * 1024,
		})

		// Parse PulseAudio output format:
		// [pulse @ 0x...] List of audio devices:
		// [pulse @ 0x...] 0: Built-in Audio Analog Stereo
		// [pulse @ 0x...] 1: USB Audio Device

		let inDeviceList = false
		const lines = output.split("\n")

		for (const line of lines) {
			if (line.includes("List of audio devices:")) {
				inDeviceList = true
				continue
			}

			if (inDeviceList) {
				// Match pattern: [pulse @ ...] 0: Device Name
				const match = line.match(/(\d+):\s+(.+)/)
				if (match) {
					const id = match[1]
					const name = match[2].trim()
					devices.push({ id, name, platform: "linux" })
				}
			}
		}
	} catch (error) {
		console.error("❌ [FFmpegCapture] Error listing PulseAudio devices:", error)
	}

	return devices
}

/**
 * List devices using DirectShow (Windows)
 */
async function listDShowDevices(ffmpegPath: string): Promise<MicrophoneDevice[]> {
	const devices: MicrophoneDevice[] = []
	try {
		// Use -list_devices to enumerate DirectShow devices
		const output = execSync(`"${ffmpegPath}" -f dshow -list_devices true -i dummy 2>&1 || true`, {
			encoding: "utf-8",
			maxBuffer: 10 * 1024 * 1024,
		})

		// Parse DirectShow output format:
		// [dshow @ 0x...] DirectShow video devices
		// [dshow @ 0x...] DirectShow audio devices
		// [dshow @ 0x...]  "Microphone (Realtek Audio)"
		// [dshow @ 0x...]  "Headset Microphone (USB Audio Device)"

		let inAudioSection = false
		const lines = output.split("\n")

		for (const line of lines) {
			if (line.includes("DirectShow audio devices")) {
				inAudioSection = true
				continue
			}
			if (line.includes("DirectShow video devices")) {
				inAudioSection = false
				continue
			}

			if (inAudioSection) {
				// Match pattern: [dshow @ ...]  "Device Name"
				const match = line.match(/"([^"]+)"/)
				if (match) {
					const name = match[1]
					// For DirectShow, FFmpeg requires format "audio=Device Name"
					// Store just the name - we'll format it in getPlatformInputArgs
					devices.push({ id: name, name, platform: "win32" })
				}
			}
		}
	} catch (error) {
		console.error("❌ [FFmpegCapture] Error listing DirectShow devices:", error)
	}

	return devices
}
