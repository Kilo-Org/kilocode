import { basename } from "node:path"
import { render, Instance } from "ink"
import React from "react"
import { createStore } from "jotai"
import { createExtensionService, ExtensionService } from "./services/extension.js"
import { App } from "./ui/App.js"
import { logs } from "./services/logs.js"
import { extensionServiceAtom } from "./state/atoms/service.js"
import { initializeServiceEffectAtom } from "./state/atoms/effects.js"
import { loadConfigAtom, mappedExtensionStateAtom, providersAtom } from "./state/atoms/config.js"
import { ciExitReasonAtom } from "./state/atoms/ci.js"
import { requestRouterModelsAtom } from "./state/atoms/actions.js"
import { loadHistoryAtom } from "./state/atoms/history.js"
import { getTelemetryService, getIdentityManager } from "./services/telemetry/index.js"
import { notificationsAtom, notificationsErrorAtom, notificationsLoadingAtom } from "./state/atoms/notifications.js"
import { fetchKilocodeNotifications } from "./utils/notifications.js"

export interface CLIOptions {
	mode?: string
	workspace?: string
	ci?: boolean
	prompt?: string
	timeout?: number
}

/**
 * Main application class that orchestrates the CLI lifecycle
 */
export class CLI {
	private service: ExtensionService | null = null
	private store: ReturnType<typeof createStore> | null = null
	private ui: Instance | null = null
	private options: CLIOptions
	private isInitialized = false

	constructor(options: CLIOptions = {}) {
		this.options = options
	}

	/**
	 * Initialize the application
	 * - Creates ExtensionService
	 * - Sets up Jotai store
	 * - Initializes service through effects
	 */
	async initialize(): Promise<void> {
		if (this.isInitialized) {
			logs.warn("Application already initialized", "CLI")
			return
		}

		try {
			logs.info("Initializing Kilo Code CLI...", "CLI")

			// Set terminal title
			const folderName = basename(this.options.workspace || process.cwd())
			process.stdout.write(`\x1b]0;Kilo Code - ${folderName}\x07`)

			// Create Jotai store
			this.store = createStore()
			logs.debug("Jotai store created", "CLI")

			// Initialize telemetry service first to get identity
			const config = await this.store.set(loadConfigAtom, this.options.mode)
			logs.debug("CLI configuration loaded", "CLI", { mode: this.options.mode })

			const telemetryService = getTelemetryService()
			await telemetryService.initialize(config, {
				workspace: this.options.workspace || process.cwd(),
				mode: this.options.mode || "code",
				ciMode: this.options.ci || false,
			})
			logs.debug("Telemetry service initialized", "CLI")

			// Get identity from Identity Manager
			const identityManager = getIdentityManager()
			const identity = identityManager.getIdentity()

			// Create ExtensionService with identity
			const serviceOptions: Parameters<typeof createExtensionService>[0] = {
				workspace: this.options.workspace || process.cwd(),
				mode: this.options.mode || "code",
			}

			if (identity) {
				serviceOptions.identity = {
					machineId: identity.machineId,
					sessionId: identity.sessionId,
					cliUserId: identity.cliUserId,
				}
			}

			this.service = createExtensionService(serviceOptions)
			logs.debug("ExtensionService created with identity", "CLI", {
				hasIdentity: !!identity,
			})

			// Set service in store
			this.store.set(extensionServiceAtom, this.service)
			logs.debug("ExtensionService set in store", "CLI")

			// Track extension initialization
			telemetryService.trackExtensionInitialized(false) // Will be updated after actual initialization

			// Initialize service through effect atom
			// This sets up all event listeners and activates the extension
			await this.store.set(initializeServiceEffectAtom, this.store)
			logs.info("ExtensionService initialized through effects", "CLI")

			// Track successful extension initialization
			telemetryService.trackExtensionInitialized(true)

			// Load command history
			await this.store.set(loadHistoryAtom)
			logs.debug("Command history loaded", "CLI")

			// Inject CLI configuration into ExtensionHost
			await this.injectConfigurationToExtension()
			logs.debug("CLI configuration injected into extension", "CLI")

			// Request router models after configuration is injected
			void this.requestRouterModels()

			if (!this.options.ci && !this.options.prompt) {
				// Fetch Kilocode notifications if provider is kilocode
				void this.fetchNotifications()
			}

			this.isInitialized = true
			logs.info("Kilo Code CLI initialized successfully", "CLI")
		} catch (error) {
			logs.error("Failed to initialize CLI", "CLI", { error })
			throw error
		}
	}

