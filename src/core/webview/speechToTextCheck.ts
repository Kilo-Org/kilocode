// kilocode_change - new file: Speech-to-text availability check (extracted from ClineProvider)
import type { ProviderSettingsManager } from "../config/ProviderSettingsManager"
import type { RooCodeSettings } from "@roo-code/types"
import { experimentDefault } from "../../shared/experiments"

/**
 * Cached availability result with timestamp
 */
let cachedResult: { available: boolean; timestamp: number } | null = null
const CACHE_DURATION_MS = 30000 // 30 seconds

/**
 * Check if speech-to-text is fully configured and available
 *
 * Checks:
 * 1. Speech-to-text experiment is enabled
 * 2. OpenAI API key is configured
 * 3. FFmpeg is installed and available
 *
 * Results are cached for 30 seconds to prevent redundant checks.
 *
 * @param providerSettingsManager - Provider settings manager for API configuration
 * @param experiments - Experiment settings (defaults to experimentDefault if not provided)
 * @param forceRecheck - Force a fresh check, ignoring cache (default: false)
 * @returns Promise<boolean> - true if speech-to-text is available
 */
export async function checkSpeechToTextAvailable(
	providerSettingsManager: ProviderSettingsManager,
	experiments?: RooCodeSettings["experiments"],
	forceRecheck = false,
): Promise<boolean> {
	// Return cached result if valid and not forcing recheck
	if (cachedResult !== null && !forceRecheck) {
		const age = Date.now() - cachedResult.timestamp
		if (age < CACHE_DURATION_MS) {
			return cachedResult.available
		}
	}

	console.log("🎙️ [STT Availability Check] Starting speech-to-text availability check...")

	try {
		// Check 1: Experiment flag
		const experimentsMap = experiments ?? experimentDefault
		const isExperimentEnabled = experimentsMap.speechToText ?? false
		console.log(`🎙️ [STT Availability Check] Experiment enabled: ${isExperimentEnabled}`)

		if (!isExperimentEnabled) {
			console.log("🎙️ [STT Availability Check] ❌ FAILED: Speech-to-text experiment is not enabled")
			console.log("🎙️ [STT Availability Check] → Enable in Settings > Experiments > Speech to Text")
			return false
		}

		// Check 2: OpenAI API key
		const { getOpenAiApiKey } = await import("../../services/stt/utils/getOpenAiCredentials")
		const apiKey = await getOpenAiApiKey(providerSettingsManager)
		const hasApiKey = !!apiKey
		console.log(`🎙️ [STT Availability Check] OpenAI API key configured: ${hasApiKey}`)

		if (!hasApiKey) {
			console.log("🎙️ [STT Availability Check] ❌ FAILED: No OpenAI API key found")
			console.log("🎙️ [STT Availability Check] → Add an OpenAI API provider in Settings")
			return false
		}

		// Check 3: FFmpeg installed
		const { checkFFmpegAvailability } = await import("../../services/stt/sttConfig")
		console.log("🎙️ [STT Availability Check] Checking FFmpeg installation...")
		const ffmpegResult = await checkFFmpegAvailability()
		console.log(`🎙️ [STT Availability Check] FFmpeg available: ${ffmpegResult.available}`)

		if (!ffmpegResult.available) {
			console.log("🎙️ [STT Availability Check] ❌ FAILED: FFmpeg is not installed or not in PATH")
			console.log("🎙️ [STT Availability Check] → Install FFmpeg: https://ffmpeg.org/download.html")
			if (ffmpegResult.error) {
				console.log(`🎙️ [STT Availability Check] → Error: ${ffmpegResult.error}`)
			}
			return false
		}

		console.log("🎙️ [STT Availability Check] ✅ SUCCESS: Speech-to-text is fully available!")
		cachedResult = { available: true, timestamp: Date.now() }
		return true
	} catch (error) {
		console.error("🎙️ [STT Availability Check] ❌ FAILED: Unexpected error during check", error)
		cachedResult = { available: false, timestamp: Date.now() }
		return false
	}
}
