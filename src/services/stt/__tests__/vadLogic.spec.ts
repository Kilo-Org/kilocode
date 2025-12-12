import { describe, it, expect } from "vitest"
import { DEFAULT_VAD_CONFIG } from "../types"

/**
 * Calculate RMS energy of PCM16 audio frame
 * (Extracted from FFmpegCaptureService for testing)
 */
function calculateFrameEnergy(pcm16: Int16Array): number {
	let sum = 0
	for (let i = 0; i < pcm16.length; i++) {
		const normalized = pcm16[i] / 32768
		sum += normalized * normalized
	}
	const rms = Math.sqrt(sum / pcm16.length)
	return Math.min(rms, 1.0)
}

/**
 * Check if frame is voiced based on energy threshold
 */
function isVoicedFrame(energy: number, threshold: number = DEFAULT_VAD_CONFIG.energyThreshold): boolean {
	return energy > threshold
}

/**
 * Check if should commit chunk based on VAD logic
 * Now requires voicedRatio to be above minVoicedRatio
 */
function shouldCommitChunk(
	bufferedAudioMs: number,
	silenceSinceMs: number,
	voicedRatio: number,
	minChunkMs: number = DEFAULT_VAD_CONFIG.minChunkMs,
	shortPauseMs: number = DEFAULT_VAD_CONFIG.shortPauseMs,
	maxChunkMs: number = DEFAULT_VAD_CONFIG.maxChunkMs,
	minVoicedRatio: number = DEFAULT_VAD_CONFIG.minVoicedRatio,
): boolean {
	// Never commit without voiced data
	if (voicedRatio === 0) {
		return false
	}

	const hasEnoughAudio = bufferedAudioMs >= minChunkMs
	const atShortPause = silenceSinceMs >= shortPauseMs
	const hasVoice = voicedRatio >= minVoicedRatio
	const atSafetyCap = bufferedAudioMs >= maxChunkMs && atShortPause

	// Commit on natural pause with enough voice content
	if (hasEnoughAudio && atShortPause && hasVoice) {
		return true
	}

	// Safety cap: force commit if too long AND at pause AND has voice
	if (atSafetyCap && hasVoice) {
		return true
	}

	return false
}

describe("VAD Energy Calculation", () => {
	it("should calculate zero energy for silence", () => {
		const silence = new Int16Array(480).fill(0) // 20ms at 24kHz
		const energy = calculateFrameEnergy(silence)
		expect(energy).toBe(0)
	})

	it("should calculate non-zero energy for audio", () => {
		const audio = new Int16Array(480)
		for (let i = 0; i < audio.length; i++) {
			audio[i] = Math.sin(i / 10) * 1000 // Sine wave
		}
		const energy = calculateFrameEnergy(audio)
		expect(energy).toBeGreaterThan(0)
		expect(energy).toBeLessThanOrEqual(1)
	})

	it("should cap energy at 1.0", () => {
		const loudAudio = new Int16Array(480).fill(32767) // Max PCM16 value
		const energy = calculateFrameEnergy(loudAudio)
		expect(energy).toBeCloseTo(1.0, 2) // Within 0.01 of 1.0
	})

	it("should calculate different energies for different amplitudes", () => {
		const quietAudio = new Int16Array(480).fill(1000)
		const loudAudio = new Int16Array(480).fill(10000)

		const quietEnergy = calculateFrameEnergy(quietAudio)
		const loudEnergy = calculateFrameEnergy(loudAudio)

		expect(loudEnergy).toBeGreaterThan(quietEnergy)
	})

	it("should detect voiced frames above threshold", () => {
		expect(isVoicedFrame(0.02, 0.015)).toBe(true) // Above threshold
		expect(isVoicedFrame(0.01, 0.015)).toBe(false) // Below threshold
		expect(isVoicedFrame(0.015, 0.015)).toBe(false) // Equal to threshold
	})
})

