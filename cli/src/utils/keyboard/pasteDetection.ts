/**
 * Paste detection utilities for keyboard input
 */

import type { Key } from "../../types/keyboard.js"
import { FALLBACK_PASTE_TIMING } from "../../constants/keyboard/index.js"
import { isNavigationKey, isNewlineKey, isRapidInput, normalizeLineEndings } from "./helpers.js"
import { createPasteKey } from "./parsing.js"
import type { TimerManager } from "./timerManager.js"

/**
 * State for fallback paste detection
 */
export interface FallbackPasteState {
	buffer: string
	isActive: boolean
	lastKeypressTime: number
}

/**
 * Create initial fallback paste state
 */
export function createFallbackPasteState(): FallbackPasteState {
	return {
		buffer: "",
		isActive: false,
		lastKeypressTime: 0,
	}
}

/**
 * Check if paste detection should start based on timing and key type
 */
export function shouldStartPasteDetection(
	parsedKey: Key,
	timeSinceLastKey: number,
	state: FallbackPasteState,
): boolean {
	// Don't start if already pasting
	if (state.isActive) return false

	// Ignore navigation keys completely
	if (isNavigationKey(parsedKey.name)) return false

	// Only start on newline with rapid subsequent input
	return isNewlineKey(parsedKey) && isRapidInput(timeSinceLastKey)
}

/**
 * Handle fallback paste accumulation
 */
export function accumulateFallbackPaste(
	parsedKey: Key,
	state: FallbackPasteState,
	timer: TimerManager,
	onComplete: (text: string) => void,
): void {
	state.buffer += parsedKey.sequence

	// Reset timer - wait for input to stop
	timer.set(() => {
		completeFallbackPaste(state, onComplete)
	}, FALLBACK_PASTE_TIMING.COMPLETION_TIMEOUT_MS)
}

/**
 * Complete fallback paste and broadcast the accumulated text
 */
export function completeFallbackPaste(state: FallbackPasteState, onComplete: (text: string) => void): void {
	if (state.isActive && state.buffer) {
		const normalizedBuffer = normalizeLineEndings(state.buffer)
		onComplete(normalizedBuffer)
		state.isActive = false
		state.buffer = ""
	}
}

/**
 * Start fallback paste detection
 */
export function startFallbackPaste(
	parsedKey: Key,
	state: FallbackPasteState,
	timer: TimerManager,
	onComplete: (text: string) => void,
): void {
	state.isActive = true
	state.buffer = parsedKey.sequence

	// Set timer to complete paste if no more input arrives
	timer.set(() => {
		completeFallbackPaste(state, onComplete)
	}, FALLBACK_PASTE_TIMING.COMPLETION_TIMEOUT_MS)
}

/**
 * Update last keypress time for non-navigation keys
 */
export function updateKeypressTime(parsedKey: Key, state: FallbackPasteState): void {
	if (!isNavigationKey(parsedKey.name)) {
		state.lastKeypressTime = Date.now()
	}
}

/**
 * Process a key for fallback paste detection
 * Returns true if the key was handled as part of paste, false otherwise
 */
export function processFallbackPasteKey(
	parsedKey: Key,
	state: FallbackPasteState,
	timer: TimerManager,
	broadcastKey: (key: Key) => void,
): boolean {
	const now = Date.now()
	const timeSinceLastKey = now - state.lastKeypressTime

	// If already in paste mode, continue accumulating
	if (state.isActive) {
		accumulateFallbackPaste(parsedKey, state, timer, (text) => {
			broadcastKey(createPasteKey(text))
		})
		return true
	}

	// Check if we should start paste detection
	if (shouldStartPasteDetection(parsedKey, timeSinceLastKey, state)) {
		startFallbackPaste(parsedKey, state, timer, (text) => {
			broadcastKey(createPasteKey(text))
		})
		return true
	}

	// Update timing for non-navigation keys
	updateKeypressTime(parsedKey, state)

	return false
}
