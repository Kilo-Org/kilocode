// kilocode_change - new file for BMAD-METHOD modes integration with CustomModesManager

import type { ModeConfig } from "@roo-code/types"
import { BmadModeManager } from "./BmadModeManager"
import { BmadConfigManager } from "./config"
import { logger } from "../../utils/logging"
import { t } from "../../i18n"

/**
 * BMAD modes integrator
 * Integrates BMAD modes with Kilo Code's CustomModesManager
 */
export class BmadModesIntegrator {
	private modeManager: BmadModeManager
	private configManager: BmadConfigManager
	private isInitialized = false
	private isSyncEnabled = false
	private syncInterval?: NodeJS.Timeout

	constructor(modeManager: BmadModeManager, configManager: BmadConfigManager) {
		this.modeManager = modeManager
		this.configManager = configManager
	}

	/**
	 * Initialize the integrator
	 */
	async initialize(): Promise<void> {
		try {
			if (this.isInitialized) {
				logger.warn("[BmadModesIntegrator] Already initialized")
				return
			}

			// Wait for mode manager to be ready
			await this.modeManager.initialize()

			// Check if auto-sync is enabled
			this.isSyncEnabled = this.configManager.getConfig().autoSyncModes

			if (this.isSyncEnabled) {
				// Setup periodic sync
				this.setupPeriodicSync()
				logger.info("[BmadModesIntegrator] Auto-sync enabled")
			}

			this.isInitialized = true
			logger.info("[BmadModesIntegrator] Initialized successfully")
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("[BmadModesIntegrator] Failed to initialize", { error: errorMessage })
			throw new Error(`Failed to initialize BMAD modes integrator: ${errorMessage}`)
		}
	}

	/**
	 * Setup periodic synchronization
	 */
	private setupPeriodicSync(): void {
		const syncInterval = this.configManager.getConfig().syncInterval

		// Clear existing interval
		if (this.syncInterval) {
			clearInterval(this.syncInterval)
		}

		// Setup new interval
		this.syncInterval = setInterval(() => {
			this.syncBmadModes().catch((error) => {
				logger.error("[BmadModesIntegrator] Periodic sync failed", {
					error: error instanceof Error ? error.message : String(error),
				})
			})
		}, syncInterval)

		logger.info("[BmadModesIntegrator] Periodic sync configured", { interval: syncInterval })
	}

	/**
	 * Sync BMAD modes to CustomModesManager
	 * This method should be called by the extension to integrate BMAD modes
	 */
	async syncBmadModes(): Promise<ModeConfig[]> {
		try {
			if (!this.modeManager.isReady()) {
				logger.warn("[BmadModesIntegrator] Mode manager not ready, skipping sync")
				return []
			}

			logger.info("[BmadModesIntegrator] Syncing BMAD modes")

			// Get all BMAD mode configurations
			const bmadModes = this.modeManager.createAllKiloCodeModes()

			// Convert to ModeConfig format
			const modeConfigs: ModeConfig[] = bmadModes.map((mode) => ({
				slug: mode.slug,
				name: mode.name,
				description: mode.description,
				roleDefinition: mode.customInstructions || "",
				customInstructions: mode.customInstructions || "",
				icon: mode.icon,
				groups: ["read", "edit", "browser", "command", "mcp"],
				// Mark as BMAD mode
				metadata: mode.metadata,
			}))

			logger.info("[BmadModesIntegrator] Synced BMAD modes", { count: modeConfigs.length })

			return modeConfigs
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("[BmadModesIntegrator] Failed to sync modes", { error: errorMessage })
			return []
		}
	}

	/**
	 * Get BMAD modes for integration
	 * This is the main method that CustomModesManager will call
	 */
	async getBmadModes(): Promise<ModeConfig[]> {
		if (!this.isInitialized) {
			logger.warn("[BmadModesIntegrator] Not initialized, returning empty modes")
			return []
		}

		return await this.syncBmadModes()
	}

	/**
	 * Check if a mode slug is a BMAD mode
	 */
	isBmadMode(modeSlug: string): boolean {
		return this.modeManager.isBmadMode(modeSlug)
	}

	/**
	 * Get BMAD mode by slug
	 */
	getBmadMode(modeSlug: string): ModeConfig | undefined {
		const mapping = this.modeManager.getMappingByModeSlug(modeSlug)
		if (!mapping) {
			return undefined
		}

		return this.modeManager.createKiloCodeMode(mapping)
	}

	/**
	 * Get all BMAD mode slugs
	 */
	getBmadModeSlugs(): string[] {
		return this.modeManager.getAllMappings().map((mapping) => mapping.modeSlug)
	}

	/**
	 * Get recommended agents for a task
	 */
	getRecommendedAgentsForTask(taskDescription: string): ModeConfig[] {
		const recommendations = this.modeManager.getRecommendedAgentsForTask(taskDescription)
		return recommendations.map((rec) => this.modeManager.createKiloCodeMode(rec))
	}

	/**
	 * Get agent for a mode
	 */
	getAgentForMode(modeSlug: string) {
		return this.modeManager.getAgentForMode(modeSlug)
	}

	/**
	 * Get mode statistics
	 */
	getStatistics(): {
		totalModes: number
		modesByModule: Record<string, number>
		modesByRole: Record<string, number>
	} {
		const stats = this.modeManager.getStatistics()
		return {
			totalModes: stats.totalMappings,
			modesByModule: stats.mappingsByModule,
			modesByRole: stats.mappingsByRole,
		}
	}

	/**
	 * Enable or disable auto-sync
	 */
	setAutoSyncEnabled(enabled: boolean): void {
		this.isSyncEnabled = enabled

		if (enabled) {
			this.setupPeriodicSync()
			logger.info("[BmadModesIntegrator] Auto-sync enabled")
		} else {
			if (this.syncInterval) {
				clearInterval(this.syncInterval)
				this.syncInterval = undefined
			}
			logger.info("[BmadModesIntegrator] Auto-sync disabled")
		}
	}

	/**
	 * Check if auto-sync is enabled
	 */
	isAutoSyncEnabled(): boolean {
		return this.isSyncEnabled
	}

	/**
	 * Trigger manual sync
	 */
	async triggerSync(): Promise<ModeConfig[]> {
		logger.info("[BmadModesIntegrator] Manual sync triggered")
		return await this.syncBmadModes()
	}

	/**
	 * Check if initialized
	 */
	isReady(): boolean {
		return this.isInitialized
	}

	/**
	 * Dispose of resources
	 */
	dispose(): void {
		if (this.syncInterval) {
			clearInterval(this.syncInterval)
			this.syncInterval = undefined
		}

		this.isInitialized = false
		logger.info("[BmadModesIntegrator] Disposed")
	}
}

/**
 * Singleton instance for the BMAD modes integrator
 */
let integratorInstance: BmadModesIntegrator | null = null

/**
 * Get the BMAD modes integrator instance
 */
export function getBmadModesIntegrator(
	modeManager: BmadModeManager,
	configManager: BmadConfigManager,
): BmadModesIntegrator {
	if (!integratorInstance) {
		integratorInstance = new BmadModesIntegrator(modeManager, configManager)
	}
	return integratorInstance
}

/**
 * Dispose the BMAD modes integrator instance
 */
export function disposeBmadModesIntegrator(): void {
	if (integratorInstance) {
		integratorInstance.dispose()
		integratorInstance = null
	}
}
