/**
 * User Identity Management
 * Handles user identification and session tracking for telemetry
 */

import * as fs from "fs-extra"
import * as path from "path"
import * as crypto from "crypto"
import { KiloCodePaths } from "../../utils/paths.js"
import { logs } from "../logs.js"
import { getApiUrl } from "@roo-code/types"
import { machineIdSync } from "node-machine-id"

/**
 * User identity structure
 */
export interface UserIdentity {
	/** Persistent CLI user ID (UUID stored in ~/.kilocode/cli/identity) */
	cliUserId: string

	/** Machine identifier (OS-level) */
	machineId: string

	/** Kilocode user ID (from authentication token) */
	kilocodeUserId?: string

	/** Current session ID (new UUID per CLI session) */
	sessionId: string

	/** Session start timestamp */
	sessionStartTime: number
}

/**
 * Stored identity data
 */
interface StoredIdentity {
	cliUserId: string
	createdAt: number
	lastUsed: number
}

/**
 * Identity manager class
 */
export class IdentityManager {
	private static instance: IdentityManager | null = null
	private identity: UserIdentity | null = null
	private identityFilePath: string

	private constructor() {
		this.identityFilePath = path.join(KiloCodePaths.getKiloCodeDir(), "identity.json")
	}

	/**
	 * Get singleton instance
	 */
	public static getInstance(): IdentityManager {
		if (!IdentityManager.instance) {
			IdentityManager.instance = new IdentityManager()
		}
		return IdentityManager.instance
	}

	/**
	 * Initialize identity for the current session
	 */
	public async initialize(): Promise<UserIdentity> {
		try {
			// Load or create persistent CLI user ID
			const cliUserId = await this.loadOrCreateCLIUserId()

			// Get machine ID
			const machineId = this.getMachineId()

			// Generate new session ID
			const sessionId = this.generateSessionId()

			// Create identity object
			this.identity = {
				cliUserId,
				machineId,
				sessionId,
				sessionStartTime: Date.now(),
			}

			logs.debug("Identity initialized", "IdentityManager", {
				cliUserId: cliUserId.substring(0, 8) + "...",
				machineId: machineId.substring(0, 8) + "...",
				sessionId: sessionId.substring(0, 8) + "...",
			})

			return this.identity
		} catch (error) {
			logs.error("Failed to initialize identity", "IdentityManager", { error })
			throw error
		}
	}

	/**
	 * Update Kilocode user ID from authentication token
	 */
	public async updateKilocodeUserId(kilocodeToken: string): Promise<void> {
		if (!this.identity) {
			logs.warn("Cannot update Kilocode user ID: identity not initialized", "IdentityManager")
			return
		}

		try {
			// Fetch user profile from Kilocode API
			const response = await fetch(getApiUrl("/api/profile"), {
				headers: {
					Authorization: `Bearer ${kilocodeToken}`,
					"Content-Type": "application/json",
				},
			})

			if (!response.ok) {
				throw new Error(`API request failed: ${response.status}`)
			}

			const data = await response.json()

			if (data?.user?.email) {
				this.identity.kilocodeUserId = data.user.email
				logs.debug("Kilocode user ID updated", "IdentityManager", {
					userId: data.user.email.substring(0, 3) + "...",
				})
			} else {
				throw new Error("Invalid API response: missing user email")
			}
		} catch (error) {
			logs.warn("Failed to update Kilocode user ID", "IdentityManager", { error })
			// Clear Kilocode user ID on error
			if (this.identity.kilocodeUserId) {
				delete this.identity.kilocodeUserId
			}
		}
	}

	/**
	 * Clear Kilocode user ID (on logout)
	 */
	public clearKilocodeUserId(): void {
		if (this.identity && this.identity.kilocodeUserId) {
			delete this.identity.kilocodeUserId
			logs.debug("Kilocode user ID cleared", "IdentityManager")
		}
	}

	/**
	 * Get current identity
	 */
	public getIdentity(): UserIdentity | null {
		return this.identity
	}

	/**
	 * Get distinct ID for PostHog (prioritize Kilocode user ID)
	 */
	public getDistinctId(): string {
		if (!this.identity) {
			return "unknown"
		}

		// Use Kilocode user ID if available, otherwise use CLI user ID
		return this.identity.kilocodeUserId || this.identity.cliUserId
	}

	/**
	 * Get session duration in milliseconds
	 */
	public getSessionDuration(): number {
		if (!this.identity) {
			return 0
		}
		return Date.now() - this.identity.sessionStartTime
	}

	/**
	 * Load or create persistent CLI user ID
	 */
	private async loadOrCreateCLIUserId(): Promise<string> {
		try {
			// Ensure directory exists
			await fs.ensureDir(path.dirname(this.identityFilePath))

			// Try to load existing identity
			if (await fs.pathExists(this.identityFilePath)) {
				const data = await fs.readJson(this.identityFilePath)
				if (this.isValidStoredIdentity(data)) {
					// Update last used timestamp
					data.lastUsed = Date.now()
					await fs.writeJson(this.identityFilePath, data, { spaces: 2 })
					return data.cliUserId
				}
			}

			// Create new identity
			const newIdentity: StoredIdentity = {
				cliUserId: this.generateUUID(),
				createdAt: Date.now(),
				lastUsed: Date.now(),
			}

			await fs.writeJson(this.identityFilePath, newIdentity, { spaces: 2 })
			logs.info("Created new CLI user identity", "IdentityManager")

			return newIdentity.cliUserId
		} catch (error) {
			logs.error("Failed to load/create CLI user ID", "IdentityManager", { error })
			// Fallback to generating a temporary ID
			return this.generateUUID()
		}
	}

	/**
	 * Get machine identifier
	 */
	private getMachineId(): string {
		try {
			return machineIdSync()
		} catch (error) {
			logs.warn("Failed to get machine ID", "IdentityManager", { error })
			return "unknown"
		}
	}

	/**
	 * Generate a new session ID
	 */
	private generateSessionId(): string {
		return this.generateUUID()
	}

	/**
	 * Generate a UUID v4
	 */
	private generateUUID(): string {
		return crypto.randomUUID()
	}

	/**
	 * Validate stored identity data
	 */
	private isValidStoredIdentity(data: unknown): data is StoredIdentity {
		return (
			typeof data === "object" &&
			data !== null &&
			typeof (data as Record<string, unknown>).cliUserId === "string" &&
			typeof (data as Record<string, unknown>).createdAt === "number" &&
			typeof (data as Record<string, unknown>).lastUsed === "number"
		)
	}

	/**
	 * Reset identity (for testing)
	 */
	public async reset(): Promise<void> {
		this.identity = null
		try {
			if (await fs.pathExists(this.identityFilePath)) {
				await fs.remove(this.identityFilePath)
				logs.debug("Identity reset", "IdentityManager")
			}
		} catch (error) {
			logs.error("Failed to reset identity", "IdentityManager", { error })
		}
	}
}

/**
 * Get the singleton identity manager instance
 */
export function getIdentityManager(): IdentityManager {
	return IdentityManager.getInstance()
}
