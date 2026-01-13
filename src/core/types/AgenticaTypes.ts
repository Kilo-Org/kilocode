export namespace AgenticaTypes {
    export interface LoginRequest {
        email: string
        password: string
    }

    export interface LoginResponse {
        token: string
        user: {
            id: string
            email: string
            name?: string
        }
        expiresAt?: string
    }

    export interface UpgradeRequest {
        plan: string
        coupon?: string
    }

    export interface UpgradeResponse {
        success: boolean
        message: string
        subscription: {
            plan: string
            status: string
            expiresAt?: string
        }
    }

    export interface StatusResponse {
        isLoggedIn: boolean
        user?: {
            id: string
            email: string
            name?: string
        }
        subscription?: {
            plan: string
            status: string
            expiresAt?: string
        }
    }

    export interface User {
        id: string
        email: string
        name?: string
        avatar?: string
    }

    export interface Subscription {
        plan: string
        status: string
        expiresAt?: string
        features: string[]
    }

    export interface ErrorResponse {
        error: string
        code?: string
        details?: any
    }
}