// kilocode_change - new file

/**
 * All discoverable configuration types that affect agent behavior.
 * These are things that can be discovered from .kilocode directories.
 */
export type ContextConfigType = "skill" | "workflow" | "command" | "rule" | "mcp"

/**
 * Represents a single configuration change (added or removed).
 */
export interface ContextConfigChange {
	/** What kind of configType this is */
	configType: ContextConfigType
	/** Whether this item was added or removed */
	changeType: "added" | "removed"
	/** Name/identifier of the item */
	name: string
	/** Where was it discovered: global (~/.kilocode) or project (.kilocode) */
	source: "global" | "project"
	/** Optional mode for mode-specific configs (e.g., 'code', 'architect') */
	mode?: string
	/** Optional file path for "click to open" functionality */
	filePath?: string
}
