/**
 * Sync codebase index configuration to global state
 *
 * This module provides a function to sync the CLI's codebase index configuration
 * to a global state that can be read by the extension host.
 */

import type { CodebaseIndexConfig } from "@roo-code/types"

// Global state for codebase index config that can be read by extension
declare global {
	// eslint-disable-next-line no-var
	var __codebaseIndexConfig: CodebaseIndexConfig | undefined
}

/**
 * Sync codebase index configuration to global state
 * This allows the extension host to read the CLI's codebase index settings
 */
export function syncCodebaseIndexConfigToGlobalState(config?: CodebaseIndexConfig): void {
	if (config) {
		globalThis.__codebaseIndexConfig = config
	}
}

/**
 * Get the current codebase index configuration from global state
 */
export function getCodebaseIndexConfigFromGlobalState(): CodebaseIndexConfig | undefined {
	return globalThis.__codebaseIndexConfig
}
