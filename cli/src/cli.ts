import { basename } from "node:path"
import { render, Instance } from "ink"
import React from "react"
import { createStore } from "jotai"
import { createExtensionService, ExtensionService } from "./services/extension.js"
import { App } from "./ui/App.js"
import { logs } from "./services/logs.js"
import { extensionServiceAtom } from "./state/atoms/service.js"
import { initializeServiceEffectAtom } from "./state/atoms/effects.js"
import { loadConfigAtom, mappedExtensionStateAtom, providersAtom, saveConfigAtom } from "./state/atoms/config.js"
import { ciExitReasonAtom } from "./state/atoms/ci.js"
import { requestRouterModelsAtom } from "./state/atoms/actions.js"
import { loadHistoryAtom } from "./state/atoms/history.js"
import {
	addPendingRequestAtom,
	TaskHistoryData,
	taskHistoryDataAtom,
	updateTaskHistoryFiltersAtom,
} from "./state/atoms/taskHistory.js"
import { sendWebviewMessageAtom } from "./state/atoms/actions.js"
import { taskResumedViaContinueOrSessionAtom, currentTaskAtom } from "./state/atoms/extension.js"
import { getTelemetryService, getIdentityManager } from "./services/telemetry/index.js"
import { notificationsAtom, notificationsErrorAtom, notificationsLoadingAtom } from "./state/atoms/notifications.js"
import { fetchKilocodeNotifications } from "./utils/notifications.js"
import { finishParallelMode } from "./parallel/parallel.js"
import { isGitWorktree } from "./utils/git.js"
import { Package } from "./constants/package.js"
import type { CLIOptions } from "./types/cli.js"
import type { CLIConfig, ProviderConfig } from "./config/types.js"
import { getModelIdKey } from "./constants/providers/models.js"
import type { ProviderName } from "./types/messages.js"
import { getSelectedModelId } from "./utils/providers.js"
import { KiloCodePathProvider, ExtensionMessengerAdapter } from "./services/session-adapters.js"
import { getKiloToken } from "./config/persistence.js"
import { SessionManager } from "../../src/shared/kilocode/cli-sessions/core/SessionManager.js"

/**
 * Main application class that orchestrates the CLI lifecycle
 */
export class CLI {
	private service: ExtensionService | null = null
	private store: ReturnType<typeof createStore> | null = null
	private ui: Instance | null = null
	private options: CLIOptions
	private isInitialized = false
	private sessionService: SessionManager | null = null

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
			logs.info(`Version: ${Package.version}`, "CLI")

			// Set terminal title - use process.cwd() in parallel mode to show original directory
			const titleWorkspace = this.options.parallel ? process.cwd() : this.options.workspace || process.cwd()
			const folderName = `${basename(titleWorkspace)}${(await isGitWorktree(this.options.workspace || "")) ? " (git worktree)" : ""}`
			process.stdout.write(`\x1b]0;Kilo Code - ${folderName}\x07`)

			// Create Jotai store
			this.store = createStore()
			logs.debug("Jotai store created", "CLI")

			// Initialize telemetry service first to get identity
			let config = await this.store.set(loadConfigAtom, this.options.mode)
			logs.debug("CLI configuration loaded", "CLI", { mode: this.options.mode })

			// Apply provider and model overrides from CLI
			if (this.options.provider || this.options.model) {
				config = await this.applyProviderModelOverrides(config)
				// Save the updated config to persist changes
				await this.store.set(saveConfigAtom, config)
				logs.info("Provider/model overrides applied and saved", "CLI")
			}

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

