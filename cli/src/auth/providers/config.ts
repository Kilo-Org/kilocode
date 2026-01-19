/**
 * Providers that should NOT use the generic auth system
 * These have custom authentication flows that require special handling
 */
export const CUSTOM_AUTH_PROVIDERS: Set<string> = new Set([
	"kilocode", // Has device auth and token auth variants
	"other", // Opens config file manually (not a ProviderName, but an auth provider value)
	"vscode-lm", // Uses VSCode's built-in auth
	"fake-ai", // No auth needed - testing only
	"roo", // Special case - no API key required
	"virtual-quota-fallback", // Complex nested config with multiple profiles
])

/**
 * Check if a provider should use generic auth
 * @param provider - Provider name or auth provider value to check
 * @returns True if provider should use the generic auth system
 */
export function shouldUseGenericAuth(provider: string): boolean {
	return !CUSTOM_AUTH_PROVIDERS.has(provider)
}
