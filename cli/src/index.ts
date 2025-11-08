#!/usr/bin/env node

// Load .env file before any other imports or initialization
import { loadEnvFile } from "./utils/env-loader.js"
loadEnvFile()

import { Command } from "commander"
import { existsSync } from "fs"
import { CLI } from "./cli.js"
import { DEFAULT_MODES } from "./constants/modes/defaults.js"
import { getTelemetryService } from "./services/telemetry/index.js"
import { Package } from "./constants/package.js"
import openConfigFile from "./config/openConfig.js"
import authWizard from "./utils/authWizard.js"
import { configExists } from "./config/persistence.js"
import { getParallelModeParams } from "./parallel/parallel.js"

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
	.option("-a, --auto", "Run in autonomous mode (non-interactive)", false)
	.option("-j, --json", "Output messages as JSON (requires --auto)", false)
	.option("-c, --continue", "Resume the last conversation from this workspace", false)
	.option("-t, --timeout <seconds>", "Timeout in seconds for autonomous mode (requires --auto)", parseInt)
	.option(
		"-p, --parallel",
		"Run in parallel mode - the agent will create a separate git branch, unless you provide the --existing-branch option",
	)
	.option("-eb, --existing-branch <branch>", "(Parallel mode only) Instructs the agent to work on an existing branch")
	.argument("[prompt]", "The prompt or command to execute")
	.action(async (prompt, options) => {
		// Validate mode if provided
		if (options.mode && !validModes.includes(options.mode)) {
			console.error(`Error: Invalid mode "${options.mode}". Valid modes are: ${validModes.join(", ")}`)
			process.exit(1)
		}

		// Validate that --existing-branch requires --parallel
		if (options.existingBranch && !options.parallel) {
			console.error("Error: --existing-branch option requires --parallel flag to be enabled")
			process.exit(1)
		}

		// Validate workspace path exists
		if (!existsSync(options.workspace)) {
			console.error(`Error: Workspace path does not exist: ${options.workspace}`)
			process.exit(1)
		}

		// Validate that piped stdin requires autonomous mode
		if (!process.stdin.isTTY && !options.auto) {
			console.error("Error: Piped input requires --auto flag to be enabled")
			process.exit(1)
		}

		// Validate that JSON mode requires autonomous mode
		if (options.json && !options.auto) {
			console.error("Error: --json option requires --auto flag to be enabled")
			process.exit(1)
		}

		// Read from stdin if no prompt argument is provided and stdin is piped
		let finalPrompt = prompt || ""
		if (!finalPrompt && !process.stdin.isTTY) {
			// Read from stdin
			const chunks: Buffer[] = []
			for await (const chunk of process.stdin) {
				chunks.push(chunk)
			}
			finalPrompt = Buffer.concat(chunks).toString("utf-8").trim()
		}

		// Validate that autonomous mode requires a prompt
		if (options.auto && !finalPrompt) {
			console.error(
				"Error: autonomous mode (--auto) and parallel mode (--parallel) require a prompt argument or piped input",
			)
			process.exit(1)
		}

		// Validate that timeout requires autonomous mode
		if (options.timeout && !options.auto) {
			console.error("Error: --timeout option requires --auto flag to be enabled")
			process.exit(1)
		}

		// Validate timeout is a positive number
		if (options.timeout && (isNaN(options.timeout) || options.timeout <= 0)) {
			console.error("Error: --timeout must be a positive number")
			process.exit(1)
		}

		// Validate that continue mode is not used with autonomous mode
		if (options.continue && options.auto) {
			console.error("Error: --continue option cannot be used with --auto flag")
			process.exit(1)
		}

		// Validate that continue mode is not used with a prompt
		if (options.continue && finalPrompt) {
			console.error("Error: --continue option cannot be used with a prompt argument")
			process.exit(1)
		}

		// Track autonomous mode start if applicable
		if (options.auto && finalPrompt) {
			getTelemetryService().trackCIModeStarted(finalPrompt.length, options.timeout)
		}

		if (!(await configExists())) {
			console.info("Welcome to the Kilo Code CLI! 🎉\n")
			console.info("To get you started, please fill out these following questions.")
			await authWizard()
		}

		let finalWorkspace = options.workspace
		let worktreeBranch

		if (options.parallel) {
			const parallelParams = await getParallelModeParams({
				cwd: options.workspace,
				prompt: finalPrompt,
				timeout: options.timeout,
				existingBranch: options.existingBranch,
			})

			finalWorkspace = parallelParams.worktreePath
			worktreeBranch = parallelParams.worktreeBranch

			getTelemetryService().trackParallelModeStarted(
				!!options.existingBranch,
				finalPrompt.length,
				options.timeout,
			)
		}

		cli = new CLI({
			mode: options.mode,
			workspace: finalWorkspace,
			ci: options.auto,
			json: options.json,
			prompt: finalPrompt,
			timeout: options.timeout,
			parallel: options.parallel,
			worktreeBranch,
			continue: options.continue,
		})
		await cli.start()
		await cli.dispose()
	})

program
	.command("auth")
	.description("Manage authentication for the Kilo Code CLI")
	.action(async () => {
		await authWizard()
	})

// Config command - opens the config file in the default editor
program
	.command("config")
	.description("Open the configuration file in your default editor")
	.action(async () => {
		await openConfigFile()
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
