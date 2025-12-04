/**
 * Command Executor Service
 * Pure utility functions for command execution logic
 */

import { commandRegistry } from "../commands/core/registry.js"
import { parseCommand } from "../commands/core/parser.js"
import { isCommandInput } from "./autocomplete.js"
import type { Command, CommandContext, ParsedCommand } from "../commands/core/types.js"
import { getTelemetryService } from "./telemetry/index.js"

/**
 * Result of command validation
 */
export interface CommandValidationResult {
	valid: boolean
	error?: string
	command?: Command
	parsed?: ParsedCommand
}

/**
 * Result of command execution
 */
export interface CommandExecutionResult {
	success: boolean
	error?: string
}

/**
 * Validate a command input string
 *
 * @param input - The raw input string to validate
 * @returns Validation result with command and parsed data if valid
 */
export function validateCommand(input: string): CommandValidationResult {
	const trimmedInput = input.trim()

	// Check if it's a command format
	if (!isCommandInput(trimmedInput)) {
		return {
			valid: false,
			error: "Not a command (commands start with /)",
		}
	}

	// Parse the command
	const parsed = parseCommand(trimmedInput)
	if (!parsed) {
		return {
			valid: false,
			error: "Invalid command format. Type /help for available commands.",
		}
	}

	// Look up the command
	const command = commandRegistry.get(parsed.command)
	if (!command) {
		return {
			valid: false,
			error: `Unknown command: /${parsed.command}. Type /help for available commands.`,
		}
	}

	return {
		valid: true,
		command,
		parsed,
	}
}

/**
 * Execute a command with the provided context
 *
 * @param command - The command to execute
 * @param context - The command context
 * @returns Execution result
 */
export async function executeCommandWithContext(
	command: Command,
	context: CommandContext,
): Promise<CommandExecutionResult> {
	const startTime = Date.now()

	try {
		await command.handler(context)

		const executionTime = Date.now() - startTime

		// Track successful command execution
		getTelemetryService().trackCommandExecuted(command.name, context.args, executionTime, true)

		return { success: true }
	} catch (error) {
		const executionTime = Date.now() - startTime
		const errorMessage = error instanceof Error ? error.message : String(error)

		// Track failed command execution
		getTelemetryService().trackCommandExecuted(command.name, context.args, executionTime, false)
		getTelemetryService().trackCommandFailed(command.name, errorMessage)

		return {
			success: false,
			error: errorMessage,
		}
	}
}

/**
 * Parse and validate command input
 *
 * @param input - The raw input string
 * @returns Parsed command or null if not a valid command
 */
export function parseCommandInput(input: string): ParsedCommand | null {
	const trimmedInput = input.trim()

	if (!isCommandInput(trimmedInput)) {
		return null
	}

	return parseCommand(trimmedInput)
}

/**
 * Check if a command requires arguments
 *
 * @param command - The command to check
 * @returns True if the command has required arguments
 */
export function hasRequiredArguments(command: Command): boolean {
	if (!command.arguments) return false
	return command.arguments.some((arg) => arg.required)
}

/**
 * Validate command arguments
 *
 * @param command - The command to validate against
 * @param args - The provided arguments
 * @returns Validation result
 */
export function validateArguments(command: Command, args: string[]): { valid: boolean; error?: string } {
	if (!command.arguments) {
		return { valid: true }
	}

	// Check required arguments
	const requiredArgs = command.arguments.filter((arg) => arg.required)
	if (args.length < requiredArgs.length) {
		const missing = requiredArgs.slice(args.length).map((arg) => arg.name)
		return {
			valid: false,
			error: `Missing required arguments: ${missing.join(", ")}`,
		}
	}

	return { valid: true }
}

/**
 * Format command error message
 *
 * @param command - The command that failed
 * @param error - The error that occurred
 * @returns Formatted error message
 */
export function formatCommandError(command: Command, error: string): string {
	return `Error executing /${command.name}: ${error}`
}

/**
 * Get command usage string
 *
 * @param command - The command to get usage for
 * @returns Formatted usage string
 */
export function getCommandUsage(command: Command): string {
	let usage = `/${command.name}`

	if (command.arguments) {
		for (const arg of command.arguments) {
			if (arg.required) {
				usage += ` <${arg.name}>`
			} else {
				usage += ` [${arg.name}]`
			}
		}
	}

	if (command.options && command.options.length > 0) {
		usage += " [options]"
	}

	return usage
}

/**
 * Check if input is a complete command
 *
 * @param input - The input to check
 * @returns True if the input is a complete command
 */
export function isCompleteCommand(input: string): boolean {
	const validation = validateCommand(input)
	if (!validation.valid || !validation.command || !validation.parsed) {
		return false
	}

	const argValidation = validateArguments(validation.command, validation.parsed.args)
	return argValidation.valid
}