	/**
	 * Start the application
	 * - Initializes if not already done
	 * - Renders the UI
	 * - Waits for exit
	 */
	async start(): Promise<void> {
		// Initialize if not already done
		if (!this.isInitialized) {
			await this.initialize()
		}

		if (!this.store) {
			throw new Error("Store not initialized")
		}

		// Render UI with store
		// Disable stdin for Ink when in CI mode or when stdin is piped (not a TTY)
		// This prevents the "Raw mode is not supported" error
		const shouldDisableStdin = this.options.ci || !process.stdin.isTTY
		this.ui = render(
			React.createElement(App, {
				store: this.store,
				options: {
					mode: this.options.mode || "code",
					workspace: this.options.workspace || process.cwd(),
					ci: this.options.ci || false,
					prompt: this.options.prompt || "",
					...(this.options.timeout !== undefined && { timeout: this.options.timeout }),
				},
				onExit: () => this.dispose(),
			}),
			shouldDisableStdin
				? {
						stdout: process.stdout,
						stderr: process.stderr,
					}
				: undefined,
		)

		// Wait for UI to exit
		await this.ui.waitUntilExit()
	}

	/**
	 * Dispose the application and clean up resources
	 * - Unmounts UI
	 * - Disposes service
	 * - Cleans up store
	 */
	async dispose(): Promise<void> {
		try {
			logs.info("Disposing Kilo Code CLI...", "CLI")

			// Determine exit code based on CI mode and exit reason
			let exitCode = 0

			if (this.options.ci && this.store) {
				// Check exit reason from CI atoms
				const exitReason = this.store.get(ciExitReasonAtom)

				// Set exit code based on the actual exit reason
				if (exitReason === "timeout") {
					exitCode = 124
					logs.warn("Exiting with timeout code", "CLI")
					// Track CI mode timeout
					getTelemetryService().trackCIModeTimeout()
				} else if (exitReason === "completion_result" || exitReason === "command_finished") {
					exitCode = 0
					logs.info("Exiting with success code", "CLI", { reason: exitReason })
				} else {
					// No exit reason set - this shouldn't happen in normal flow
					exitCode = 1
					logs.info("Exiting with default failure code", "CLI")
				}
			}

			// Shutdown telemetry service before exiting
			const telemetryService = getTelemetryService()
			await telemetryService.shutdown()
			logs.debug("Telemetry service shut down", "CLI")

			// Unmount UI
			if (this.ui) {
				await this.ui.unmount()
				this.ui = null
			}

			// Dispose service
			if (this.service) {
				await this.service.dispose()
				this.service = null
			}

			// Clear store reference
			this.store = null

			this.isInitialized = false
			logs.info("Kilo Code CLI disposed", "CLI")

			// Exit process with appropriate code
			process.exit(exitCode)
		} catch (error) {
			logs.error("Error disposing CLI", "CLI", { error })
			process.exit(1)
		}
	}

	/**
	 * Inject CLI configuration into the extension host
	 */
	private async injectConfigurationToExtension(): Promise<void> {
		if (!this.service || !this.store) {
			logs.warn("Cannot inject configuration: service or store not available", "CLI")
			return
		}

		try {
			// Get the mapped extension state from config atoms
			const mappedState = this.store.get(mappedExtensionStateAtom)

			logs.debug("Mapped config state for injection", "CLI", {
				mode: mappedState.mode,
				telemetry: mappedState.telemetrySetting,
				provider: mappedState.currentApiConfigName,
			})

			// Get the extension host from the service
			const extensionHost = this.service.getExtensionHost()

			// Inject the configuration (await to ensure mode/telemetry messages are sent)
			await extensionHost.injectConfiguration(mappedState)

			logs.info("Configuration injected into extension host", "CLI")
		} catch (error) {
			logs.error("Failed to inject configuration into extension host", "CLI", { error })
		}
	}

	/**
	 * Request router models from the extension
	 */
	private async requestRouterModels(): Promise<void> {
		if (!this.service || !this.store) {
			logs.warn("Cannot request router models: service or store not available", "CLI")
			return
		}

		try {
			await this.store.set(requestRouterModelsAtom)
			logs.debug("Router models requested", "CLI")
		} catch (error) {
			logs.error("Failed to request router models", "CLI", { error })
		}
	}

	/**
	 * Fetch notifications from Kilocode backend if provider is kilocode
	 */
	private async fetchNotifications(): Promise<void> {
		if (!this.store) {
			logs.warn("Cannot fetch notifications: store not available", "CLI")
			return
		}

		try {
			const providers = this.store.get(providersAtom)

			const provider = providers.find(({ provider }) => provider === "kilocode")

			if (!provider) {
				logs.debug("No provider configured, skipping notification fetch", "CLI")
				return
			}

			this.store.set(notificationsLoadingAtom, true)

			const notifications = await fetchKilocodeNotifications(provider)

			this.store.set(notificationsAtom, notifications)
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error))
			this.store.set(notificationsErrorAtom, err)
			logs.error("Failed to fetch notifications", "CLI", { error })
		} finally {
			this.store.set(notificationsLoadingAtom, false)
		}
	}

	/**
	 * Get the ExtensionService instance
	 */
	getService(): ExtensionService | null {
		return this.service
	}

	/**
	 * Get the Jotai store instance
	 */
	getStore(): ReturnType<typeof createStore> | null {
		return this.store
	}

	/**
	 * Check if the application is initialized
	 */
	isReady(): boolean {
		return this.isInitialized
	}
}
