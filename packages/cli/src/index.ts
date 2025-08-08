#!/usr/bin/env node

import { Command } from "commander"
import chalk from "chalk"
import { version } from "../package.json"
import { TaskCommand } from "./commands/TaskCommand"
import { InteractiveCommand } from "./commands/InteractiveCommand"
import { ConfigCommand } from "./commands/ConfigCommand"
import { logger, setLogLevelFromOptions, LogLevel } from "./utils/Logger"

/**
 * Display the Kilo Code ASCII art banner with white-to-yellow gradient
 * Only shows if log level is INFO or higher
 */
function displayBanner() {
	const banner = [
		"██╗  ██╗██╗██╗      ██████╗      ██████╗ ██████╗ ██████╗ ███████╗",
		"██║ ██╔╝██║██║     ██╔═══██╗    ██╔════╝██╔═══██╗██╔══██╗██╔════╝",
		"█████╔╝ ██║██║     ██║   ██║    ██║     ██║   ██║██║  ██║█████╗  ",
		"██╔═██╗ ██║██║     ██║   ██║    ██║     ██║   ██║██║  ██║██╔══╝  ",
		"██║  ██╗██║███████╗╚██████╔╝    ╚██████╗╚██████╔╝██████╔╝███████╗",
		"╚═╝  ╚═╝╚═╝╚══════╝ ╚═════╝      ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝",
	]

	console.log("") // Empty line before banner

	banner.forEach((line) => {
		let gradientLine = ""
		const lineLength = line.length

		for (let i = 0; i < lineLength; i++) {
			const char = line[i]
			// Calculate gradient position (0 to 1)
			const position = i / (lineLength - 1)

			// Create white-to-yellow gradient
			// Start with white (255, 255, 255) and transition to yellow (255, 255, 0)
			const red = 255
			const green = 255
			const blue = Math.round(255 * (1 - position)) // Blue decreases from 255 to 0

			// Apply color to character
			gradientLine += chalk.rgb(red, green, blue)(char)
		}

		console.log(gradientLine)
	})

	console.log("") // Empty line after banner
	console.log(chalk.yellow("🚀 AI-Powered Coding Assistant"))
	console.log(chalk.gray("   Ready to execute your coding tasks"))
	console.log("") // Empty line before content
}

const program = new Command()

program.name("kilo-cli").description("Kilo Code AI Agent - Standalone CLI").version(version)

// Global options that affect configuration
program
	.option("-c, --config <path>", "Path to configuration file")
	.option("-p, --provider <name>", "AI provider to use")
	.option("--api-key <key>", "API key for the provider")
	.option("--model <name>", "Model to use")
	.option("--max-tokens <number>", "Maximum tokens for responses", parseInt)
	.option("--temperature <number>", "Temperature for response generation", parseFloat)
	.option("-v, --verbose", "Enable verbose logging (shows all debug output)")
	.option("-d, --debug", "Enable debug logging (shows debug info)")
	.option("-i, --info", "Enable info logging (shows banner and progress)")
	.option("-q, --quiet", "Quiet mode (only errors) - this is the default")
	.option("--no-colors", "Disable colored output")
	.option("--no-interactive", "Disable interactive prompts")
	.hook("preAction", (thisCommand) => {
		// Set up logging level based on options before any command execution
		const options = thisCommand.opts()
		setLogLevelFromOptions(options)

		// Display banner after log level is set
		displayBanner()
	})

// Task execution command
program
	.command("task")
	.description("Execute a task using the AI agent")
	.argument("<prompt>", "Task description or prompt")
	.option("-o, --output <format>", "Output format (text, json, markdown)", "text")
	.option("--dry-run", "Show what would be done without executing")
	.option("-c, --config <path>", "Path to configuration file")
	.option("-p, --provider <name>", "AI provider to use")
	.action(async (prompt, options) => {
		try {
			const taskCommand = new TaskCommand()
			await taskCommand.execute(prompt, {
				...options,
				...program.opts(), // Include global options
			})
		} catch (error) {
			logger.error("Error executing task:", error instanceof Error ? error.message : String(error))
			process.exit(1)
		}
	})

// Interactive mode
program
	.command("interactive")
	.alias("i")
	.description("Start interactive mode for back-and-forth conversation")
	.action(async (options) => {
		try {
			const interactiveCommand = new InteractiveCommand()
			await interactiveCommand.execute({
				...options,
				...program.opts(), // Include global options
			})
		} catch (error) {
			logger.error("Error starting interactive mode:", error instanceof Error ? error.message : String(error))
			process.exit(1)
		}
	})

// Configuration management commands
const configCmd = program.command("config").description("Manage CLI configuration")

configCmd
	.command("list")
	.description("Show current configuration")
	.action(async () => {
		try {
			const configCommand = new ConfigCommand()
			await configCommand.list()
		} catch (error) {
			logger.error("Error listing configuration:", error instanceof Error ? error.message : String(error))
			process.exit(1)
		}
	})

configCmd
	.command("set <key> <value>")
	.description("Set a configuration value")
	.action(async (key, value) => {
		try {
			const configCommand = new ConfigCommand()
			await configCommand.set(key, value)
		} catch (error) {
			logger.error("Error setting configuration:", error instanceof Error ? error.message : String(error))
			process.exit(1)
		}
	})

configCmd
	.command("get <key>")
	.description("Get a configuration value")
	.action(async (key) => {
		try {
			const configCommand = new ConfigCommand()
			await configCommand.get(key)
		} catch (error) {
			logger.error("Error getting configuration:", error instanceof Error ? error.message : String(error))
			process.exit(1)
		}
	})

// Global error handling
process.on("uncaughtException", (error) => {
	logger.error("Uncaught Exception:", error.message)
	process.exit(1)
})

process.on("unhandledRejection", (reason, promise) => {
	logger.error("Unhandled Rejection at:", promise, "reason:", reason)
	process.exit(1)
})

// Parse command line arguments
program.parse()