describe("VAD Chunking Logic", () => {
	it("should not commit without any voice data", () => {
		const bufferedMs = 1200 // Above 1000ms min
		const silenceMs = 400 // Above 300ms short pause
		const voicedRatio = 0 // No voice at all

		const shouldCommit = shouldCommitChunk(bufferedMs, silenceMs, voicedRatio)
		expect(shouldCommit).toBe(false)
	})

	it("should not commit before minChunkMs even with voice", () => {
		const bufferedMs = 500 // Below 1000ms min
		const silenceMs = 400 // Above 300ms short pause
		const voicedRatio = 0.5 // Good voice ratio

		const shouldCommit = shouldCommitChunk(bufferedMs, silenceMs, voicedRatio)
		expect(shouldCommit).toBe(false)
	})

	it("should commit at short pause with enough audio and voice", () => {
		const bufferedMs = 1200 // Above 1000ms min
		const silenceMs = 400 // Above 300ms short pause
		const voicedRatio = 0.5 // Above 30% min

		const shouldCommit = shouldCommitChunk(bufferedMs, silenceMs, voicedRatio)
		expect(shouldCommit).toBe(true)
	})

	it("should not commit with enough audio but no pause", () => {
		const bufferedMs = 1200 // Above 1000ms min
		const silenceMs = 100 // Below 150ms short pause
		const voicedRatio = 0.5 // Good voice ratio

		const shouldCommit = shouldCommitChunk(bufferedMs, silenceMs, voicedRatio)
		expect(shouldCommit).toBe(false)
	})

	it("should not commit with enough audio and pause but insufficient voice", () => {
		const bufferedMs = 1200 // Above 1000ms min
		const silenceMs = 400 // Above 300ms short pause
		const voicedRatio = 0.2 // Below 30% min

		const shouldCommit = shouldCommitChunk(bufferedMs, silenceMs, voicedRatio)
		expect(shouldCommit).toBe(false)
	})

	it("should force commit at maxChunkMs only with pause and voice", () => {
		const bufferedMs = 10100 // Above 10000ms max
		const silenceMs = 0 // No silence at all
		const voicedRatio = 0.5 // Good voice ratio

		// No pause = no commit even at safety cap
		const shouldCommit = shouldCommitChunk(bufferedMs, silenceMs, voicedRatio)
		expect(shouldCommit).toBe(false)
	})

	it("should force commit at maxChunkMs with pause and voice", () => {
		const bufferedMs = 10100 // Above 10000ms max
		const silenceMs = 400 // Above 300ms short pause
		const voicedRatio = 0.5 // Good voice ratio

		const shouldCommit = shouldCommitChunk(bufferedMs, silenceMs, voicedRatio)
		expect(shouldCommit).toBe(true)
	})

	it("should not commit with short audio and short silence", () => {
		const bufferedMs = 500 // Below 1000ms min
		const silenceMs = 100 // Below 300ms short pause
		const voicedRatio = 0.5 // Good voice ratio

		const shouldCommit = shouldCommitChunk(bufferedMs, silenceMs, voicedRatio)
		expect(shouldCommit).toBe(false)
	})

	it("should commit exactly at threshold values", () => {
		// Exactly at min audio + short pause + min voice
		expect(shouldCommitChunk(1000, 300, 0.3)).toBe(true)

		// At max chunk with pause and voice
		expect(shouldCommitChunk(10000, 300, 0.3)).toBe(true)
	})
})

describe("VAD Configuration", () => {
	it("should have sensible default values", () => {
		expect(DEFAULT_VAD_CONFIG.energyThreshold).toBe(0.02)
		expect(DEFAULT_VAD_CONFIG.minChunkMs).toBe(1000)
		expect(DEFAULT_VAD_CONFIG.shortPauseMs).toBe(150)
		expect(DEFAULT_VAD_CONFIG.maxChunkMs).toBe(10000)
		expect(DEFAULT_VAD_CONFIG.frameDurationMs).toBe(20)
		expect(DEFAULT_VAD_CONFIG.minVoicedRatio).toBe(0.3)
	})

	it("should have maxChunkMs > minChunkMs", () => {
		expect(DEFAULT_VAD_CONFIG.maxChunkMs).toBeGreaterThan(DEFAULT_VAD_CONFIG.minChunkMs)
	})

	it("should have reasonable frame duration", () => {
		// Frame duration should be between 10-30ms for real-time audio
		expect(DEFAULT_VAD_CONFIG.frameDurationMs).toBeGreaterThanOrEqual(10)
		expect(DEFAULT_VAD_CONFIG.frameDurationMs).toBeLessThanOrEqual(30)
	})

	it("should have reasonable voice ratio threshold", () => {
		// Should be between 10-50% for practical use
		expect(DEFAULT_VAD_CONFIG.minVoicedRatio).toBeGreaterThanOrEqual(0.1)
		expect(DEFAULT_VAD_CONFIG.minVoicedRatio).toBeLessThanOrEqual(0.5)
	})
})

describe("VAD Edge Cases", () => {
	it("should handle zero-length audio frames", () => {
		const emptyFrame = new Int16Array(0)
		const energy = calculateFrameEnergy(emptyFrame)
		expect(isNaN(energy) || energy === 0).toBe(true)
	})

	it("should handle negative PCM values", () => {
		const negativeAudio = new Int16Array(480).fill(-10000)
		const energy = calculateFrameEnergy(negativeAudio)
		expect(energy).toBeGreaterThan(0)
		expect(energy).toBeLessThanOrEqual(1)
	})

	it("should handle mixed positive/negative values", () => {
		const mixedAudio = new Int16Array(480)
		for (let i = 0; i < mixedAudio.length; i++) {
			mixedAudio[i] = i % 2 === 0 ? 5000 : -5000
		}
		const energy = calculateFrameEnergy(mixedAudio)
		expect(energy).toBeGreaterThan(0)
		expect(energy).toBeLessThanOrEqual(1)
	})

	it("should not commit very long buffer without voice", () => {
		const bufferedMs = 10000 // Very long
		const silenceMs = 400 // Has pause
		const voicedRatio = 0 // No voice

		const shouldCommit = shouldCommitChunk(bufferedMs, silenceMs, voicedRatio)
		expect(shouldCommit).toBe(false) // Never commit without voice
	})

	it("should handle very long silence with voice", () => {
		const bufferedMs = 1200 // Above 1000ms min
		const silenceMs = 5000 // Very long silence
		const voicedRatio = 0.4 // Good voice ratio

		const shouldCommit = shouldCommitChunk(bufferedMs, silenceMs, voicedRatio)
		expect(shouldCommit).toBe(true) // Should commit on pause with voice
	})
})
