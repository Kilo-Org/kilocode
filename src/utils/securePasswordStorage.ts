import * as vscode from 'vscode'

/**
 * Secure password storage using VS Code's ExtensionContext.secrets
 * This provides secure storage that works with VS Code's built-in secret management
 */

export class SecurePasswordStorage {
	private static secrets: vscode.SecretStorage | null = null

	/**
	 * Initialize the secrets API
	 * This should be called once when the extension starts
	 */
	static initialize(context: vscode.ExtensionContext): void {
		this.secrets = context.secrets
	}

	/**
	 * Get the secrets API (for internal use)
	 */
	private static getSecrets(): vscode.SecretStorage {
		if (!this.secrets) {
			throw new Error('SecurePasswordStorage not initialized. Call initialize(context) first.')
		}
		return this.secrets
	}

	/**
	 * Store password securely using VS Code's secrets API
	 * @param password - The password to store
	 */
	static async storePassword(password: string): Promise<void> {
		try {
			const secrets = this.getSecrets()
			await secrets.store('agentica_password', password)
		} catch (error) {
			console.error('Failed to store password securely:', error)
			throw new Error('Failed to store password securely')
		}
	}

	/**
	 * Retrieve password from secure storage
	 * @returns The stored password or null if not found
	 */
	static async getPassword(): Promise<string | null> {
		try {
			const secrets = this.getSecrets()
			return await secrets.get('agentica_password') || null
		} catch (error) {
			console.error('Failed to retrieve password from secure storage:', error)
			return null
		}
	}

	/**
	 * Clear password from secure storage
	 */
	static async clearPassword(): Promise<void> {
		try {
			const secrets = this.getSecrets()
			await secrets.delete('agentica_password')
		} catch (error) {
			console.error('Failed to clear password from secure storage:', error)
		}
	}

	/**
	 * Check if password is stored
	 * @returns true if password is stored, false otherwise
	 */
	static async hasPassword(): Promise<boolean> {
		try {
			const password = await this.getPassword()
			return password !== null
		} catch (error) {
			console.error('Failed to check password status:', error)
			return false
		}
	}

	/**
	 * Store multiple passwords for different services
	 * @param serviceName - The service name (e.g., 'agentica', 'openai')
	 * @param accountName - The account name
	 * @param password - The password to store
	 */
	static async storePasswordForService(serviceName: string, accountName: string, password: string): Promise<void> {
		try {
			const secrets = this.getSecrets()
			const key = `${serviceName}_${accountName}`
			await secrets.store(key, password)
		} catch (error) {
			console.error(`Failed to store password for ${serviceName}/${accountName}:`, error)
			throw new Error(`Failed to store password for ${serviceName}/${accountName}`)
		}
	}

	/**
	 * Retrieve password for a specific service
	 * @param serviceName - The service name
	 * @param accountName - The account name
	 * @returns The stored password or null if not found
	 */
	static async getPasswordForService(serviceName: string, accountName: string): Promise<string | null> {
		try {
			const secrets = this.getSecrets()
			const key = `${serviceName}_${accountName}`
			return await secrets.get(key) || null
		} catch (error) {
			console.error(`Failed to retrieve password for ${serviceName}/${accountName}:`, error)
			return null
		}
	}

	/**
	 * Clear password for a specific service
	 * @param serviceName - The service name
	 * @param accountName - The account name
	 */
	static async clearPasswordForService(serviceName: string, accountName: string): Promise<void> {
		try {
			const secrets = this.getSecrets()
			const key = `${serviceName}_${accountName}`
			await secrets.delete(key)
		} catch (error) {
			console.error(`Failed to clear password for ${serviceName}/${accountName}:`, error)
		}
	}

	/**
	 * List all stored credentials (service names and account names)
	 * Note: VS Code's secrets API doesn't provide a direct way to list credentials
	 * In a real implementation, you might want to maintain an index of stored credentials
	 */
	static async listCredentials(): Promise<Array<{ service: string; account: string }>> {
		// This is a placeholder implementation
		// In a real implementation, you would need to maintain your own index
		// or use VS Code's workspace state to track stored credentials
		return []
	}
}