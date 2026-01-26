import { Command } from "commander"

import { DEFAULT_FLAGS } from "@/types/constants.js"
import { VERSION } from "@/lib/utils/version.js"
import { run, login, logout, status } from "@/commands/index.js"

const program = new Command()

program.name("roo").description("Roo Code CLI - Run the Roo Code agent from the command line").version(VERSION)

program
	.argument("[workspace]", "Workspace path to operate in", process.cwd())
	.option("-P, --prompt <prompt>", "The prompt/task to execute (optional in TUI mode)")
	.option("-e, --extension <path>", "Path to the extension bundle directory")
	.option("-d, --debug", "Enable debug output (includes detailed debug information)", false)
	.option("-y, --yes", "Auto-approve all prompts (non-interactive mode)", false)
	.option("-k, --api-key <key>", "API key for the LLM provider (defaults to OPENROUTER_API_KEY env var)")
	.option("-p, --provider <provider>", "API provider (anthropic, openai, openrouter, etc.)", "openrouter")
	.option("-m, --model <model>", "Model to use", DEFAULT_FLAGS.model)
	.option("-M, --mode <mode>", "Mode to start in (code, architect, ask, debug, etc.)", DEFAULT_FLAGS.mode)
	.option(
		"-r, --reasoning-effort <effort>",
		"Reasoning effort level (unspecified, disabled, none, minimal, low, medium, high, xhigh)",
		DEFAULT_FLAGS.reasoningEffort,
	)
	.option("-x, --exit-on-complete", "Exit the process when the task completes (applies to TUI mode only)", false)
	.option(
		"-w, --wait-on-complete",
		"Keep the process running when the task completes (applies to plain text mode only)",
		false,
	)
	.option("--ephemeral", "Run without persisting state (uses temporary storage)", false)
	.option("--no-tui", "Disable TUI, use plain text output")
	.action(run)

const authCommand = program.command("auth").description("Manage authentication for Roo Code Cloud")

authCommand
	.command("login")
	.description("Authenticate with Roo Code Cloud")
	.option("-v, --verbose", "Enable verbose output", false)
	.action(async (options: { verbose: boolean }) => {
		const result = await login({ verbose: options.verbose })
		process.exit(result.success ? 0 : 1)
	})

authCommand
	.command("logout")
	.description("Log out from Roo Code Cloud")
	.option("-v, --verbose", "Enable verbose output", false)
	.action(async (options: { verbose: boolean }) => {
		const result = await logout({ verbose: options.verbose })
		process.exit(result.success ? 0 : 1)
	})

authCommand
	.command("status")
	.description("Show authentication status")
	.option("-v, --verbose", "Enable verbose output", false)
	.action(async (options: { verbose: boolean }) => {
		const result = await status({ verbose: options.verbose })
		process.exit(result.authenticated ? 0 : 1)
	})

program.parse()
