// kilocode_change - new file
/**
 * Performance Configuration for Context Engine
 *
 * Optimized settings to prevent task queue deadline exceeded warnings
 */

import type { ContextEngineConfig } from "./engine"
import type { ParseOptions } from "./ast-parser"

/**
 * Performance-optimized configuration for Context Engine
 */
export const PERFORMANCE_CONFIG: Partial<ContextEngineConfig> = {
	// Reduce file size limit to prevent large file processing delays
	maxFileSize: 512 * 1024, // 512KB instead of 1MB

	// Increase debounce delay to batch more changes together
	debounceDelay: 1000, // 1 second instead of 500ms

	// Reduce memory usage threshold
	maxMemoryUsage: 0.5, // 50% instead of 70%

	// Reduce retry attempts to fail faster
	maxRetries: 2, // 2 instead of 3

	// Add more exclusions for performance
	excludedPaths: [
		"node_modules",
		".git",
		"dist",
		"build",
		".next",
		"coverage",
		".turbo",
		".cache",
		"__pycache__",
		".pytest_cache",
		".vscode",
		".idea",
	],
}

/**
 * Performance-optimized parse options
 */
export const PERFORMANCE_PARSE_OPTIONS: ParseOptions = {
	// Reduce file size limit for parsing
	maxFileSize: 256 * 1024, // 256KB for individual file parsing

	// Skip docstrings for better performance
	includeDocstrings: false,

	// Skip private members for better performance
	includePrivate: false,
}

/**
 * Lightweight configuration for development mode
 */
export const DEV_CONFIG: Partial<ContextEngineConfig> = {
	...PERFORMANCE_CONFIG,

	// Even more aggressive limits for development
	maxFileSize: 256 * 1024, // 256KB
	debounceDelay: 2000, // 2 seconds
	maxMemoryUsage: 0.4, // 40%
}

/**
 * Get configuration based on environment
 */
export function getOptimalConfig(): Partial<ContextEngineConfig> {
	const isDev = process.env.NODE_ENV === "development"
	return isDev ? DEV_CONFIG : PERFORMANCE_CONFIG
}

/**
 * Check if current system can handle full context engine
 */
export function shouldEnableContextEngine(): boolean {
	// Check available memory (rough estimate)
	if (typeof process !== "undefined" && process.memoryUsage) {
		const memory = process.memoryUsage()
		const availableMemory = memory.heapTotal - memory.heapUsed

		// Require at least 100MB available memory
		return availableMemory > 100 * 1024 * 1024
	}

	// Default to enabled if we can't check
	return true
}
