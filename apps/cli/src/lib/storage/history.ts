import * as fs from "fs/promises"
import * as path from "path"

import { ensureConfigDir, getConfigDir } from "./config-dir.js"

/** Maximum number of history entries to keep */
export const MAX_HISTORY_ENTRIES = 500

/** History file format version for future migrations */
const HISTORY_VERSION = 1

interface HistoryData {
	version: number
	entries: string[]
}

/**
 * Get the path to the history file
 */
export function getHistoryFilePath(): string {
	return path.join(getConfigDir(), "cli-history.json")
}

/**
 * Load history entries from file
 * Returns empty array if file doesn't exist or is invalid
 */
export async function loadHistory(): Promise<string[]> {
	const filePath = getHistoryFilePath()

	try {
		const content = await fs.readFile(filePath, "utf-8")
		const data: HistoryData = JSON.parse(content)

		// Validate structure
		if (!data || typeof data !== "object") {
			return []
		}

		if (!Array.isArray(data.entries)) {
			return []
		}

		// Filter to only valid strings
		return data.entries.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
	} catch (err) {
		const error = err as NodeJS.ErrnoException
		// File doesn't exist - that's expected on first run
		if (error.code === "ENOENT") {
			return []
		}

		// JSON parse error or other issue - log and return empty
		console.error("Warning: Could not load CLI history:", error.message)
		return []
	}
}

/**
 * Save history entries to file
 * Creates the .roo directory if needed
 * Trims to MAX_HISTORY_ENTRIES
 */
export async function saveHistory(entries: string[]): Promise<void> {
	const filePath = getHistoryFilePath()

	// Trim to max entries (keep most recent)
	const trimmedEntries = entries.slice(-MAX_HISTORY_ENTRIES)

	const data: HistoryData = {
		version: HISTORY_VERSION,
		entries: trimmedEntries,
	}

	try {
		await ensureConfigDir()
		await fs.writeFile(filePath, JSON.stringify(data, null, "\t"), "utf-8")
	} catch (err) {
		const error = err as NodeJS.ErrnoException
		// Log but don't throw - history persistence is not critical
		console.error("Warning: Could not save CLI history:", error.message)
	}
}

/**
 * Add a new entry to history and save
 * Avoids adding consecutive duplicates or empty entries
 * Returns the updated history array
 */
export async function addToHistory(entry: string): Promise<string[]> {
	const trimmed = entry.trim()

	// Don't add empty entries
	if (!trimmed) {
		return await loadHistory()
	}

	const history = await loadHistory()

	// Don't add consecutive duplicates
	if (history.length > 0 && history[history.length - 1] === trimmed) {
		return history
	}

	const updated = [...history, trimmed]
	await saveHistory(updated)

	return updated.slice(-MAX_HISTORY_ENTRIES)
}
