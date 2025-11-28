import type { ProviderConfig } from "../config/types.js"

/**
 * Result of a successful authentication flow
 */
export interface AuthResult {
	providerConfig: ProviderConfig
}

/**
 * Base interface for all authentication providers
 */
export interface AuthProvider {
	/** Display name shown to users */
	name: string
	/** Unique identifier for the provider */
	value: string
	/** Execute the authentication flow */
	authenticate(): Promise<AuthResult>
}

/**
 * Device authorization response from initiate endpoint
 */
export interface DeviceAuthInitiateResponse {
	/** Verification code to display to user */
	code: string
	/** URL for user to visit in browser */
	verificationUrl: string
	/** Time in seconds until code expires */
	expiresIn: number
}

/**
 * Device authorization poll response
 */
export interface DeviceAuthPollResponse {
	/** Current status of the authorization */
	status: "pending" | "approved" | "denied" | "expired"
	/** API token (only present when approved) */
	token?: string
	/** User ID (only present when approved) */
	userId?: string
	/** User email (only present when approved) */
	userEmail?: string
}

/**
 * Organization data from Kilocode API
 */
export interface KilocodeOrganization {
	id: string
	name: string
	role: string
}

/**
 * Profile data structure from Kilocode API
 */
export interface KilocodeProfileData {
	user?: {
		name?: string
		email?: string
		image?: string
	}
	organizations?: KilocodeOrganization[]
}

/**
 * Options for polling operations
 */
export interface PollingOptions {
	/** Interval between polls in milliseconds */
	interval: number
	/** Maximum number of attempts before timeout */
	maxAttempts: number
	/** Function to execute on each poll */
	pollFn: () => Promise<PollResult>
	/** Optional callback for progress updates */
	onProgress?: (attempt: number, maxAttempts: number) => void
}

/**
 * Result of a poll operation
 */
export interface PollResult {
	/** Whether polling should continue */
	continue: boolean
	/** Optional data returned when polling completes */
	data?: unknown
	/** Optional error if polling failed */
	error?: Error
}
