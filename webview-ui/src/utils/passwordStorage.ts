/**
 * Secure password storage utility for webview
 * Uses VS Code extension backend with keytar for secure storage
 */

const PASSWORD_STORAGE_KEY = 'agentica_password'

/**
 * Interface for secure password storage messages
 */
interface SecurePasswordMessage {
    type: 'storeSecurePassword' | 'getSecurePassword' | 'clearSecurePassword' | 'securePasswordRetrieved'
    key: string
    password?: string
    error?: string
}

/**
 * Type for pending request callbacks
 */
type PromiseCallbacks = {
    resolve: (value: string | null) => void
    reject: (reason: any) => void
}

/**
 * Promise-based wrapper for secure password operations
 */
class SecurePasswordManager {
    private pendingRequests = new Map<string, PromiseCallbacks>()
    
    constructor() {
        // Listen for responses from the extension
        if (typeof window !== 'undefined' && (window as any).vscode) {
            window.addEventListener('message', this.handleMessage.bind(this))
        }
    }
    
    private handleMessage(event: MessageEvent) {
        const message: SecurePasswordMessage = event.data
        
        if (message.type === 'securePasswordRetrieved') {
            const mapInstance = this.pendingRequests as any
            const request = mapInstance.get(message.key)
            if (request) {
                mapInstance.delete(message.key)
                if (message.error) {
                    request.reject(new Error(message.error))
                } else {
                    request.resolve(message.password || null)
                }
            }
        }
    }
    
    /**
     * Store password securely through VS Code extension
     */
    async storePassword(key: string, password: string): Promise<void> {
        if (typeof window !== 'undefined' && (window as any).vscode) {
            (window as any).vscode.postMessage({
                type: 'storeSecurePassword',
                key: key,
                password: password
            })
        } else {
            // Fallback to sessionStorage in development
            try {
                sessionStorage.setItem(key, password)
            } catch (error) {
                console.error('Failed to store password in fallback storage:', error)
            }
        }
    }
    
    /**
     * Retrieve password securely through VS Code extension
     */
    async getPassword(key: string): Promise<string | null> {
        if (typeof window !== 'undefined' && (window as any).vscode) {
            return new Promise((resolve, reject) => {
                // Create callbacks object
                const callbacks: PromiseCallbacks = { resolve, reject }
                
                // Store callbacks using explicit any casting
                const mapInstance = this.pendingRequests as any
                mapInstance.set(key, callbacks)
                
                // Send request to extension
                (window as any).vscode.postMessage({
                    type: 'getSecurePassword',
                    key: key
                })
                
                // Set timeout for request
                setTimeout(() => {
                    if (mapInstance.has(key)) {
                        mapInstance.delete(key)
                        reject(new Error('Password retrieval timeout'))
                    }
                }, 5000)
            })
        } else {
            // Fallback to sessionStorage in development
            try {
                return sessionStorage.getItem(key)
            } catch (error) {
                console.error('Failed to retrieve password from fallback storage:', error)
                return null
            }
        }
    }
    
    /**
     * Clear password securely through VS Code extension
     */
    async clearPassword(key: string): Promise<void> {
        if (typeof window !== 'undefined' && (window as any).vscode) {
            (window as any).vscode.postMessage({
                type: 'clearSecurePassword',
                key: key
            })
        } else {
            // Fallback to sessionStorage in development
            try {
                sessionStorage.removeItem(key)
            } catch (error) {
                console.error('Failed to clear password from fallback storage:', error)
            }
        }
    }
}

// Create singleton instance
const securePasswordManager = new SecurePasswordManager()

/**
 * Enhanced password storage that works with VS Code extension backend
 */
export const securePasswordStorage = {
    /**
     * Store password securely through VS Code extension
     * @param key - Storage key
     * @param password - The password to store
     */
    async storePassword(key: string, password: string): Promise<void> {
        try {
            await securePasswordManager.storePassword(key, password)
        } catch (error) {
            console.error('Failed to store password securely:', error)
            throw error
        }
    },

    /**
     * Retrieve password securely through VS Code extension
     * @param key - Storage key
     * @returns The stored password or null if not found
     */
    async getPassword(key: string): Promise<string | null> {
        try {
            return await securePasswordManager.getPassword(key)
        } catch (error) {
            console.error('Failed to retrieve password securely:', error)
            // Fallback to sessionStorage
            try {
                return sessionStorage.getItem(key)
            } catch (fallbackError) {
                console.error('Failed to retrieve password from fallback storage:', fallbackError)
                return null
            }
        }
    },

    /**
     * Clear password securely through VS Code extension
     * @param key - Storage key
     */
    async clearPassword(key: string): Promise<void> {
        try {
            await securePasswordManager.clearPassword(key)
        } catch (error) {
            console.error('Failed to clear password securely:', error)
            // Fallback to sessionStorage
            try {
                sessionStorage.removeItem(key)
            } catch (fallbackError) {
                console.error('Failed to clear password from fallback storage:', fallbackError)
            }
        }
    }
}

/**
 * Legacy password storage using sessionStorage (fallback only)
 */
export const passwordStorage = {
    storePassword(password: string): void {
        try {
            sessionStorage.setItem(PASSWORD_STORAGE_KEY, password)
        } catch (error) {
            console.error('Failed to store password:', error)
        }
    },

    getPassword(): string | null {
        try {
            return sessionStorage.getItem(PASSWORD_STORAGE_KEY)
        } catch (error) {
            console.error('Failed to retrieve password:', error)
            return null
        }
    },

    clearPassword(): void {
        try {
            sessionStorage.removeItem(PASSWORD_STORAGE_KEY)
        } catch (error) {
            console.error('Failed to clear password:', error)
        }
    },

    hasPassword(): boolean {
        return this.getPassword() !== null
    }
}