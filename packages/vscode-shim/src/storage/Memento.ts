import * as fs from "fs"
import * as path from "path"
import { ensureDirectoryExists } from "../utils/paths.js"
import type { Memento } from "../types.js"

/**
 * File-based implementation of VSCode's Memento interface
 *
 * Provides persistent key-value storage backed by a JSON file.
 * This implementation automatically loads from and saves to disk.
 *
 * @example
 * ```typescript
 * const memento = new FileMemento('/path/to/state.json')
 *
 * // Store a value
 * await memento.update('lastOpenFile', '/path/to/file.txt')
 *
 * // Retrieve a value
 * const file = memento.get<string>('lastOpenFile')
 *
 * // With default value
 * const count = memento.get<number>('count', 0)
 * ```
 */
export class FileMemento implements Memento {
	private data: Record<string, unknown> = {}
	private filePath: string

	/**
	 * Create a new FileMemento
	 *
	 * @param filePath - Path to the JSON file for persistence
	 */
	constructor(filePath: string) {
		this.filePath = filePath
		this.loadFromFile()
	}

	/**
	 * Load data from the JSON file
	 */
	private loadFromFile(): void {
		try {
			if (fs.existsSync(this.filePath)) {
				const content = fs.readFileSync(this.filePath, "utf-8")
				this.data = JSON.parse(content)
			}
		} catch (error) {
			console.warn(`Failed to load state from ${this.filePath}:`, error)
			this.data = {}
		}
	}

	/**
	 * Save data to the JSON file
	 */
	private saveToFile(): void {
		try {
			// Ensure directory exists
			const dir = path.dirname(this.filePath)
			ensureDirectoryExists(dir)
			fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2))
		} catch (error) {
			console.warn(`Failed to save state to ${this.filePath}:`, error)
		}
	}

	/**
	 * Get a value from storage
	 *
	 * @param key - The key to retrieve
	 * @param defaultValue - Optional default value if key doesn't exist
	 * @returns The stored value or default value
	 */
	get<T>(key: string): T | undefined
	get<T>(key: string, defaultValue: T): T
	get<T>(key: string, defaultValue?: T): T | undefined {
		const value = this.data[key]
		return value !== undefined && value !== null ? (value as T) : defaultValue
	}

	/**
	 * Update a value in storage
	 *
	 * @param key - The key to update
	 * @param value - The value to store (undefined to delete)
	 * @returns A promise that resolves when the update is complete
	 */
	async update(key: string, value: unknown): Promise<void> {
		if (value === undefined) {
			delete this.data[key]
		} else {
			this.data[key] = value
		}
		this.saveToFile()
	}

	/**
	 * Get all keys in storage
	 *
	 * @returns An array of all keys
	 */
	keys(): readonly string[] {
		return Object.keys(this.data)
	}

	/**
	 * Clear all data from storage
	 */
	clear(): void {
		this.data = {}
		this.saveToFile()
	}
}
