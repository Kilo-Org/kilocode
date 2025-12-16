// kilocode_change - new file: Speech-to-text availability check (extracted from ClineProvider)
import type { ProviderSettingsManager } from "../config/ProviderSettingsManager"
import { getOpenAiApiKey } from "../../services/stt/utils/getOpenAiCredentials"
import { FFmpegCaptureService } from "../../services/stt/FFmpegCaptureService"

/**
 * Result type for speech-to-text availability check
 */
export type SpeechToTextAvailabilityResult = {
	available: boolean
	reason?: "openaiKeyMissing" | "ffmpegNotInstalled"
}

/**
 * Cached availability result with timestamp
 */
let cachedResult: { available: boolean; reason?: "openaiKeyMissing" | "ffmpegNotInstalled"; timestamp: number } | null =
	null
const CACHE_DURATION_MS = 30000 // 30 seconds

/**
 * Check if speech-to-text prerequisites are available
 *
 * This checks the backend prerequisites only:
 * 1. OpenAI API key is configured
 * 2. FFmpeg is installed and available
 *
 * Note: The experiment flag is checked on the frontend, not here.
 * Results are cached for 30 seconds to prevent redundant FFmpeg checks.
 *
 * @param providerSettingsManager - Provider settings manager for API configuration
 * @param forceRecheck - Force a fresh check, ignoring cache (default: false)
 * @returns Promise<SpeechToTextAvailabilityResult> - Result with availability status and failure reason if unavailable
 */
export async function checkSpeechToTextAvailable(
	providerSettingsManager: ProviderSettingsManager,
	forceRecheck = false,
): Promise<SpeechToTextAvailabilityResult> {
	// Return cached result if valid and not forcing recheck
	if (cachedResult !== null && !forceRecheck) {
		const age = Date.now() - cachedResult.timestamp
		if (age < CACHE_DURATION_MS) {
			return { available: cachedResult.available, reason: cachedResult.reason }
		}
	}

	try {
		// Check 1: OpenAI API key
		const apiKey = await getOpenAiApiKey(providerSettingsManager)
		if (!apiKey) {
			cachedResult = { available: false, reason: "openaiKeyMissing", timestamp: Date.now() }
			return { available: false, reason: "openaiKeyMissing" }
		}

		// Check 2: FFmpeg installed
		const ffmpegResult = FFmpegCaptureService.findFFmpeg()
		if (!ffmpegResult.available) {
			cachedResult = { available: false, reason: "ffmpegNotInstalled", timestamp: Date.now() }
			return { available: false, reason: "ffmpegNotInstalled" }
		}

		cachedResult = { available: true, timestamp: Date.now() }
		return { available: true }
	} catch (error) {
		cachedResult = { available: false, timestamp: Date.now() }
		return { available: false }
	}
}
