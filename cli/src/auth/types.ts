/**
 * Authentication Types
 *
 * Re-exports types from @kilocode/core-schemas for runtime validation
 * and backward compatibility with existing code.
 */

import type { ProviderConfig } from "../config/types.js"

// Re-export Kilocode schemas from core-schemas
export { kilocodeOrganizationSchema, kilocodeProfileDataSchema } from "@kilocode/core-schemas"

// Re-export Kilocode types from core-schemas
export type { KilocodeOrganization, KilocodeProfileData } from "@kilocode/core-schemas"

// Device auth (from @roo-code/types via core-schemas)
export {
	DeviceAuthInitiateResponseSchema,
	DeviceAuthPollResponseSchema,
	type DeviceAuthInitiateResponse,
	type DeviceAuthPollResponse,
	type DeviceAuthState,
} from "@kilocode/core-schemas"

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
