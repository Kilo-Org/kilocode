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
 * Check if speech-to-text prerequisites are available
 *
 * This checks the backend prerequisites only:
 * 1. OpenAI API key is configured
 * 2. FFmpeg is installed and available
 *
 * Note: The experiment flag is checked on the frontend, not here.
 * This function always performs a fresh check without caching.
 *
 * @param providerSettingsManager - Provider settings manager for API configuration
 * @returns Promise<SpeechToTextAvailabilityResult> - Result with availability status and failure reason if unavailable
 */
export async function checkSpeechToTextAvailable(
	providerSettingsManager: ProviderSettingsManager,
): Promise<SpeechToTextAvailabilityResult> {
	try {
		// Check 1: OpenAI API key
		const apiKey = await getOpenAiApiKey(providerSettingsManager)
		if (!apiKey) {
			return { available: false, reason: "openaiKeyMissing" }
		}

		// Check 2: FFmpeg installed
		const ffmpegResult = FFmpegCaptureService.findFFmpeg()
		if (!ffmpegResult.available) {
			return { available: false, reason: "ffmpegNotInstalled" }
		}

		return { available: true }
	} catch (error) {
		return { available: false }
	}
}
