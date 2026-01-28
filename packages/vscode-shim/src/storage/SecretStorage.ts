import * as fs from "fs"
import * as path from "path"
import { EventEmitter } from "../classes/EventEmitter.js"
import { ensureDirectoryExists } from "../utils/paths.js"
import type { SecretStorage, SecretStorageChangeEvent } from "../types.js"

/**
 * File-based implementation of VSCode's SecretStorage interface
 *
 * Stores secrets in a JSON file on disk. While not encrypted like VSCode's
 * native keychain integration, this provides a simple, cross-platform solution
 * suitable for CLI applications.
 *
 * **Security Notes:**
 * - Secrets are stored as plain JSON (not encrypted)
 * - File permissions should be set restrictive (0600)
 * - For production, consider using environment variables instead
 * - Suitable for development and non-critical secrets
 *
 * @example
 * ```typescript
 * const storage = new FileSecretStorage('/path/to/secrets.json')
 *
 * // Store a secret
 * await storage.store('apiKey', 'sk-...')
 *
 * // Retrieve a secret
 * const key = await storage.get('apiKey')
 *
 * // Listen for changes
 * storage.onDidChange((e) => {
 *   console.log(`Secret ${e.key} changed`)
 * })
 * ```
 */
export class FileSecretStorage implements SecretStorage {
	private secrets: Record<string, string> = {}
	private _onDidChange = new EventEmitter<SecretStorageChangeEvent>()
	private filePath: string

	/**
	 * Create a new FileSecretStorage
	 *
	 * @param storagePath - Directory path where secrets.json will be stored
	 */
	constructor(storagePath: string) {
		this.filePath = path.join(storagePath, "secrets.json")
		this.loadFromFile()
	}

	/**
	 * Load secrets from the JSON file
	 */
	private loadFromFile(): void {
		try {
			if (fs.existsSync(this.filePath)) {
				const content = fs.readFileSync(this.filePath, "utf-8")
				this.secrets = JSON.parse(content)
			}
		} catch (error) {
			console.warn(`Failed to load secrets from ${this.filePath}:`, error)
			this.secrets = {}
		}
	}

	/**
	 * Save secrets to the JSON file with restrictive permissions
	 */
	private saveToFile(): void {
		try {
			// Ensure directory exists
			const dir = path.dirname(this.filePath)
			ensureDirectoryExists(dir)

			// Write the file
			fs.writeFileSync(this.filePath, JSON.stringify(this.secrets, null, 2))

			// Set restrictive permissions (owner read/write only) on Unix-like systems
			if (process.platform !== "win32") {
				try {
					fs.chmodSync(this.filePath, 0o600)
				} catch {
					// Ignore chmod errors (might not be supported on some filesystems)
				}
			}
		} catch (error) {
			console.warn(`Failed to save secrets to ${this.filePath}:`, error)
		}
	}

	/**
	 * Retrieve a secret by key
	 *
	 * @param key - The secret key
	 * @returns The secret value or undefined if not found
	 */
	async get(key: string): Promise<string | undefined> {
		return this.secrets[key]
	}

	/**
	 * Store a secret
	 *
	 * @param key - The secret key
	 * @param value - The secret value
	 */
	async store(key: string, value: string): Promise<void> {
		this.secrets[key] = value
		this.saveToFile()
		this._onDidChange.fire({ key })
	}

	/**
	 * Delete a secret
	 *
	 * @param key - The secret key to delete
	 */
	async delete(key: string): Promise<void> {
		delete this.secrets[key]
		this.saveToFile()
		this._onDidChange.fire({ key })
	}

	/**
	 * Event fired when a secret changes
	 */
	get onDidChange() {
		return this._onDidChange.event
	}

	/**
	 * Clear all secrets (useful for testing)
	 */
	clearAll(): void {
		this.secrets = {}
		this.saveToFile()
	}
}
