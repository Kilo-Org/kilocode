import { z } from "zod"
import type { ProviderConfig } from "../config/provider.js"

/**
 * Organization data from Kilocode API
 */
export const kilocodeOrganizationSchema = z.object({
	id: z.string(),
	name: z.string(),
	role: z.string(),
})

/**
 * Profile data structure from Kilocode API
 */
export const kilocodeProfileDataSchema = z.object({
	user: z
		.object({
			name: z.string().optional(),
			email: z.string().optional(),
			image: z.string().optional(),
		})
		.optional(),
	organizations: z.array(kilocodeOrganizationSchema).optional(),
})

/**
 * Options for polling operations
 */
export const pollingOptionsSchema = z.object({
	/** Interval between polls in milliseconds */
	interval: z.number(),
	/** Maximum number of attempts before timeout */
	maxAttempts: z.number(),
	/** Function to execute on each poll */
	pollFn: z.function({ input: z.tuple([]), output: z.promise(z.unknown()) }),
	/** Optional callback for progress updates */
	onProgress: z.function({ input: z.tuple([z.number(), z.number()]), output: z.void() }).optional(),
})

/**
 * Result of a poll operation
 */
export const pollResultSchema = z.object({
	/** Whether polling should continue */
	continue: z.boolean(),
	/** Optional data returned when polling completes */
	data: z.unknown().optional(),
	/** Optional error if polling failed */
	error: z.instanceof(Error).optional(),
})

// Inferred types
export type KilocodeOrganization = z.infer<typeof kilocodeOrganizationSchema>
export type KilocodeProfileData = z.infer<typeof kilocodeProfileDataSchema>
export type PollingOptions = z.infer<typeof pollingOptionsSchema>
export type PollResult = z.infer<typeof pollResultSchema>

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
