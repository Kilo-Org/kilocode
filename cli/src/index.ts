#!/usr/bin/env node

// Load .env file before any other imports or initialization
import { loadEnvFile } from "./utils/env-loader.js"
loadEnvFile()

import { Command } from "commander"
import { existsSync } from "fs"
import { CLI } from "./cli.js"
import { DEFAULT_MODES, getAllModes } from "./constants/modes/defaults.js"
import { getTelemetryService } from "./services/telemetry/index.js"
import { Package } from "./constants/package.js"
import openConfigFile from "./config/openConfig.js"
import authWizard from "./auth/index.js"
import { configExists } from "./config/persistence.js"
import { loadCustomModes, getSearchedPaths } from "./config/customModes.js"
import { envConfigExists, getMissingEnvVars } from "./config/env-config.js"
import { getParallelModeParams } from "./parallel/parallel.js"
import { DEBUG_MODES, DEBUG_FUNCTIONS } from "./debug/index.js"
import { logs } from "./services/logs.js"
import { validateAttachments, validateAttachRequiresAuto, accumulateAttachments } from "./validation/attachments.js"

// Log CLI location for debugging (visible in VS Code "Kilo-Code" output channel)
logs.info(`CLI started from: ${import.meta.url}`)

const program = new Command()
let cli: CLI | null = null

// Get list of valid mode slugs from default modes
// Custom modes will be loaded and validated per workspace
const validModes = DEFAULT_MODES.map((mode) => mode.slug)

