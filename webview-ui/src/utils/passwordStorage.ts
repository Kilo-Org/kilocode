// Password storage utilities for Agentica provider
// Uses VS Code's secure storage API when available, falls back to localStorage

interface PasswordStorage {
    getPassword(service: string, account: string): Promise<string | null>
    setPassword(service: string, account: string, password: string): Promise<void>
    deletePassword(service: string, account: string): Promise<void>
}

class SecurePasswordStorage implements PasswordStorage {
    async getPassword(service: string, account: string): Promise<string | null> {
        try {
            // Try to use VS Code's secure storage
            if (window.vscode?.postMessage) {
                return new Promise((resolve) => {
                    const messageHandler = (event: MessageEvent) => {
                        const message = event.data
                        if (message.type === 'password:get:response') {
                            window.removeEventListener('message', messageHandler)
                            resolve(message.data?.password || null)
                        }
                    }
                    
                    window.addEventListener('message', messageHandler)
                    window.vscode.postMessage({
                        type: 'password:get',
                        data: { service, account }
                    })
                })
            }
            
            // Fallback to localStorage
            const key = `agentica:password:${service}:${account}`
            return localStorage.getItem(key)
        } catch {
            return null
        }
    }

    async setPassword(service: string, account: string, password: string): Promise<void> {
        try {
            // Try to use VS Code's secure storage
            if (window.vscode?.postMessage) {
                return new Promise((resolve) => {
                    const messageHandler = (event: MessageEvent) => {
                        const message = event.data
                        if (message.type === 'password:set:response') {
                            window.removeEventListener('message', messageHandler)
                            resolve()
                        }
                    }
                    
                    window.addEventListener('message', messageHandler)
                    window.vscode.postMessage({
                        type: 'password:set',
                        data: { service, account, password }
                    })
                })
            }
            
            // Fallback to localStorage
            const key = `agentica:password:${service}:${account}`
            localStorage.setItem(key, password)
        } catch (error) {
            console.error('Failed to store password:', error)
        }
    }

    async deletePassword(service: string, account: string): Promise<void> {
        try {
            // Try to use VS Code's secure storage
            if (window.vscode?.postMessage) {
                return new Promise((resolve) => {
                    const messageHandler = (event: MessageEvent) => {
                        const message = event.data
                        if (message.type === 'password:delete:response') {
                            window.removeEventListener('message', messageHandler)
                            resolve()
                        }
                    }
                    
                    window.addEventListener('message', messageHandler)
                    window.vscode.postMessage({
                        type: 'password:delete',
                        data: { service, account }
                    })
                })
            }
            
            // Fallback to localStorage
            const key = `agentica:password:${service}:${account}`
            localStorage.removeItem(key)
        } catch (error) {
            console.error('Failed to delete password:', error)
        }
    }
}

// Simple localStorage fallback
class LocalPasswordStorage implements PasswordStorage {
    async getPassword(service: string, account: string): Promise<string | null> {
        try {
            const key = `agentica:password:${service}:${account}`
            return localStorage.getItem(key)
        } catch {
            return null
        }
    }

    async setPassword(service: string, account: string, password: string): Promise<void> {
        try {
            const key = `agentica:password:${service}:${account}`
            localStorage.setItem(key, password)
        } catch (error) {
            console.error('Failed to store password:', error)
        }
    }

    async deletePassword(service: string, account: string): Promise<void> {
        try {
            const key = `agentica:password:${service}:${account}`
            localStorage.removeItem(key)
        } catch (error) {
            console.error('Failed to delete password:', error)
        }
    }
}

// Export the appropriate storage based on environment
export const passwordStorage: PasswordStorage = typeof window !== 'undefined' && window.vscode?.postMessage
    ? new SecurePasswordStorage()
    : new LocalPasswordStorage()

export { PasswordStorage }