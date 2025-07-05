import type { Page } from "@playwright/test"

/**
 * Log filtering configuration
 */
const LOG_CONFIG = {
	// Enable verbose logging for debugging (set via environment variable)
	verbose: process.env.PLAYWRIGHT_VERBOSE_LOGS === "true",

	// Patterns to completely ignore - only very generic/annoying ones
	ignorePatterns: [
		// Incomplete console messages (just line numbers)
		/(^|\[)\d+:\d+\/\d+:\d+\.\d+:INFO:CONSOLE(\(\d+\))?(\]?\s*$)?/,

		// Empty or incomplete console messages
		/^\s*$/,
		/^Extension: \s*$/,

		// Very annoying deprecation warnings
		/DeprecationWarning: The `punycode` module is deprecated/,

		// VSCode internal noise that's very generic
		/Failed to connect to PrepareForShutdown/,
		/Failed to connect to PrepareForSleep/,
		/org\.freedesktop\.login1 not available/,
		/power_observer_linux\.cc/,

		// Very repetitive debug patterns
		/\[previous line repeated \d+ additional times\]/,
	],

	// Patterns to show but clean up
	cleanupPatterns: [
		// Extension host messages - extract the actual message
		{
			pattern: /%c\[Extension Host\] %c(.+?) %c\(at console\.<anonymous>/,
			replacement: "Extension: $1",
		},
		// Remove all color formatting artifacts
		{
			pattern: /%c/g,
			replacement: "",
		},
		{
			pattern: /color: [^,\s)]+/g,
			replacement: "",
		},
		{
			pattern: /\s+color:\s*/g,
			replacement: " ",
		},
		// Remove file path noise
		{
			pattern: /\(file:\/\/\/[^)]+\)/g,
			replacement: "",
		},
		{
			pattern: /\(at console\.<anonymous> [^)]+\)/g,
			replacement: "",
		},
		// Shorten long file paths
		{
			pattern:
				/vscode-file:\/\/vscode-app\/[^\/]*\/apps\/playwright-e2e\/\.vscode-test\/[^\/]+\/resources\/app\/out\/vs\/workbench\/[^)]+\)/g,
			replacement: "(vscode-workbench)",
		},
		{
			pattern: /[^\/]*\/apps\/playwright-e2e\/\.vscode-test\/[^\/]+\/[^\/]+\/[^\/]+/g,
			replacement: "/.../vscode-test",
		},
		// Clean up source references
		{
			pattern: /source: vscode-file:\/\/[^\s]+/g,
			replacement: "",
		},
		// Clean up extension host references
		{
			pattern: /\[Extension Host\]\s*/g,
			replacement: "",
		},
		// Remove extra whitespace
		{
			pattern: /\s{2,}/g,
			replacement: " ",
		},
		// Clean up trailing spaces and commas
		{
			pattern: /\s*,\s*$/g,
			replacement: "",
		},
		// Clean up remaining color artifacts and parentheses
		{
			pattern: /\s*\)\s*,?\s*$/g,
			replacement: "",
		},
		{
			pattern: /\s*\(\d+\)\s*$/g,
			replacement: "",
		},
		// Clean up remaining file references
		{
			pattern: /\(at file:\/\/[^)]+\)/g,
			replacement: "",
		},
		// Clean up remaining color string artifacts
		{
			pattern: /\s*\)\s*,\s*\(\d+.*$/g,
			replacement: "",
		},
		{
			pattern: /\s*\)\s*\[.*$/g,
			replacement: "",
		},
		{
			pattern: /\s*\(\d+.*$/g,
			replacement: "",
		},
		// Clean up trailing punctuation artifacts
		{
			pattern: /\s*[\)\],;:\.\-_\|\\\/*\+=<>\?!@#\$%\^&]+\s*$/g,
			replacement: "",
		},
	],
}

export const cleanLogMessage = (message: string): string | null => {
	if (LOG_CONFIG.ignorePatterns.some((pattern) => pattern.test(message))) {
		return null
	}

	let cleaned = message
	for (const { pattern, replacement } of LOG_CONFIG.cleanupPatterns) {
		cleaned = cleaned.replace(pattern, replacement)
	}

	return cleaned?.trim() ?? null
}

export const setupConsoleLogging = (page: Page, prefix: string): void => {
	page.on("console", (msg) => {
		const text = msg.text()
		const cleaned = cleanLogMessage(text)
		if (cleaned) {
			console.log(`[${prefix}] ${cleaned}`)
		}
	})

	page.on("pageerror", (error) => {
		const cleaned = cleanLogMessage(error.message)
		if (cleaned) {
			console.log(`❌ [${prefix}] ${cleaned}`)
		}
	})

	page.on("requestfailed", (request) => {
		const url = request.url()
		const failure = request.failure()
		if (failure) {
			const message = `${request.method()} ${url} - ${failure.errorText}`
			const cleaned = cleanLogMessage(message)
			if (cleaned) {
				console.log(`🚫 [${prefix} REQUEST FAILED] ${cleaned}`)
			}
		}
	})
}
