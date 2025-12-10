import { useExtensionState } from "@/context/ExtensionStateContext"

/**
 * Hook to get the Kilo user identity for telemetry.
 * Returns the user's email if authenticated with Kilocode, otherwise returns the machine ID.
 *
 * The Kilo user is resolved globally based on priority rules:
 * 1. Active profile if it's a kilocode provider
 * 2. First kilocode provider found in profiles list
 * 3. Fallback to unauthenticated (uses machineId)
 */
export function useKiloIdentity(machineId: string) {
	const { kiloUser } = useExtensionState()

	// If we have a global kilo user with email, use that for telemetry identity
	// Otherwise fall back to machineId
	return kiloUser?.email || machineId
}
