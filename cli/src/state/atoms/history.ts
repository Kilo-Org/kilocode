/**
 * History state management atoms
 * Manages command history navigation and persistence
 */

import { atom } from "jotai"
import type { HistoryData, HistoryEntry } from "../../config/history.js"
import { loadHistory, saveHistory, addEntry } from "../../config/history.js"
import { logs } from "../../services/logs.js"

// ============================================================================
// Core State Atoms
// ============================================================================

/**
 * History data atom - holds all history entries
 */
export const historyDataAtom = atom<HistoryData>({
	version: "1.0.0",
	entries: [],
	maxSize: 500,
})

/**
 * History navigation index
 * -1 means not in history mode
 * 0 means at the most recent entry
 * entries.length - 1 means at the oldest entry
 */
export const historyIndexAtom = atom<number>(-1)

/**
 * Whether we're currently in history navigation mode
 */
export const historyModeAtom = atom<boolean>(false)

/**
 * Original input before entering history mode
 * Used to restore when exiting history mode
 */
export const originalInputAtom = atom<string>("")

// ============================================================================
// Derived Atoms (Read-only)
// ============================================================================

/**
 * Get all history entries
 */
export const historyEntriesAtom = atom<HistoryEntry[]>((get) => {
	const data = get(historyDataAtom)
	return data.entries
})

/**
 * Get current history entry based on navigation index
 * Returns null if not in history mode or index is invalid
 */
export const currentHistoryEntryAtom = atom<HistoryEntry | null>((get) => {
	const entries = get(historyEntriesAtom)
	const index = get(historyIndexAtom)
	const inHistoryMode = get(historyModeAtom)

	if (!inHistoryMode || index < 0 || index >= entries.length) {
		return null
	}

	// History is stored oldest to newest, but we navigate newest to oldest
	// So we need to reverse the index
	const reverseIndex = entries.length - 1 - index
	return entries[reverseIndex] || null
})

/**
 * Get the prompt text from current history entry
 */
export const currentHistoryCommandAtom = atom<string>((get) => {
	const entry = get(currentHistoryEntryAtom)
	return entry?.prompt || ""
})

/**
 * Check if we can navigate up (to older entries)
 */
export const canNavigateUpAtom = atom<boolean>((get) => {
	const entries = get(historyEntriesAtom)
	const index = get(historyIndexAtom)
	return index < entries.length - 1
})

/**
 * Check if we can navigate down (to newer entries)
 */
export const canNavigateDownAtom = atom<boolean>((get) => {
	const index = get(historyIndexAtom)
	return index > 0
})

// ============================================================================
// Action Atoms - History Loading/Saving
// ============================================================================

/**
 * Load history from disk
 */
export const loadHistoryAtom = atom(null, async (get, set) => {
	try {
		const data = await loadHistory()
		set(historyDataAtom, data)
	} catch (error) {
		logs.error("Failed to load history into state", "HistoryAtoms", { error })
		throw error
	}
})

/**
 * Save history to disk
 */
export const saveHistoryAtom = atom(null, async (get, _set) => {
	try {
		const data = get(historyDataAtom)
		await saveHistory(data)
	} catch (error) {
		logs.error("Failed to save history from state", "HistoryAtoms", { error })
		throw error
	}
})

/**
 * Add command to history and save
 * Avoids consecutive duplicates
 */
export const addToHistoryAtom = atom(null, async (get, set, prompt: string) => {
	try {
		const currentData = get(historyDataAtom)
		const newData = addEntry(currentData, prompt)
		set(historyDataAtom, newData)
		if (newData.entries.length !== currentData.entries.length) {
			await saveHistory(newData)
		}
	} catch (error) {
		logs.error("Failed to add prompt to history", "HistoryAtoms", { error })
		// Don't throw - history is not critical
	}
})

// ============================================================================
// Action Atoms - History Navigation
// ============================================================================

/**
 * Enter history mode and navigate to most recent entry
 * Should only be called when input is empty
 */
export const enterHistoryModeAtom = atom(null, (get, set, originalInput: string = "") => {
	const entries = get(historyEntriesAtom)

	// Can't enter history mode if no entries
	if (entries.length === 0) {
		return false
	}

	set(historyModeAtom, true)
	set(historyIndexAtom, 0) // Start at most recent
	set(originalInputAtom, originalInput)

	return true
})

/**
 * Exit history mode and restore original input
 */
export const exitHistoryModeAtom = atom(null, (get, set) => {
	const wasInHistoryMode = get(historyModeAtom)

	if (wasInHistoryMode) {
		set(historyModeAtom, false)
		set(historyIndexAtom, -1)
		set(originalInputAtom, "")
	}

	return wasInHistoryMode
})

/**
 * Navigate up in history (to older entries)
 * Returns the prompt to display, or null if can't navigate
 */
export const navigateHistoryUpAtom = atom(null, (get, set): string | null => {
	const canNavigate = get(canNavigateUpAtom)

	if (!canNavigate) {
		return null
	}

	const currentIndex = get(historyIndexAtom)
	const newIndex = currentIndex + 1
	set(historyIndexAtom, newIndex)

	const entries = get(historyEntriesAtom)
	const reverseIndex = entries.length - 1 - newIndex
	const entry = entries[reverseIndex]

	return entry?.prompt || null
})

/**
 * Navigate down in history (to newer entries)
 * Returns the prompt to display, or null if can't navigate
 */
export const navigateHistoryDownAtom = atom(null, (get, set): string | null => {
	const canNavigate = get(canNavigateDownAtom)

	if (!canNavigate) {
		return null
	}

	const currentIndex = get(historyIndexAtom)
	const newIndex = currentIndex - 1
	set(historyIndexAtom, newIndex)

	// If we're back at index 0 or below, return to original input
	if (newIndex < 0) {
		const originalInput = get(originalInputAtom)
		return originalInput
	}

	const entries = get(historyEntriesAtom)
	const reverseIndex = entries.length - 1 - newIndex
	const entry = entries[reverseIndex]

	return entry?.prompt || null
})

/**
 * Reset history navigation state
 * Used when submitting a command from history
 */
export const resetHistoryNavigationAtom = atom(null, (get, set) => {
	set(historyModeAtom, false)
	set(historyIndexAtom, -1)
	set(originalInputAtom, "")
})