program
	.name("kilocode")
	.description("Kilo Code Terminal User Interface - AI-powered coding assistant")
	.version(Package.version)
	.option("-m, --mode <mode>", `Set the mode of operation (${validModes.join(", ")})`)
	.option("-w, --workspace <path>", "Path to the workspace directory", process.cwd())
	.option("-a, --auto", "Run in autonomous mode (non-interactive)", false)
	.option("--yolo", "Auto-approve all tool permissions", false)
	.option("-j, --json", "Output messages as JSON (requires --auto)", false)
	.option("-i, --json-io", "Bidirectional JSON mode (no TUI, stdin/stdout enabled)", false)
	.option("-c, --continue", "Resume the last conversation from this workspace", false)
	.option("-t, --timeout <seconds>", "Timeout in seconds for autonomous mode (requires --auto)", parseInt)
	.option(
		"-p, --parallel",
		"Run in parallel mode - the agent will create a separate git branch, unless you provide the --existing-branch option",
	)
	.option("-eb, --existing-branch <branch>", "(Parallel mode only) Instructs the agent to work on an existing branch")
	.option("-pv, --provider <id>", "Select provider by ID (e.g., 'kilocode-1')")
	.option("-mo, --model <model>", "Override model for the selected provider")
	.option("-s, --session <sessionId>", "Restore a session by ID")
	.option("-f, --fork <shareId>", "Fork a session by ID")
	.option("--nosplash", "Disable the welcome message and update notifications", false)
	.option("--append-system-prompt <text>", "Append custom instructions to the system prompt")
	.option("--on-task-completed <prompt>", "Send a custom prompt to the agent when the task completes")
	.option(
		"--attach <path>",
		"Attach a file to the prompt (can be repeated). Currently supports images: png, jpg, jpeg, webp, gif, tiff",
		accumulateAttachments,
		[] as string[],
	)
	.argument("[prompt]", "The prompt or command to execute")
	.action(async (prompt, options) => {
		// Subcommand names - if prompt matches one, Commander.js should handle it via subcommand
		// This is a defensive check for cases where Commander.js routing might not work as expected
		// (e.g., when spawned as a child process with stdin disconnected)
		const SUBCOMMANDS = ["auth", "config", "debug", "models"]
		if (SUBCOMMANDS.includes(prompt)) {
			return
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

		// Load custom modes from workspace
		const customModes = await loadCustomModes(options.workspace)
		const allModes = getAllModes(customModes)
		const allValidModes = allModes.map((mode) => mode.slug)

		// Validate mode if provided
		if (options.mode && !allValidModes.includes(options.mode)) {
			const searchedPaths = getSearchedPaths()
			console.error(`Error: Mode "${options.mode}" not found.\n`)
			console.error("The CLI searched for custom modes in:")
			for (const searched of searchedPaths) {
				const status = searched.found ? `found, ${searched.modesCount} mode(s)` : "not found"
				console.error(`  • ${searched.type === "global" ? "Global" : "Project"}: ${searched.path} (${status})`)
			}
			console.error(`\nAvailable modes: ${allValidModes.join(", ")}`)
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

		// Validate that --fork and --session are not used together
		if (options.fork && options.session) {
			console.error("Error: --fork and --session options cannot be used together")
			process.exit(1)
		}

		// Validate that piped stdin requires autonomous mode or json-io mode
		if (!process.stdin.isTTY && !options.auto && !options.jsonIo) {
			console.error("Error: Piped input requires --auto or --json-io flag to be enabled")
			process.exit(1)
		}

		// Validate that --json requires --auto (--json-io is independent)
		if (options.json && !options.auto) {
			console.error("Error: --json option requires --auto flag to be enabled")
			process.exit(1)
		}

		// Validate that --on-task-completed requires --auto
		if (options.onTaskCompleted && !options.auto) {
			console.error("Error: --on-task-completed option requires --auto flag to be enabled")
			process.exit(1)
		}

		// Validate --on-task-completed prompt is not empty
		if (options.onTaskCompleted !== undefined && options.onTaskCompleted.trim() === "") {
			console.error("Error: --on-task-completed requires a non-empty prompt")
			process.exit(1)
		}

		// Validate provider if specified
		if (options.provider) {
			// Load config to check if provider exists
			const { loadConfig } = await import("./config/persistence.js")
			const { config } = await loadConfig()
			const providerExists = config.providers.some((p) => p.id === options.provider)
			if (!providerExists) {
				const availableIds = config.providers.map((p) => p.id).join(", ")
				console.error(`Error: Provider "${options.provider}" not found. Available providers: ${availableIds}`)
				process.exit(1)
			}
		}

		// Validate attachments if specified
		const attachments: string[] = options.attach || []
		const attachRequiresAutoResult = validateAttachRequiresAuto({ attach: attachments, auto: options.auto })
		if (!attachRequiresAutoResult.valid) {
			console.error(attachRequiresAutoResult.error)
			process.exit(1)
		}

		if (attachments.length > 0) {
			const validationResult = validateAttachments(attachments)
			if (!validationResult.valid) {
				for (const error of validationResult.errors) {
					console.error(error)
				}
				process.exit(1)
			}
		}

		// Track autonomous mode start if applicable
		if (options.auto && finalPrompt) {
			getTelemetryService().trackCIModeStarted(finalPrompt.length, options.timeout)
		}

		// Check if config exists or if we have minimal env config
		const hasConfig = await configExists()

		// Check if we have env config with all required fields
		const hasEnvConfig = envConfigExists()

		if (!hasConfig && !hasEnvConfig) {
			// No config file and no env config
			// Check if running in agent-manager mode (spawned from VS Code extension)
			if (process.env.KILO_PLATFORM === "agent-manager") {
				// Output a welcome message with instructions that the agent manager can detect.
				// The agent manager will show a localized error dialog with "Run kilocode auth"
				// and "Run kilocode config" buttons. The instructions here are just for
				// triggering the cli_configuration_error handler and providing log context.
				const welcomeMessage = {
					type: "welcome",
					timestamp: Date.now(),
					metadata: {
						welcomeOptions: {
							instructions: ["Configuration required: No provider configured."],
						},
					},
				}
				console.log(JSON.stringify(welcomeMessage))
				process.exit(1)
			}

			// Interactive mode - show auth wizard
			console.info("Welcome to the Kilo Code CLI! 🎉\n")
			console.info("To get you started, please fill out these following questions.")
			await authWizard()
		} else if (!hasConfig && hasEnvConfig) {
			// Running with env config only
			logs.info("Running in ephemeral mode with environment variable configuration", "Index")

			const providerType = process.env.KILO_PROVIDER_TYPE
			if (providerType) {
				const missing = getMissingEnvVars(providerType)
				if (missing.length > 0) {
					console.error(`\nError: Missing required environment variables for provider "${providerType}":`)
					console.error(`  ${missing.join("\n  ")}`)
					console.error(
						`\nPlease set these environment variables or run 'kilocode auth' to configure via wizard.\n`,
					)
					process.exit(1)
				}
			}
		} else if (hasConfig && hasEnvConfig) {
			// Both exist - env vars will override config file values
			logs.debug("Using config file with environment variable overrides", "Index")
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

		logs.debug("Starting Kilo Code CLI", "Index", { options })

		const jsonIoMode = options.jsonIo

		cli = new CLI({
			mode: options.mode,
			workspace: finalWorkspace,
			ci: options.auto,
			yolo: options.yolo,
			// json-io mode implies json output (both modes output JSON to stdout)
			json: options.json || jsonIoMode,
			jsonInteractive: jsonIoMode,
			prompt: finalPrompt,
			timeout: options.timeout,
			customModes: customModes,
			parallel: options.parallel,
			worktreeBranch,
			continue: options.continue,
			provider: options.provider,
			model: options.model,
			session: options.session,
			fork: options.fork,
			noSplash: options.nosplash,
			appendSystemPrompt: options.appendSystemPrompt,
			attachments: attachments.length > 0 ? attachments : undefined,
			onTaskCompleted: options.onTaskCompleted,
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
		try {
			await openConfigFile()
		} catch (_error) {
			// Error already logged by openConfigFile
			process.exit(1)
		}
	})

// Debug command - checks hardware and OS compatibility
program
	.command("debug")
	.description("Run a system compatibility check for the Kilo Code CLI")
	.argument("[mode]", `The mode to debug (${DEBUG_MODES.join(", ")})`, "")
	.action(async (mode: string) => {
		// If no mode is provided, show available debug modes (helpful UX)
		if (!mode) {
			console.log(`Available debug modes: ${DEBUG_MODES.join(", ")}`)
			process.exit(0)
		}

		if (!DEBUG_MODES.includes(mode)) {
			console.error(`Error: Invalid debug mode. Valid modes are: ${DEBUG_MODES.join(", ")}`)
			process.exit(1)
		}

		const debugFunction = DEBUG_FUNCTIONS[mode as keyof typeof DEBUG_FUNCTIONS]
		if (!debugFunction) {
			console.error(`Error: Debug function not implemented for mode: ${mode}`)
			process.exit(1)
		}

		await debugFunction()
	})

// Models command - list available models as JSON for programmatic use
program
	.command("models")
	.description("List available models for the current provider as JSON")
	.option("--provider <id>", "Use specific provider instead of default")
	.option("--json", "Output as JSON (default)", true)
	.action(async (options: { provider?: string; json?: boolean }) => {
		const { modelsApiCommand } = await import("./commands/models-api.js")
		await modelsApiCommand(options)
	})

// Handle process termination signals
process.on("SIGINT", async () => {
	if (cli?.requestExitConfirmation()) {
		return
	}

	if (cli) {
		await cli.dispose("SIGINT")
	} else {
		process.exit(130)
	}
})

process.on("SIGTERM", async () => {
	if (cli) {
		await cli.dispose("SIGTERM")
	} else {
		process.exit(143)
	}
})

// Parse command line arguments
program.parse()
