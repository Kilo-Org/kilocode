import { z } from "zod"

/**
 * Device authorization response from initiate endpoint
 */
export const DeviceAuthInitiateResponseSchema = z.object({
	/** Verification code to display to user */
	code: z.string(),
	/** URL for user to visit in browser */
	verificationUrl: z.string(),
	/** Time in seconds until code expires */
	expiresIn: z.number(),
})

export type DeviceAuthInitiateResponse = z.infer<typeof DeviceAuthInitiateResponseSchema>

/**
 * Device authorization poll response
 */
export const DeviceAuthPollResponseSchema = z.object({
	/** Current status of the authorization */
	status: z.enum(["pending", "approved", "denied", "expired"]),
	/** API token (only present when approved) */
	token: z.string().optional(),
	/** User ID (only present when approved) */
	userId: z.string().optional(),
	/** User email (only present when approved) */
	userEmail: z.string().optional(),
})

export type DeviceAuthPollResponse = z.infer<typeof DeviceAuthPollResponseSchema>

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
