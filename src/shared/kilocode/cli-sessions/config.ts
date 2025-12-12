/**
 * Centralized configuration for the CLI sessions module.
 *
 * This file contains all configurable constants used across the session management
 * services. Centralizing these values makes them easier to manage, test, and
 * potentially override for different environments.
 */

/**
 * Configuration interface for the session manager module.
 */
export interface SessionManagerConfig {
	/**
	 * Configuration for the sync queue behavior.
	 */
	sync: {
		/**
		 * Number of items in the queue that triggers an automatic flush.
		 * When the queue length exceeds this threshold, a sync operation is initiated.
		 */
		queueFlushThreshold: number
	}

	/**
	 * Configuration for session title generation.
	 */
	title: {
		/**
		 * Maximum allowed length for a session title.
		 * Titles longer than this will be truncated.
		 */
		maxLength: number

		/**
		 * Length to truncate titles to when they exceed maxLength.
		 * This is typically maxLength - 3 to account for the "..." suffix.
		 */
		truncatedLength: number

		/**
		 * Timeout in milliseconds for LLM-based title generation.
		 * If the LLM doesn't respond within this time, falls back to truncation.
		 */
		llmTimeoutMs: number
	}

	/**
	 * Configuration for git state handling.
	 */
	git: {
		/**
		 * Maximum size in bytes for git patches.
		 * Patches larger than this will be skipped to avoid performance issues.
		 */
		maxPatchSizeBytes: number
	}
}

/**
 * Default configuration values for the session manager module.
 *
 * These values are used unless explicitly overridden. They represent
 * sensible defaults for typical usage scenarios.
 */
export const DEFAULT_CONFIG: SessionManagerConfig = {
	sync: {
		queueFlushThreshold: 5,
	},
	title: {
		maxLength: 140,
		truncatedLength: 137,
		llmTimeoutMs: 30000,
	},
	git: {
		maxPatchSizeBytes: 5 * 1024 * 1024, // 5 MB
	},
}

/**
 * Centralized log source identifiers for consistent logging across the CLI sessions module.
 * Using constants prevents typos and makes it easy to filter logs by component.
 */
export const LOG_SOURCES = {
	SESSION_MANAGER: "SessionManager",
	SESSION_SYNC: "SessionSyncService",
	SESSION_LIFECYCLE: "SessionLifecycleService",
	TOKEN_VALIDATION: "TokenValidationService",
	GIT_STATE: "GitStateService",
	SESSION_TITLE: "SessionTitleService",
} as const

export type LogSource = (typeof LOG_SOURCES)[keyof typeof LOG_SOURCES]
