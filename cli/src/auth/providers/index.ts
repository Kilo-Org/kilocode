import type { AuthProvider } from "../types.js"
import type { ProviderName } from "../../types/messages.js"
import { kilocodeDeviceAuthProvider, kilocodeTokenAuthProvider } from "./kilocode/index.js"
import { otherProvider } from "./other/index.js"
import { createGenericAuthProvider } from "./factory.js"
import { shouldUseGenericAuth } from "./config.js"
import { PROVIDER_LABELS } from "../../constants/providers/labels.js"

/**
 * Registry of all available authentication providers
 * Ordered by priority (most recommended first)
 */
export const authProviders: AuthProvider[] = [
	// Special providers with custom authentication flows
	kilocodeDeviceAuthProvider, // Recommended: Browser-based device auth
	kilocodeTokenAuthProvider, // Advanced: Manual token entry

	// Auto-generate providers for all others that support generic auth
	...Object.keys(PROVIDER_LABELS)
		.filter((provider) => shouldUseGenericAuth(provider))
		.map((provider) => createGenericAuthProvider(provider as ProviderName)),

	// Manual configuration (always last)
	otherProvider, // Special: Opens config file for manual editing
]

/**
 * Get a provider by its value
 * @param value The provider value to look up
 * @returns The provider or undefined if not found
 */
export function getProviderByValue(value: string): AuthProvider | undefined {
	return authProviders.find((provider) => provider.value === value)
}
