// kilocode_change - new file
import * as crypto from "crypto"

const ENCRYPTION_CONFIG = {
	algorithm: "aes-256-gcm",
	keyLength: 32, // 256 bits
	ivLength: 16, // 128 bits
	authTagLength: 16, // 128 bits
} as const

/**
 * Encryption utility for sensitive external data
 * Uses AES-256-GCM for authenticated encryption
 */
export class EncryptionService {
	private static encryptionKey: Buffer | null = null

	/**
	 * Initialize encryption service with a key derived from system-specific data
	 */
	static async initialize(): Promise<void> {
		if (this.encryptionKey) {
			return
		}

		// Derive key from machine-specific data
		const os = require("os")
		const machineId = os.hostname() + os.platform() + os.arch()

		// Use a deterministic key derivation (in production, use secure key management)
		this.encryptionKey = crypto
			.createHash("sha256")
			.update(machineId + "kilocode-external-context-encryption-key")
			.digest()
	}

	/**
	 * Encrypt sensitive data
	 * Returns base64-encoded string with IV and auth tag
	 */
	static encrypt(plaintext: string): string {
		if (!this.encryptionKey) {
			throw new Error("EncryptionService not initialized")
		}

		const iv = crypto.randomBytes(ENCRYPTION_CONFIG.ivLength)
		const cipher = crypto.createCipheriv(ENCRYPTION_CONFIG.algorithm, this.encryptionKey, iv)

		let encrypted = cipher.update(plaintext, "utf8", "base64")
		encrypted += cipher.final("base64")

		const authTag = cipher.getAuthTag()

		// Combine IV + authTag + encrypted data
		const combined = Buffer.concat([iv, authTag, Buffer.from(encrypted, "base64")])

		return combined.toString("base64")
	}

	/**
	 * Decrypt sensitive data
	 * Takes base64-encoded string with IV and auth tag
	 */
	static decrypt(ciphertext: string): string {
		if (!this.encryptionKey) {
			throw new Error("EncryptionService not initialized")
		}

		const combined = Buffer.from(ciphertext, "base64")

		// Extract IV, authTag, and encrypted data
		const iv = combined.subarray(0, ENCRYPTION_CONFIG.ivLength)
		const authTag = combined.subarray(
			ENCRYPTION_CONFIG.ivLength,
			ENCRYPTION_CONFIG.ivLength + ENCRYPTION_CONFIG.authTagLength,
		)
		const encrypted = combined.subarray(ENCRYPTION_CONFIG.ivLength + ENCRYPTION_CONFIG.authTagLength)

		const decipher = crypto.createDecipheriv(ENCRYPTION_CONFIG.algorithm, this.encryptionKey, iv)

		decipher.setAuthTag(authTag)

		let decrypted = decipher.update(encrypted, undefined, "utf8")
		decrypted += decipher.final("utf8")

		return decrypted
	}

	/**
	 * Check if data is encrypted (heuristic: base64 with specific structure)
	 */
	static isEncrypted(data: string): boolean {
		try {
			const decoded = Buffer.from(data, "base64")
			return decoded.length >= ENCRYPTION_CONFIG.ivLength + ENCRYPTION_CONFIG.authTagLength
		} catch {
			return false
		}
	}
}
