// kilocode_change - new file

/**
 * Cache entry for discovered workflows
 */
export interface WorkflowCacheEntry {
	workflows: DiscoveredWorkflow[]
	timestamp: number
}

/**
 * Metadata about a discovered workflow
 */
export interface DiscoveredWorkflow {
	/** Workflow name (from filename without .md extension) */
	name: string
	/** Command name with / prefix (e.g., "/analyze-codebase") */
	commandName: string
	/** Short description from YAML frontmatter (truncated to 30 words) */
	description?: string
	/** Arguments hint from YAML frontmatter */
	arguments?: string
	/** Full path to the workflow file */
	filePath: string
	/** Origin location */
	source: "global" | "workspace"
	/** Whether workflow is currently enabled */
	enabled: boolean
}

/**
 * Parsed frontmatter from workflow file
 */
export interface WorkflowFrontmatter {
	description?: string
	arguments?: string
	[key: string]: unknown
}

/**
 * Configuration for workflow discovery
 */
export interface WorkflowDiscoveryConfig {
	/** Whether to include global workflows */
	includeGlobal: boolean
	/** Whether to include workspace workflows */
	includeWorkspace: boolean
	/** Whether to cache discovered workflows */
	enableCache: boolean
	/** Cache TTL in milliseconds */
	cacheTtlMs: number
}

/**
 * Result of workflow discovery operation
 */
export interface WorkflowDiscoveryResult {
	/** All discovered workflows */
	workflows: DiscoveredWorkflow[]
	/** Number of global workflows */
	globalCount: number
	/** Number of workspace workflows */
	workspaceCount: number
	/** Whether cache was used */
	fromCache: boolean
}
