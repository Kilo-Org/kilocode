import * as vscode from "vscode"
import { AgenticaConstants } from "../../constants/AgenticaConstants"
import { AgenticaTypes } from "../../types/AgenticaTypes"
import { storeToken, getStoredToken, clearStoredToken } from "../../utils/auth"

export class AgenticaService {
    private _context: vscode.ExtensionContext
    private _baseUrl: string = AgenticaConstants.BASE_URL
    private _apiKey: string | null = null

    constructor(context: vscode.ExtensionContext) {
        this._context = context
        this._apiKey = getStoredToken(context)
    }

    async login(credentials: { email: string; password: string }): Promise<AgenticaTypes.LoginResponse> {
        try {
            const response = await fetch(`${this._baseUrl}/auth/login`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(credentials)
            })

            if (!response.ok) {
                throw new Error(`Login failed: ${response.statusText}`)
            }

            const data: AgenticaTypes.LoginResponse = await response.json()
            
            if (data.token) {
                storeToken(this._context, data.token)
                this._apiKey = data.token
            }

            return data
        } catch (error) {
            throw new Error(`Login error: ${error instanceof Error ? error.message : "Unknown error"}`)
        }
    }

    async upgrade(data: { plan: string }): Promise<AgenticaTypes.UpgradeResponse> {
        if (!this._apiKey) {
            throw new Error("Not authenticated")
        }

        try {
            const response = await fetch(`${this._baseUrl}/billing/upgrade`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${this._apiKey}`
                },
                body: JSON.stringify(data)
            })

            if (!response.ok) {
                throw new Error(`Upgrade failed: ${response.statusText}`)
            }

            return await response.json()
        } catch (error) {
            throw new Error(`Upgrade error: ${error instanceof Error ? error.message : "Unknown error"}`)
        }
    }

    async getStatus(): Promise<AgenticaTypes.StatusResponse> {
        if (!this._apiKey) {
            return { isLoggedIn: false }
        }

        try {
            const response = await fetch(`${this._baseUrl}/user/status`, {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${this._apiKey}`
                }
            })

            if (!response.ok) {
                if (response.status === 401) {
                    clearStoredToken(this._context)
                    this._apiKey = null
                    return { isLoggedIn: false }
                }
                throw new Error(`Status check failed: ${response.statusText}`)
            }

            const data = await response.json()
            return {
                isLoggedIn: true,
                user: data.user,
                subscription: data.subscription
            }
        } catch (error) {
            return { isLoggedIn: false }
        }
    }

    async refreshToken(): Promise<string | null> {
        if (!this._apiKey) {
            return null
        }

        try {
            const response = await fetch(`${this._baseUrl}/auth/refresh`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${this._apiKey}`
                }
            })

            if (!response.ok) {
                throw new Error(`Token refresh failed: ${response.statusText}`)
            }

            const data: AgenticaTypes.LoginResponse = await response.json()
            
            if (data.token) {
                storeToken(this._context, data.token)
                this._apiKey = data.token
                return data.token
            }

            return null
        } catch (error) {
            clearStoredToken(this._context)
            this._apiKey = null
            return null
        }
    }

    getApiKey(): string | null {
        return this._apiKey
    }

    isAuthenticated(): boolean {
        return this._apiKey !== null
    }

    async logout(): Promise<void> {
        clearStoredToken(this._context)
        this._apiKey = null
    }
}