import { parse } from "shell-quote"
// kilocode_change start
import {
	protectNewlinesInQuotes,
	restoreNewlinesFromPlaceholders,
	NEWLINE_PLACEHOLDER,
	CARRIAGE_RETURN_PLACEHOLDER,
} from "./quote-protection"
// kilocode_change end

export type ShellToken = string | { op: string } | { command: string }

/**
 * Split a command string into individual sub-commands by
 * chaining operators (&&, ||, ;, |, or &) and newlines.
 *
 * Uses shell-quote to properly handle:
 * - Quoted strings (preserves quotes and newlines within quotes)
 * - Subshell commands ($(cmd), `cmd`, <(cmd), >(cmd))
 * - PowerShell redirections (2>&1)
 * - Chain operators (&&, ||, ;, |, &)
 * - Newlines as command separators (but not within quotes)
 */
export function parseCommand(command: string): string[] {
	if (!command?.trim()) {
		return []
	}

	// kilocode_change start
	// First, protect newlines inside quoted strings by replacing them with placeholders
	// This prevents splitting multi-line quoted strings (e.g., git commit -m "multi\nline")
	const protectedCommand = protectNewlinesInQuotes(command, NEWLINE_PLACEHOLDER, CARRIAGE_RETURN_PLACEHOLDER)

	// Split by newlines (handle different line ending formats)
	// This regex splits on \r\n (Windows), \n (Unix), or \r (old Mac)
	const lines = protectedCommand.split(/\r\n|\r|\n/)
	// kilocode_change end
	const allCommands: string[] = []

	for (const line of lines) {
		// Skip empty lines
		if (!line.trim()) {
			continue
		}

		// Process each line through the existing parsing logic
		const lineCommands = parseCommandLine(line)
		allCommands.push(...lineCommands)
	}

	// kilocode_change start
	// Restore newlines and carriage returns in quoted strings
	return allCommands.map((cmd) =>
		restoreNewlinesFromPlaceholders(cmd, NEWLINE_PLACEHOLDER, CARRIAGE_RETURN_PLACEHOLDER),
	)
	// kilocode_change end
}

/**
 * Parse a single line of commands.
 */
function parseCommandLine(command: string): string[] {
	if (!command?.trim()) return []

	// Storage for replaced content
	const redirections: string[] = []
	const subshells: string[] = []
	const quotes: string[] = []
	const arrayIndexing: string[] = []
	const arithmeticExpressions: string[] = []
	const variables: string[] = []
	const parameterExpansions: string[] = []

	// First handle PowerShell redirections by temporarily replacing them
	let processedCommand = command.replace(/\d*>&\d*/g, (match) => {
		redirections.push(match)
		return `__REDIR_${redirections.length - 1}__`
	})

	// Handle arithmetic expressions: $((...)) pattern
	// Match the entire arithmetic expression including nested parentheses
	processedCommand = processedCommand.replace(/\$\(\([^)]*(?:\)[^)]*)*\)\)/g, (match) => {
		arithmeticExpressions.push(match)
		return `__ARITH_${arithmeticExpressions.length - 1}__`
	})

	// Handle $[...] arithmetic expressions (alternative syntax)
	processedCommand = processedCommand.replace(/\$\[[^\]]*\]/g, (match) => {
		arithmeticExpressions.push(match)
		return `__ARITH_${arithmeticExpressions.length - 1}__`
	})

	// Handle parameter expansions: ${...} patterns (including array indexing)
	// This covers ${var}, ${var:-default}, ${var:+alt}, ${#var}, ${var%pattern}, etc.
	processedCommand = processedCommand.replace(/\$\{[^}]+\}/g, (match) => {
		parameterExpansions.push(match)
		return `__PARAM_${parameterExpansions.length - 1}__`
	})

	// Handle process substitutions: <(...) and >(...)
	processedCommand = processedCommand.replace(/[<>]\(([^)]+)\)/g, (_, inner) => {
		subshells.push(inner.trim())
		return `__SUBSH_${subshells.length - 1}__`
	})

	// Handle simple variable references: $varname pattern
	// This prevents shell-quote from splitting $count into separate tokens
	processedCommand = processedCommand.replace(/\$[a-zA-Z_][a-zA-Z0-9_]*/g, (match) => {
		variables.push(match)
		return `__VAR_${variables.length - 1}__`
	})

	// Handle special bash variables: $?, $!, $#, $$, $@, $*, $-, $0-$9
	processedCommand = processedCommand.replace(/\$[?!#$@*\-0-9]/g, (match) => {
		variables.push(match)
		return `__VAR_${variables.length - 1}__`
	})

	// Then handle subshell commands $() and back-ticks
	processedCommand = processedCommand
		.replace(/\$\((.*?)\)/g, (_, inner) => {
			subshells.push(inner.trim())
			return `__SUBSH_${subshells.length - 1}__`
		})
		.replace(/`(.*?)`/g, (_, inner) => {
			subshells.push(inner.trim())
			return `__SUBSH_${subshells.length - 1}__`
		})

	// Then handle quoted strings
	processedCommand = processedCommand.replace(/"[^"]*"/g, (match) => {
		quotes.push(match)
		return `__QUOTE_${quotes.length - 1}__`
	})

	let tokens: ShellToken[]
	try {
		tokens = parse(processedCommand) as ShellToken[]
	} catch (error: unknown) {
		// If shell-quote fails to parse, fall back to simple splitting
		console.warn(
			"shell-quote parse error:",
			error instanceof Error ? error.message : String(error),
			"for command:",
			processedCommand,
		)

		// Simple fallback: split by common operators
		const fallbackCommands = processedCommand
			.split(/(?:&&|\|\||;|\||&)/)
			.map((cmd) => cmd.trim())
			.filter((cmd) => cmd.length > 0)

		// Restore all placeholders for each command
		return fallbackCommands.map((cmd) =>
			restorePlaceholders(
				cmd,
				quotes,
				redirections,
				arrayIndexing,
				arithmeticExpressions,
				parameterExpansions,
				variables,
				subshells,
			),
		)
	}

	const commands: string[] = []
	let currentCommand: string[] = []

	for (const token of tokens) {
		if (typeof token === "object" && "op" in token) {
			// Chain operator - split command
			if (["&&", "||", ";", "|", "&"].includes(token.op)) {
				if (currentCommand.length > 0) {
					commands.push(currentCommand.join(" "))
					currentCommand = []
				}
			} else {
				// Other operators (>) are part of the command
				currentCommand.push(token.op)
			}
		} else if (typeof token === "string") {
			// Check if it's a subshell placeholder
			const subshellMatch = token.match(/__SUBSH_(\d+)__/)
			if (subshellMatch) {
				if (currentCommand.length > 0) {
					commands.push(currentCommand.join(" "))
					currentCommand = []
				}
				const indexStr = subshellMatch[1]
				if (indexStr !== undefined) {
					const index = parseInt(indexStr, 10)
					if (!isNaN(index) && index >= 0 && index < subshells.length) {
						const subshellValue = subshells[index]
						if (subshellValue !== undefined) {
							commands.push(subshellValue)
						}
					}
				}
			} else {
				currentCommand.push(token)
			}
		}
	}

	// Add any remaining command
	if (currentCommand.length > 0) {
		commands.push(currentCommand.join(" "))
	}

	// Restore quotes and redirections
	return commands.map((cmd) =>
		restorePlaceholders(
			cmd,
			quotes,
			redirections,
			arrayIndexing,
			arithmeticExpressions,
			parameterExpansions,
			variables,
			subshells,
		),
	)
}

