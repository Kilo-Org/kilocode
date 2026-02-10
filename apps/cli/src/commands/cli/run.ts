import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

import { createElement } from "react"

import { isProviderName } from "@roo-code/types"
import { setLogger } from "@roo-code/vscode-shim"

import {
	FlagOptions,
	isSupportedProvider,
	OnboardingProviderChoice,
	supportedProviders,
	ASCII_ROO,
	DEFAULT_FLAGS,
	REASONING_EFFORTS,
	SDK_BASE_URL,
} from "@/types/index.js"

import { type User, createClient } from "@/lib/sdk/index.js"
import { loadToken, hasToken, loadSettings } from "@/lib/storage/index.js"
import { getEnvVarName, getApiKeyFromEnv } from "@/lib/utils/provider.js"
import { runOnboarding } from "@/lib/utils/onboarding.js"
import { getDefaultExtensionPath } from "@/lib/utils/extension.js"
import { VERSION } from "@/lib/utils/version.js"

import { ExtensionHost, ExtensionHostOptions } from "@/agent/index.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export async function run(workspaceArg: string, options: FlagOptions) {
	setLogger({
		info: () => {},
		warn: () => {},
		error: () => {},
		debug: () => {},
	})

	const isTuiSupported = process.stdin.isTTY && process.stdout.isTTY
	const isTuiEnabled = options.tui && isTuiSupported
	const extensionPath = options.extension || getDefaultExtensionPath(__dirname)
	const workspacePath = path.resolve(workspaceArg)

	if (!isSupportedProvider(options.provider)) {
		console.error(
			`[CLI] Error: Invalid provider: ${options.provider}; must be one of: ${supportedProviders.join(", ")}`,
		)

		process.exit(1)
	}

	let apiKey = options.apiKey || getApiKeyFromEnv(options.provider)
	let provider = options.provider
	let user: User | null = null
	let useCloudProvider = false

	if (isTuiEnabled) {
		let { onboardingProviderChoice } = await loadSettings()

		if (!onboardingProviderChoice) {
			const result = await runOnboarding()
			onboardingProviderChoice = result.choice
		}

		if (onboardingProviderChoice === OnboardingProviderChoice.Roo) {
			useCloudProvider = true
			const authenticated = await hasToken()

			if (authenticated) {
				const token = await loadToken()

				if (token) {
					try {
						const client = createClient({ url: SDK_BASE_URL, authToken: token })
						const me = await client.auth.me.query()
						provider = "roo"
						apiKey = token
						user = me?.type === "user" ? me.user : null
					} catch {
						// Token may be expired or invalid - user will need to re-authenticate.
					}
				}
			}
		}
	}

	if (!apiKey) {
		if (useCloudProvider) {
			console.error("[CLI] Error: Authentication with Roo Code Cloud failed or was cancelled.")
			console.error("[CLI] Please run: roo auth login")
			console.error("[CLI] Or use --api-key to provide your own API key.")
		} else {
			console.error(
				`[CLI] Error: No API key provided. Use --api-key or set the appropriate environment variable.`,
			)
			console.error(`[CLI] For ${provider}, set ${getEnvVarName(provider)}`)
		}

		process.exit(1)
	}

	if (!fs.existsSync(workspacePath)) {
		console.error(`[CLI] Error: Workspace path does not exist: ${workspacePath}`)
		process.exit(1)
	}

	if (!isProviderName(options.provider)) {
		console.error(`[CLI] Error: Invalid provider: ${options.provider}`)
		process.exit(1)
	}

	if (options.reasoningEffort && !REASONING_EFFORTS.includes(options.reasoningEffort)) {
		console.error(
			`[CLI] Error: Invalid reasoning effort: ${options.reasoningEffort}, must be one of: ${REASONING_EFFORTS.join(", ")}`,
		)
		process.exit(1)
	}

	if (options.tui && !isTuiSupported) {
		console.log("[CLI] TUI disabled (no TTY support), falling back to plain text mode")
	}

	if (!isTuiEnabled && !options.prompt) {
		console.error("[CLI] Error: prompt is required in plain text mode")
		console.error("[CLI] Usage: roo [workspace] -P <prompt> [options]")
		console.error("[CLI] Use TUI mode (without --no-tui) for interactive input")
		process.exit(1)
	}

	if (isTuiEnabled) {
		try {
			const { render } = await import("ink")
			const { App } = await import("../../ui/App.js")

			render(
				createElement(App, {
					initialPrompt: options.prompt || "",
					workspacePath: workspacePath,
					extensionPath: path.resolve(extensionPath),
					user,
					provider,
					apiKey,
					model: options.model || DEFAULT_FLAGS.model,
					mode: options.mode || DEFAULT_FLAGS.mode,
					nonInteractive: options.yes,
					debug: options.debug,
					exitOnComplete: options.exitOnComplete,
					reasoningEffort: options.reasoningEffort,
					ephemeral: options.ephemeral,
					version: VERSION,
					// Create extension host factory for dependency injection.
					createExtensionHost: (opts: ExtensionHostOptions) => new ExtensionHost(opts),
				}),
				// Handle Ctrl+C in App component for double-press exit.
				{ exitOnCtrlC: false },
			)
		} catch (error) {
			console.error("[CLI] Failed to start TUI:", error instanceof Error ? error.message : String(error))

			if (error instanceof Error) {
				console.error(error.stack)
			}

			process.exit(1)
		}
	} else {
		console.log(ASCII_ROO)
		console.log()
		console.log(
			`[roo] Running ${options.model || "default"} (${options.reasoningEffort || "default"}) on ${provider} in ${options.mode || "default"} mode in ${workspacePath}`,
		)

		const host = new ExtensionHost({
			mode: options.mode || DEFAULT_FLAGS.mode,
			reasoningEffort: options.reasoningEffort === "unspecified" ? undefined : options.reasoningEffort,
			user,
			provider,
			apiKey,
			model: options.model || DEFAULT_FLAGS.model,
			workspacePath,
			extensionPath: path.resolve(extensionPath),
			nonInteractive: options.yes,
			ephemeral: options.ephemeral,
			debug: options.debug,
		})

		process.on("SIGINT", async () => {
			console.log("\n[CLI] Received SIGINT, shutting down...")
			await host.dispose()
			process.exit(130)
		})

		process.on("SIGTERM", async () => {
			console.log("\n[CLI] Received SIGTERM, shutting down...")
			await host.dispose()
			process.exit(143)
		})

		try {
			await host.activate()
			await host.runTask(options.prompt!)
			await host.dispose()

			if (!options.waitOnComplete) {
				process.exit(0)
			}
		} catch (error) {
			console.error("[CLI] Error:", error instanceof Error ? error.message : String(error))

			if (error instanceof Error) {
				console.error(error.stack)
			}

			await host.dispose()
			process.exit(1)
		}
	}
}
