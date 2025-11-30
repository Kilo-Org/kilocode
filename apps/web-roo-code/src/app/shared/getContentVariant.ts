import type { AgentPageContent } from "./agent-page-content"

/**
 * Selects the appropriate content variant based on the query parameter.
 *
 * @param searchParams - The search parameters from the page props
 * @param variants - A record mapping variant letters to content objects
 * @returns The selected content variant, defaulting to variant 'A' if not found or invalid
 *
 * @example
 * ```tsx
 * const content = getContentVariant(searchParams, {
 *   A: contentA,
 *   B: contentB,
 *   C: contentC,
 * })
 * ```
 */
export function getContentVariant(
	searchParams: { v?: string },
	variants: Record<string, AgentPageContent>,
): AgentPageContent {
	const variant = searchParams.v?.toUpperCase()

	// Return the specified variant if it exists, otherwise default to 'A'
	if (variant && variants[variant]) {
		return variants[variant]
	}

	// Ensure 'A' variant always exists as fallback
	if (!variants.A) {
		throw new Error("Content variants must include variant 'A' as the default")
	}

	return variants.A
}