/**
 * Helper function to restore placeholders in a command string.
 */
function restorePlaceholders(
	command: string,
	quotes: string[],
	redirections: string[],
	arrayIndexing: string[],
	arithmeticExpressions: string[],
	parameterExpansions: string[],
	variables: string[],
	subshells: string[],
): string {
	let result = command
	// Restore quotes
	result = result.replace(/__QUOTE_(\d+)__/g, (_, i) => {
		const index = parseInt(i ?? "0", 10)
		if (!isNaN(index) && index >= 0 && index < quotes.length) {
			const value = quotes[index]
			return value ?? ""
		}
		return ""
	})
	// Restore redirections
	result = result.replace(/__REDIR_(\d+)__/g, (_, i) => {
		const index = parseInt(i ?? "0", 10)
		if (!isNaN(index) && index >= 0 && index < redirections.length) {
			const value = redirections[index]
			return value ?? ""
		}
		return ""
	})
	// Restore array indexing expressions
	result = result.replace(/__ARRAY_(\d+)__/g, (_, i) => {
		const index = parseInt(i ?? "0", 10)
		if (!isNaN(index) && index >= 0 && index < arrayIndexing.length) {
			const value = arrayIndexing[index]
			return value ?? ""
		}
		return ""
	})
	// Restore arithmetic expressions
	result = result.replace(/__ARITH_(\d+)__/g, (_, i) => {
		const index = parseInt(i ?? "0", 10)
		if (!isNaN(index) && index >= 0 && index < arithmeticExpressions.length) {
			const value = arithmeticExpressions[index]
			return value ?? ""
		}
		return ""
	})
	// Restore parameter expansions
	result = result.replace(/__PARAM_(\d+)__/g, (_, i) => {
		const index = parseInt(i ?? "0", 10)
		if (!isNaN(index) && index >= 0 && index < parameterExpansions.length) {
			const value = parameterExpansions[index]
			return value ?? ""
		}
		return ""
	})
	// Restore variable references
	result = result.replace(/__VAR_(\d+)__/g, (_, i) => {
		const index = parseInt(i ?? "0", 10)
		if (!isNaN(index) && index >= 0 && index < variables.length) {
			const value = variables[index]
			return value ?? ""
		}
		return ""
	})
	result = result.replace(/__SUBSH_(\d+)__/g, (_, i) => {
		const index = parseInt(i ?? "0", 10)
		if (!isNaN(index) && index >= 0 && index < subshells.length) {
			const value = subshells[index]
			return value ?? ""
		}
		return ""
	})
	return result
}
