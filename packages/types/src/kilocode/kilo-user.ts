/**
 * KiloUser represents the globally resolved Kilo Code user based on profile priority rules.
 * This is used for telemetry identity and authentication status across the extension.
 */
export interface KiloUser {
	/**
	 * Where the user was resolved from based on priority rules:
	 * - "active-profile": The current active profile is a kilocode provider
	 * - "other-profile": Found from the first kilocode provider in profiles list
	 * - "none": No kilocode provider found
	 */
	source: "active-profile" | "other-profile" | "none"

	/**
	 * The name of the profile the user was resolved from.
	 * Undefined if source is "none".
	 */
	profileName: string | undefined

	/**
	 * The user's email address, used for telemetry identity.
	 * Undefined if not authenticated or if source is "none".
	 */
	email: string | undefined

	/**
	 * Whether the user is authenticated with a valid Kilo Code account.
	 * True if we have a valid token and successfully fetched user data.
	 */
	isAuthenticated: boolean
}

/**
 * Default/empty KiloUser state when no kilocode provider is configured
 */
export const EMPTY_KILO_USER: KiloUser = {
	source: "none",
	profileName: undefined,
	email: undefined,
	isAuthenticated: false,
}
