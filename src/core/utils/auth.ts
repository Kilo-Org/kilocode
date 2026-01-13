import * as vscode from "vscode"

const TOKEN_KEY = "agentica.auth.token"

export function storeToken(context: vscode.ExtensionContext, token: string): void {
    context.globalState.update(TOKEN_KEY, token)
}

export function getStoredToken(context: vscode.ExtensionContext): string | null {
    return context.globalState.get(TOKEN_KEY) as string | null
}

export function clearStoredToken(context: vscode.ExtensionContext): void {
    context.globalState.update(TOKEN_KEY, undefined)
}

export function isTokenValid(token: string): boolean {
    if (!token) return false
    
    // Basic token validation - check if it looks like a JWT
    const parts = token.split('.')
    if (parts.length !== 3) return false
    
    try {
        // Try to decode the header part
        const header = JSON.parse(Buffer.from(parts[0], 'base64').toString())
        return header && typeof header === 'object' && header.typ === 'JWT'
    } catch {
        return false
    }
}