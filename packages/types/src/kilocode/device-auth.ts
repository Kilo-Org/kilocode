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
 * Device auth state for UI
 */
export interface DeviceAuthState {
	/** Current status of the auth flow */
	status: "idle" | "initiating" | "pending" | "polling" | "success" | "error" | "cancelled"
	/** Verification code */
	code?: string
	/** URL to visit for verification */
	verificationUrl?: string
	/** Expiration time in seconds */
	expiresIn?: number
	/** Error message if failed */
	error?: string
	/** Time remaining in seconds */
	timeRemaining?: number
	/** User email when successful */
	userEmail?: string
}
