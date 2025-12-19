// kilocode_change: new file
import { TOOL_ALIASES } from "./tools"

/**
 * Lightweight tool-alias resolver.
 *
 * IMPORTANT: This module must stay free of imports from `src/core/**` to avoid
 * circular dependencies (e.g. providers -> core -> tools -> providers).
 */

// Reverse lookup map (alias -> canonical), built once.
const ALIAS_TO_CANONICAL: Map<string, string> = new Map(
	Object.entries(TOOL_ALIASES).map(([alias, canonical]) => [alias, canonical]),
)

/**
 * Resolves a tool name to its canonical name.
 * If the tool name is an alias, returns the canonical tool name.
 * If it's already a canonical name or unknown, returns as-is.
 */
export function resolveToolAlias(toolName: string): string {
	return ALIAS_TO_CANONICAL.get(toolName) ?? toolName
}
