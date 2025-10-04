/**
 * Shared Ghost strategy definitions
 * Used by both backend services and webview components
 */

export interface GhostStrategyInfo {
	id: string // Ghost Strategy ID (e.g., "xml-default")
	name: string // Display name (e.g., "XML-based Strategy")
	description: string // User-friendly description
}

export const AVAILABLE_GHOST_STRATEGIES: GhostStrategyInfo[] = [
	{
		id: "xml-default",
		name: "XML-based Strategy",
		description: "Default XML-based code generation strategy",
	},
	// Future strategies will be added here
]

export const DEFAULT_GHOST_STRATEGY_ID = AVAILABLE_GHOST_STRATEGIES[0].id
