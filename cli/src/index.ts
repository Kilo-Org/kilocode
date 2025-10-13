#!/usr/bin/env node

// Load .env file before any other imports or initialization
import { loadEnvFile } from "./utils/env-loader.js"
loadEnvFile()

import { Command } from "commander"
import { existsSync } from "fs"
import { spawn } from "child_process"
import { platform } from "os"
import { CLI } from "./cli.js"
import { DEFAULT_MODES } from "./constants/modes/defaults.js"
import { configExists, saveConfig, getConfigPath, ensureConfigDir } from "./config/persistence.js"
import { DEFAULT_CONFIG } from "./config/defaults.js"
import { getTelemetryService } from "./services/telemetry/index.js"
import { Package } from "./constants/package.js"

const program = new Command()
let cli: CLI | null = null

// Get list of valid mode slugs
const validModes = DEFAULT_MODES.map((mode) => mode.slug)

program
	.name("kilocode")
	.description("Kilo Code Terminal User Interface - AI-powered coding assistant")
	.version(Package.version)
	.option("-m, --mode <mode>", `Set the mode of operation (${validModes.join(", ")})`)
	.option("-w, --workspace <path>", "Path to the workspace directory", process.cwd())
	.option("-ci, --auto", "Run in CI mode (non-interactive)", false)
	.option("-t, --timeout <seconds>", "Timeout in seconds for CI mode (requires --ci)", parseInt)
	.argument("[prompt]", "The prompt or command to execute")
	.action(async (prompt, options) => {
		// Validate mode if provided
		if (options.mode && !validModes.includes(options.mode)) {
			console.error(`Error: Invalid mode "${options.mode}". Valid modes are: ${validModes.join(", ")}`)
			process.exit(1)
		}

		// Validate workspace path exists
		if (!existsSync(options.workspace)) {
			console.error(`Error: Workspace path does not exist: ${options.workspace}`)
			process.exit(1)
		}

		// Validate that piped stdin requires CI mode
		if (!process.stdin.isTTY && !options.auto) {
			console.error("Error: Piped input requires --ci flag to be enabled")
			process.exit(1)
		}

		// Read from stdin if no prompt argument is provided and stdin is piped
		let finalPrompt = prompt
		if (!finalPrompt && !process.stdin.isTTY) {
			// Read from stdin
			const chunks: Buffer[] = []
			for await (const chunk of process.stdin) {
				chunks.push(chunk)
			}
			finalPrompt = Buffer.concat(chunks).toString("utf-8").trim()
		}

		// Validate that CI mode requires a prompt
		if (options.auto && !finalPrompt) {
			console.error("Error: CI mode (--ci) requires a prompt argument or piped input")
			process.exit(1)
		}

		// Validate that timeout requires CI mode
		if (options.timeout && !options.auto) {
			console.error("Error: --timeout option requires --ci flag to be enabled")
			process.exit(1)
		}

		// Validate timeout is a positive number
		if (options.timeout && (isNaN(options.timeout) || options.timeout <= 0)) {
			console.error("Error: --timeout must be a positive number")
			process.exit(1)
		}

		// Track CI mode start if applicable
		if (options.auto && finalPrompt) {
			getTelemetryService().trackCIModeStarted(finalPrompt.length, options.timeout)
		}

		cli = new CLI({
			mode: options.mode,
			workspace: options.workspace,
			ci: options.auto,
			prompt: finalPrompt,
			timeout: options.timeout,
		})
		await cli.start()
		await cli.dispose()
	})

// Config command - opens the config file in the default editor
program
	.command("config")
	.description("Open the configuration file in your default editor")
	.action(async () => {
		try {
			// Ensure config directory exists
			await ensureConfigDir()

			// Check if config file exists, if not create it with defaults
			const exists = await configExists()
			if (!exists) {
				console.log("Config file not found. Creating default configuration...")
				await saveConfig(DEFAULT_CONFIG)
				console.log("Default configuration created.")
			}

			// Get the config file path
			const configPath = await getConfigPath()
			console.log(`Opening config file: ${configPath}`)

			// Determine the editor command based on platform and environment
			const editor = process.env.EDITOR || process.env.VISUAL
			let editorCommand: string
			let editorArgs: string[]

			if (editor) {
				// Use user's preferred editor from environment variable
				editorCommand = editor
				editorArgs = [configPath]
			} else {
				// Use platform-specific default
				const currentPlatform = platform()
				switch (currentPlatform) {
					case "darwin": // macOS
						editorCommand = "open"
						editorArgs = ["-t", configPath] // -t opens in default text editor
						break
					case "win32": // Windows
						editorCommand = "cmd"
						editorArgs = ["/c", "start", "", configPath]
						break
					default: // Linux and others
						editorCommand = "xdg-open"
						editorArgs = [configPath]
						break
				}
			}

			// Spawn the editor process
			const editorProcess = spawn(editorCommand, editorArgs, {
				stdio: "inherit",
				shell: true,
			})

			editorProcess.on("error", (error) => {
				console.error(`Failed to open editor: ${error.message}`)
				console.error(`Tried to run: ${editorCommand} ${editorArgs.join(" ")}`)
				console.error(`\nYou can manually edit the config file at: ${configPath}`)
				process.exit(1)
			})

			editorProcess.on("exit", (code) => {
				if (code !== 0 && code !== null) {
					console.error(`Editor exited with code ${code}`)
					console.error(`Config file location: ${configPath}`)
				}
			})
		} catch (error) {
			console.error("Error managing config file:", error instanceof Error ? error.message : String(error))
			process.exit(1)
		}
	})

// Handle process termination signals
process.on("SIGINT", async () => {
	if (cli) {
		await cli.dispose()
	}
	process.exit(0)
})

process.on("SIGTERM", async () => {
	if (cli) {
		await cli.dispose()
	}
	process.exit(0)
})

// Parse command line arguments
program.parse()
