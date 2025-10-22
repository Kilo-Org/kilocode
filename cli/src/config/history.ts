/**
 * History persistence module
 * Manages command history storage and retrieval
 * Follows the same pattern as config persistence
 */

import * as fs from "fs/promises"
import * as path from "path"
import { homedir } from "os"
import { logs } from "../services/logs.js"

// ============================================================================
// Types
// ============================================================================

export interface HistoryEntry {
	prompt: string
	timestamp: number
}

export interface HistoryData {
	version: "1.0.0"
	maxSize: number
	entries: HistoryEntry[]
}

// ============================================================================
// Constants
// ============================================================================

export const HISTORY_DIR = path.join(homedir(), ".kilocode", "cli")
export const HISTORY_FILE = path.join(HISTORY_DIR, "history.json")
export const DEFAULT_MAX_SIZE = 500

// Allow overriding paths for testing
let historyDir = HISTORY_DIR
let historyFile = HISTORY_FILE

export function setHistoryPaths(dir: string, file: string): void {
	historyDir = dir
	historyFile = file
}

export function resetHistoryPaths(): void {
	historyDir = HISTORY_DIR
	historyFile = HISTORY_FILE
}

// ============================================================================
// Default History Data
// ============================================================================

const DEFAULT_HISTORY: HistoryData = {
	version: "1.0.0",
	entries: [],
	maxSize: DEFAULT_MAX_SIZE,
}

// ============================================================================
// File Operations
// ============================================================================

/**
 * Ensure history directory exists
 */
export async function ensureHistoryDir(): Promise<void> {
	try {
		await fs.mkdir(historyDir, { recursive: true })
	} catch (error) {
		logs.error("Failed to create history directory", "HistoryPersistence", { error })
		throw error
	}
}

/**
 * Check if history file exists
 */
export async function historyExists(): Promise<boolean> {
	try {
		await fs.access(historyFile)
		return true
	} catch {
		return false
	}
}

/**
 * Load history from disk
 * Returns default history if file doesn't exist or is invalid
 */
export async function loadHistory(): Promise<HistoryData> {
	try {
		await ensureHistoryDir()

		// Check if history file exists
		const exists = await historyExists()
		if (!exists) {
			// Create default history file
			await fs.writeFile(historyFile, JSON.stringify(DEFAULT_HISTORY, null, 2))
			return DEFAULT_HISTORY
		}

		// Read and parse history
		const content = await fs.readFile(historyFile, "utf-8")
		const data = JSON.parse(content) as HistoryData

		// Validate structure
		if (!data.version || !Array.isArray(data.entries)) {
			logs.warn("Invalid history file structure, using defaults", "HistoryPersistence")
			return DEFAULT_HISTORY
		}

		// Ensure maxSize is set
		if (!data.maxSize) {
			data.maxSize = DEFAULT_MAX_SIZE
		}

		return data
	} catch (error) {
		logs.error("Failed to load history", "HistoryPersistence", { error })
		// Return default history on error instead of throwing
		return DEFAULT_HISTORY
	}
}

/**
 * Save history to disk
 */
export async function saveHistory(data: HistoryData): Promise<void> {
	try {
		// Ensure history directory exists
		await ensureHistoryDir()

		// Ensure entries don't exceed maxSize
		if (data.entries.length > data.maxSize) {
			data.entries = data.entries.slice(-data.maxSize)
		}

		// Write history with pretty formatting
		const jsonContent = JSON.stringify(data, null, 2)
		await fs.writeFile(historyFile, jsonContent)
	} catch (error) {
		logs.error("Failed to save history", "HistoryPersistence", { error })
		throw error
	}
}

/**
 * Add entry to history
 * Avoids consecutive duplicates
 */
export function addEntry(data: HistoryData, prompt: string): HistoryData {
	// Skip empty prompts
	if (!prompt.trim()) {
		return data
	}

	// Check if this is a consecutive duplicate
	const lastEntry = data.entries[data.entries.length - 1]
	if (lastEntry && lastEntry.prompt === prompt) {
		return data
	}

	// Add new entry
	const newEntry: HistoryEntry = {
		prompt,
		timestamp: Date.now(),
	}

	const newEntries = [...data.entries, newEntry]

	// Trim to maxSize if needed
	const trimmedEntries = newEntries.length > data.maxSize ? newEntries.slice(-data.maxSize) : newEntries

	return {
		...data,
		entries: trimmedEntries,
	}
}

/**
 * Clear all history
 */
export async function clearHistory(): Promise<void> {
	try {
		await saveHistory(DEFAULT_HISTORY)
	} catch (error) {
		logs.error("Failed to clear history", "HistoryPersistence", { error })
		throw error
	}
}

/**
 * Get history file path
 */
export function getHistoryPath(): string {
	return historyFile
}