			if (this.options.customModes) {
				serviceOptions.customModes = this.options.customModes
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

			// Initialize services and restore session if kiloToken is available
			// This must happen AFTER ExtensionService initialization to allow webview messages
			const kiloToken = getKiloToken(config)

			if (kiloToken) {
				// Inject CLI configuration into ExtensionHost
				// This must happen BEFORE session restoration to ensure org ID is set
				await this.injectConfigurationToExtension()
				logs.debug("CLI configuration injected into extension", "CLI")

				const pathProvider = new KiloCodePathProvider()
				const extensionMessenger = new ExtensionMessengerAdapter(this.service)

				this.sessionService = SessionManager.init({
					pathProvider,
					logger: logs,
					extensionMessenger,
					getToken: () => Promise.resolve(kiloToken),
					onSessionCreated: (message) => {
						if (this.options.json) {
							console.log(JSON.stringify(message))
						}
					},
					onSessionRestored: () => {
						if (this.store) {
							this.store.set(taskResumedViaContinueOrSessionAtom, true)
						}
					},
					onSessionSynced: (message) => {
						if (this.options.json) {
							console.log(JSON.stringify(message))
						}
					},
					onSessionTitleGenerated: (message) => {
						if (this.options.json) {
							console.log(JSON.stringify(message))
						}
					},
					platform: "cli",
					getOrganizationId: async () => {
						const state = this.service?.getState()
						const result = state?.apiConfiguration?.kilocodeOrganizationId

						logs.debug(`Resolved organization ID: "${result}"`, "SessionManager")

						return result
					},
					getMode: async () => {
						const state = this.service?.getState()
						const result = state?.mode

						logs.debug(`Resolved mode: "${result}"`, "SessionManager")

						return result
					},
					getModel: async () => {
						const state = this.service?.getState()
						const provider = state?.apiConfiguration?.apiProvider
						const result = getSelectedModelId(provider || "unknown", state?.apiConfiguration)

						logs.debug(`Resolved model: "${result}"`, "SessionManager")

						return result
					},
					getParentTaskId: async (taskId: string) => {
						const result = await (async () => {
							try {
								// Check if the current task matches the taskId
								const currentTask = this.store?.get(currentTaskAtom)

								if (currentTask?.id === taskId) {
									return currentTask.parentTaskId
								}

								// Otherwise, fetch the task from history using promise-based request/response pattern
								const requestId = crypto.randomUUID()

								// Create a promise that will be resolved when the response arrives
								const responsePromise = new Promise<TaskHistoryData>((resolve, reject) => {
									const timeout = setTimeout(() => {
										reject(new Error("Task history request timed out"))
									}, 5000) // 5 second timeout as fallback

									this.store?.set(addPendingRequestAtom, {
										requestId,
										resolve,
										reject,
										timeout,
									})
								})

								// Send task history request to get the specific task
								await this.store?.set(sendWebviewMessageAtom, {
									type: "taskHistoryRequest",
									payload: {
										requestId,
										workspace: "current",
										sort: "newest",
										favoritesOnly: false,
										pageIndex: 0,
									},
								})

								// Wait for the actual response (not a timer)
								const taskHistoryData = await responsePromise
								const task = taskHistoryData.historyItems.find((item) => item.id === taskId)

								return task?.parentTaskId
							} catch {
								return undefined
							}
						})()

						logs.debug(`Resolved parent task ID for task ${taskId}: "${result}"`, "SessionManager")

						return result || undefined
					},
				})
				logs.debug("SessionManager initialized with dependencies", "CLI")

				const workspace = this.options.workspace || process.cwd()
				this.sessionService?.setWorkspaceDirectory(workspace)
				logs.debug("SessionManager workspace directory set", "CLI", { workspace })

				if (this.options.session) {
					await this.sessionService?.restoreSession(this.options.session)
				} else if (this.options.fork) {
					logs.info("Forking session from share ID", "CLI", { shareId: this.options.fork })
					await this.sessionService?.forkSession(this.options.fork)
				}
			}

			// Load command history
			await this.store.set(loadHistoryAtom)
			logs.debug("Command history loaded", "CLI")

			// Inject CLI configuration into ExtensionHost
			// This happens after session restoration (if any) to ensure CLI config takes precedence
			// Session restoration may have activated a saved profile that doesn't include org ID from env vars
			await this.injectConfigurationToExtension()
			logs.debug("CLI configuration injected into extension", "CLI")

			const extensionHost = this.service.getExtensionHost()
			// In JSON-IO mode, don't set yoloMode on the extension host.
			// This prevents Task.ts from auto-answering followup questions.
			// The CLI's approval layer handles YOLO behavior and correctly excludes followups.
			if (!this.options.jsonInteractive) {
				extensionHost.sendWebviewMessage({
					type: "yoloMode",
					bool: Boolean(this.options.ci || this.options.yolo),
				})
			}

			// Request router models after configuration is injected
			void this.requestRouterModels()

			if (!this.options.ci && !this.options.prompt) {
				// Fetch Kilocode notifications if provider is kilocode
				void this.fetchNotifications()
			}

			// Resume conversation if continue mode is enabled
			if (this.options.continue) {
				await this.resumeLastConversation()
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
		const shouldDisableStdin = this.options.jsonInteractive || this.options.ci || !process.stdin.isTTY

		this.ui = render(
			React.createElement(App, {
				store: this.store,
				options: {
					mode: this.options.mode || "code",
					workspace: this.options.workspace || process.cwd(),
					ci: this.options.ci || false,
					yolo: this.options.yolo || false,
					json: this.options.json || false,
					jsonInteractive: this.options.jsonInteractive || false,
					prompt: this.options.prompt || "",
					...(this.options.timeout !== undefined && { timeout: this.options.timeout }),
					parallel: this.options.parallel || false,
					worktreeBranch: this.options.worktreeBranch || undefined,
					noSplash: this.options.noSplash || false,
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
	 * Apply provider and model overrides from CLI options
	 */
	private async applyProviderModelOverrides(config: CLIConfig): Promise<CLIConfig> {
		const updatedConfig = { ...config }

		// Apply provider override
		if (this.options.provider) {
			const provider = config.providers.find((p) => p.id === this.options.provider)
			if (provider) {
				updatedConfig.provider = this.options.provider
				logs.info(`Provider overridden to: ${this.options.provider}`, "CLI")
			}
		}

		// Apply model override
		if (this.options.model) {
			const activeProviderId = updatedConfig.provider
			const providerIndex = updatedConfig.providers.findIndex((p) => p.id === activeProviderId)

			if (providerIndex !== -1) {
				const provider = updatedConfig.providers[providerIndex]
				if (provider) {
					const modelField = getModelIdKey(provider.provider as ProviderName)

					// Update the provider's model field
					updatedConfig.providers[providerIndex] = {
						...provider,
						[modelField]: this.options.model,
					} as ProviderConfig
					logs.info(`Model overridden to: ${this.options.model} for provider ${activeProviderId}`, "CLI")
				}
			}
		}

		return updatedConfig
	}

	private isDisposing = false

	/**
	 * Dispose the application and clean up resources
	 * - Unmounts UI
	 * - Disposes service
	 * - Cleans up store
	 */
	async dispose(signal?: string): Promise<void> {
		if (this.isDisposing) {
			logs.info("Already disposing, ignoring duplicate dispose call", "CLI")

			return
		}

		this.isDisposing = true

		// Determine exit code based on signal type and CI mode
		let exitCode = 0

		let beforeExit = () => {}

		try {
			logs.info("Disposing Kilo Code CLI...", "CLI")

			await this.sessionService?.doSync(true)

			// Signal codes take precedence over CI logic
			if (signal === "SIGINT") {
				exitCode = 130
				logs.info("Exiting with SIGINT code (130)", "CLI")
			} else if (signal === "SIGTERM") {
				exitCode = 143
				logs.info("Exiting with SIGTERM code (143)", "CLI")
			} else if (this.options.ci && this.store) {
				// CI mode logic only when not interrupted by signal
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

			// In parallel mode, we need to do manual git worktree cleanup
			if (this.options.parallel) {
				beforeExit = await finishParallelMode(this, this.options.workspace!, this.options.worktreeBranch!)
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
		} catch (error) {
			logs.error("Error disposing CLI", "CLI", { error })

			exitCode = 1
		} finally {
			beforeExit()

			// Exit process with appropriate code
			process.exit(exitCode)
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
	 * Resume the last conversation from the current workspace
	 */
	private async resumeLastConversation(): Promise<void> {
		if (!this.service || !this.store) {
			logs.error("Cannot resume conversation: service or store not available", "CLI")
			throw new Error("Service or store not initialized")
		}

		const workspace = this.options.workspace || process.cwd()

		try {
			logs.info("Attempting to resume last conversation", "CLI", { workspace })

			// First, try to restore from persisted session ID if kiloToken is available
			if (this.sessionService) {
				const restored = await this.sessionService.restoreLastSession()
				if (restored) {
					return
				}

				logs.debug("Falling back to task history", "CLI")
			}

			// Fallback: Use task history approach
			logs.debug("Using task history fallback to resume conversation", "CLI")

			// Update filters to current workspace and newest sort
			this.store.set(updateTaskHistoryFiltersAtom, {
				workspace: "current",
				sort: "newest",
				favoritesOnly: false,
			})

			// Send task history request to extension
			await this.store.set(sendWebviewMessageAtom, {
				type: "taskHistoryRequest",
				payload: {
					requestId: Date.now().toString(),
					workspace: "current",
					sort: "newest",
					favoritesOnly: false,
					pageIndex: 0,
				},
			})

			// Wait for the data to arrive (the response will update taskHistoryDataAtom through effects)
			await new Promise((resolve) => setTimeout(resolve, 2000))

			// Get the task history data
			const taskHistoryData = this.store.get(taskHistoryDataAtom)

			if (!taskHistoryData || !taskHistoryData.historyItems || taskHistoryData.historyItems.length === 0) {
				logs.warn("No previous tasks found for workspace", "CLI", { workspace })
				console.error("\nNo previous tasks found for this workspace. Please start a new conversation.\n")
				process.exit(1)
			}

			// Find the most recent task (first in the list since we sorted by newest)
			const lastTask = taskHistoryData.historyItems[0]

			if (!lastTask) {
				logs.warn("No valid task found in history", "CLI", { workspace })
				console.error("\nNo valid task found to resume. Please start a new conversation.\n")
				process.exit(1)
			}

			logs.debug("Found last task", "CLI", { taskId: lastTask.id, task: lastTask.task })

			// Send message to resume the task
			await this.store.set(sendWebviewMessageAtom, {
				type: "showTaskWithId",
				text: lastTask.id,
			})

			// Mark that the task was resumed via --continue to prevent showing "Task ready to resume" message
			this.store.set(taskResumedViaContinueOrSessionAtom, true)

			logs.info("Task resume initiated", "CLI", { taskId: lastTask.id, task: lastTask.task })
		} catch (error) {
			logs.error("Failed to resume conversation", "CLI", { error, workspace })
			console.error("\nFailed to resume conversation. Please try starting a new conversation.\n")
			process.exit(1)
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
