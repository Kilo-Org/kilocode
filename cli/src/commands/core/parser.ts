/**
 * Command parser - parses user input into commands and arguments
 */

import type { ParsedCommand } from "./types.js"

/**
 * Parse a command string into its components
 * Examples:
 *   "/help" -> { command: "help", args: [], options: {} }
 *   "/mode code" -> { command: "mode", args: ["code"], options: {} }
 *   "/settings --provider anthropic" -> { command: "settings", args: [], options: { provider: "anthropic" } }
 */
export function parseCommand(input: string): ParsedCommand | null {
	// Remove leading slash and trim
	const trimmed = input.trim()
	if (!trimmed.startsWith("/")) {
		return null
	}

	const withoutSlash = trimmed.slice(1)
	if (!withoutSlash) {
		return null
	}

	// Split by spaces, but respect quotes
	const tokens = tokenize(withoutSlash)
	if (tokens.length === 0) {
		return null
	}

	const command = tokens[0]
	if (!command) {
		return null
	}

	const rest = tokens.slice(1)

	// Parse options (--flag or -f)
	const options: Record<string, string | number | boolean> = {}
	const args: string[] = []

	for (let i = 0; i < rest.length; i++) {
		const token = rest[i]
		if (!token) continue

		if (token.startsWith("--")) {
			// Long option: --name value or --name=value
			const optionName = token.slice(2)
			if (optionName.includes("=")) {
				const [name, value] = optionName.split("=", 2)
				if (name && value !== undefined) {
					options[name] = parseValue(value)
				}
			} else if (i + 1 < rest.length) {
				const nextToken = rest[i + 1]
				if (nextToken && !nextToken.startsWith("-")) {
					// Next token is the value
					options[optionName] = parseValue(nextToken)
					i++ // Skip next token
				} else {
					// Boolean flag
					options[optionName] = true
				}
			} else {
				// Boolean flag
				options[optionName] = true
			}
		} else if (token.startsWith("-") && token.length === 2) {
			// Short option: -f value or -f
			const optionName = token.slice(1)
			if (i + 1 < rest.length) {
				const nextToken = rest[i + 1]
				if (nextToken && !nextToken.startsWith("-")) {
					options[optionName] = parseValue(nextToken)
					i++
				} else {
					options[optionName] = true
				}
			} else {
				options[optionName] = true
			}
		} else {
			// Regular argument
			args.push(token)
		}
	}

	return {
		command,
		args,
		options,
	}
}

/**
 * Tokenize a string, respecting quotes
 */
function tokenize(input: string): string[] {
	const tokens: string[] = []
	let current = ""
	let inQuotes = false
	let quoteChar = ""

	for (let i = 0; i < input.length; i++) {
		const char = input[i]

		if ((char === '"' || char === "'") && !inQuotes) {
			inQuotes = true
			quoteChar = char
		} else if (char === quoteChar && inQuotes) {
			inQuotes = false
			quoteChar = ""
		} else if (char === " " && !inQuotes) {
			if (current) {
				tokens.push(current)
				current = ""
			}
		} else {
			current += char
		}
	}

	if (current) {
		tokens.push(current)
	}

	return tokens
}

/**
 * Parse a value string into its appropriate type
 */
function parseValue(value: string): string | number | boolean {
	// Try to parse as number
	if (/^-?\d+$/.test(value)) {
		return parseInt(value, 10)
	}
	if (/^-?\d+\.\d+$/.test(value)) {
		return parseFloat(value)
	}

	// Try to parse as boolean
	if (value === "true") return true
	if (value === "false") return false

	// Return as string
	return value
}

/**
 * Extract command name from input (without parsing full command)
 */
export function extractCommandName(input: string): string | null {
	const trimmed = input.trim()
	if (!trimmed.startsWith("/")) {
		return null
	}

	const withoutSlash = trimmed.slice(1)
	const spaceIndex = withoutSlash.indexOf(" ")

	if (spaceIndex === -1) {
		return withoutSlash || null
	}

	return withoutSlash.slice(0, spaceIndex) || null
}
