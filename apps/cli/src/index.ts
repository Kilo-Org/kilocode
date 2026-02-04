import { Command } from "commander"

import { DEFAULT_FLAGS } from "@/types/constants.js"
import { VERSION } from "@/lib/utils/version.js"
import { run, login, logout, status } from "@/commands/index.js"

const program = new Command()

program
	.name("roo")
	.description("Roo Code CLI - starts an interactive session by default, use -p/--print for non-interactive output")
	.version(VERSION)

program
	.argument("[prompt]", "Your prompt")
	.option("--prompt-file <path>", "Read prompt from a file instead of command line argument")
	.option("-w, --workspace <path>", "Workspace directory path (defaults to current working directory)")
	.option("-p, --print", "Print response and exit (non-interactive mode)", false)
	.option("-e, --extension <path>", "Path to the extension bundle directory")
	.option("-d, --debug", "Enable debug output (includes detailed debug information)", false)
	.option("-y, --yes, --dangerously-skip-permissions", "Auto-approve all prompts (use with caution)", false)
	.option("-k, --api-key <key>", "API key for the LLM provider")
	.option("--provider <provider>", "API provider (roo, anthropic, openai, openrouter, etc.)")
	.option("-m, --model <model>", "Model to use", DEFAULT_FLAGS.model)
	.option("--mode <mode>", "Mode to start in (code, architect, ask, debug, etc.)", DEFAULT_FLAGS.mode)
	.option(
		"-r, --reasoning-effort <effort>",
		"Reasoning effort level (unspecified, disabled, none, minimal, low, medium, high, xhigh)",
		DEFAULT_FLAGS.reasoningEffort,
	)
	.option("--ephemeral", "Run without persisting state (uses temporary storage)", false)
	.option("--oneshot", "Exit upon task completion", false)
	.option(
		"--output-format <format>",
		'Output format (only works with --print): "text" (default), "json" (single result), or "stream-json" (realtime streaming)',
		"text",
	)
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
