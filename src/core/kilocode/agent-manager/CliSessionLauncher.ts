import * as vscode from "vscode"
import { findKilocodeCli, type CliDiscoveryResult } from "./CliPathResolver"
import { CliProcessHandler } from "./CliProcessHandler"
import type { StreamEvent } from "./CliOutputParser"
import { getRemoteUrl } from "../../../services/code-index/managed/git-utils"
import { normalizeGitUrl } from "./normalizeGitUrl"
import { buildProviderEnvOverrides } from "./providerEnvMapper"
import type { ProviderSettings } from "@roo-code/types"

/**
 * Options for spawning a CLI session
 */
export interface SpawnOptions {
	parallelMode?: boolean
	label?: string
	gitUrl?: string
	existingBranch?: string
	sessionId?: string
}

/**
 * Result of a spawn attempt
 */
export interface SpawnResult {
	success: boolean
	processStartTime?: number
}

/**
 * Callback to get API configuration for CLI environment variables
 */
export type GetApiConfigurationFn = () => Promise<ProviderSettings | undefined>

/**
 * CliSessionLauncher
 *
 * Encapsulates CLI session launching logic including:
 * - Pre-warming of slow lookups (CLI path, git URL)
 * - Environment variable setup for provider settings
 * - Process spawning coordination
 *
 * This class is responsible for the "how to launch a CLI session" concern,
 * separating it from the AgentManagerProvider's orchestration responsibilities.
 */
export class CliSessionLauncher {
	// Pre-warm promises for CLI path and git URL lookups
	private cliPathPromise: Promise<CliDiscoveryResult | null> | null = null
	private gitUrlPromise: Promise<string | undefined> | null = null

	constructor(
		private readonly outputChannel: vscode.OutputChannel,
		private readonly getApiConfiguration: GetApiConfigurationFn,
	) {}

	/**
	 * Start pre-warming slow lookups (CLI path and git URL) in parallel.
	 * Call this early (e.g., from constructor or panel open) so these complete
	 * well before the user clicks "Start" to reduce time-to-first-token.
	 *
	 * Pre-warming is idempotent - calling multiple times won't restart lookups.
	 */
	public startPrewarm(): void {
		// Pre-warm CLI path lookup (500-2000ms typically)
		this.cliPathPromise ??= findKilocodeCli((msg) => this.log(msg))

		// Pre-warm git URL lookup (50-100ms typically)
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
		if (workspaceFolder) {
			this.gitUrlPromise ??= getRemoteUrl(workspaceFolder)
				.then(normalizeGitUrl)
				.catch(() => undefined)
		}
	}

	/**
	 * Clear pre-warm promises.
	 * Call this when the panel closes or when you want to force fresh lookups.
	 */
	public clearPrewarm(): void {
		this.cliPathPromise = null
		this.gitUrlPromise = null
	}

	/**
	 * Get the pre-warmed git URL, or undefined if not available.
	 * This is useful for filtering sessions by git URL.
	 */
	public async getPrewarmedGitUrl(): Promise<string | undefined> {
		return this.gitUrlPromise ?? undefined
	}

	/**
	 * Get the pre-warmed CLI path, or null if not available.
	 * This is useful for terminal commands that need the resolved CLI path.
	 */
	public async getPrewarmedCliPath(): Promise<string | null> {
		const result = await this.cliPathPromise
		return result?.cliPath ?? null
	}

	/**
	 * Spawn a CLI process with all the standard setup.
	 * Handles CLI path lookup, git URL resolution, API config, and event callback wiring.
	 * Uses pre-warmed promises when available.
	 *
	 * @param prompt - The task prompt for the agent
	 * @param options - Spawn options (parallelMode, label, gitUrl, existingBranch, sessionId)
	 * @param processHandler - The CliProcessHandler to spawn the process with
	 * @param onCliEvent - Callback for CLI events
	 * @param onSetupFailed - Optional callback when setup fails (e.g., no workspace, CLI not found)
	 * @returns SpawnResult indicating success and process start time
	 */
	public async spawn(
		prompt: string,
		options: SpawnOptions,
		processHandler: CliProcessHandler,
		onCliEvent: (sessionId: string, event: StreamEvent) => void,
		onSetupFailed?: () => void,
	): Promise<SpawnResult> {
		const spawnStart = Date.now()

		// Validate workspace
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
		if (!workspaceFolder) {
			this.log("ERROR: No workspace folder open")
			onSetupFailed?.()
			return { success: false }
		}

		// Use pre-warmed CLI path promise if available, otherwise start fresh lookup
		const cliPathPromise = this.cliPathPromise ?? findKilocodeCli((msg) => this.log(msg))

		// Use pre-warmed git URL promise if available and no gitUrl provided in options
		const gitUrlPromise = this.resolveGitUrlPromise(options.gitUrl, workspaceFolder)

		// Run CLI path lookup, git URL lookup, and API config fetch in parallel
		const [cliDiscovery, resolvedGitUrl, apiConfiguration] = await Promise.all([
			cliPathPromise,
			gitUrlPromise,
			this.getApiConfiguration().catch((error) => {
				this.log(
					`Failed to read provider settings for CLI: ${error instanceof Error ? error.message : String(error)}`,
				)
				return undefined
			}),
		])

		this.log(
			`Parallel lookups completed in ${Date.now() - spawnStart}ms (CLI: ${cliDiscovery ? "found" : "not found"}, gitUrl: ${resolvedGitUrl ?? "none"})`,
		)

		// Clear pre-warm promises after use (they're single-use per panel open)
		this.clearPrewarm()

		if (!cliDiscovery) {
			this.log("ERROR: kilocode CLI not found")
			onSetupFailed?.()
			return { success: false }
		}

		const processStartTime = Date.now()

		processHandler.spawnProcess(
			cliDiscovery.cliPath,
			workspaceFolder,
			prompt,
			{ ...options, gitUrl: resolvedGitUrl, apiConfiguration, shellPath: cliDiscovery.shellPath },
			onCliEvent,
		)

		return { success: true, processStartTime }
	}

	/**
	 * Build environment variables with API configuration overrides.
	 * Useful for testing or custom spawn scenarios.
	 */
	public buildEnvWithApiConfiguration(apiConfiguration?: ProviderSettings): NodeJS.ProcessEnv {
		const baseEnv = { ...process.env }

		const overrides = buildProviderEnvOverrides(
			apiConfiguration,
			baseEnv,
			(message) => this.log(message),
			(message) => this.log(message), // Debug log same as regular log for launcher
		)

		return {
			...baseEnv,
			...overrides,
			NO_COLOR: "1",
			FORCE_COLOR: "0",
			KILO_PLATFORM: "agent-manager",
		}
	}

	/**
	 * Resolve the git URL promise based on options and pre-warming state.
	 */
	private resolveGitUrlPromise(
		optionsGitUrl: string | undefined,
		workspaceFolder: string,
	): Promise<string | undefined> {
		// If gitUrl is explicitly provided in options, use it
		if (optionsGitUrl) {
			return Promise.resolve(optionsGitUrl)
		}

		// Use pre-warmed promise if available
		if (this.gitUrlPromise) {
			return this.gitUrlPromise
		}

		// Fall back to fresh lookup
		return getRemoteUrl(workspaceFolder)
			.then(normalizeGitUrl)
			.catch(() => undefined)
	}

	private log(message: string): void {
		this.outputChannel.appendLine(`[AgentManager] ${message}`)
	}
}
