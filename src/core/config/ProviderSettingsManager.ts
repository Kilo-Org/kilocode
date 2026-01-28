import { ExtensionContext } from "vscode"
import { z, ZodError } from "zod"
import deepEqual from "fast-deep-equal"

import {
	type ProviderSettingsWithId,
	providerSettingsWithIdSchema,
	discriminatedProviderSettingsWithIdSchema,
	isSecretStateKey,
	ProviderSettingsEntry,
	DEFAULT_CONSECUTIVE_MISTAKE_LIMIT,
	getModelId,
	type ProviderName,
	type ProfileType, // kilocode_change - autocomplete profile type system
	isProviderName,
} from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { Mode, modes } from "../../shared/modes"
import { migrateMorphApiKey } from "./kilocode/migrateMorphApiKey"
import { buildApiHandler } from "../../api"
import { t } from "../../i18n" // kilocode_change - autocomplete profile type system

// Type-safe model migrations mapping
type ModelMigrations = {
	[K in ProviderName]?: Record<string, string>
}

const MODEL_MIGRATIONS: ModelMigrations = {
	roo: {
		"roo/code-supernova": "roo/code-supernova-1-million",
	},
} as const satisfies ModelMigrations

export interface SyncCloudProfilesResult {
	hasChanges: boolean
	activeProfileChanged: boolean
	activeProfileId: string
}

export const providerProfilesSchema = z.object({
	currentApiConfigName: z.string(),
	apiConfigs: z.record(z.string(), providerSettingsWithIdSchema),
	modeApiConfigs: z.record(z.string(), z.string()).optional(),
	cloudProfileIds: z.array(z.string()).optional(),
	migrations: z
		.object({
			rateLimitSecondsMigrated: z.boolean().optional(),
			diffSettingsMigrated: z.boolean().optional(),
			openAiHeadersMigrated: z.boolean().optional(),
			consecutiveMistakeLimitMigrated: z.boolean().optional(),
			todoListEnabledMigrated: z.boolean().optional(),
			morphApiKeyMigrated: z.boolean().optional(), // kilocode_change: Morph API key migration
			claudeCodeLegacySettingsMigrated: z.boolean().optional(),
		})
		.optional(),
})

export type ProviderProfiles = z.infer<typeof providerProfilesSchema>

export class ProviderSettingsManager {
	private static readonly SCOPE_PREFIX = "roo_cline_config_"
	private readonly defaultConfigId = this.generateId()

	private readonly defaultModeApiConfigs: Record<string, string> = Object.fromEntries(
		modes.map((mode) => [mode.slug, this.defaultConfigId]),
	)

	// kilocode_change start: Anonymous kilocode onboarding - set default provider for new users
	private readonly defaultProviderProfiles: ProviderProfiles = {
		currentApiConfigName: "default",
		apiConfigs: {
			default: {
				id: this.defaultConfigId,
				apiProvider: "kilocode",
				kilocodeModel: "minimax/minimax-m2.1:free",
			},
		},
		modeApiConfigs: this.defaultModeApiConfigs,
		migrations: {
			rateLimitSecondsMigrated: true, // Mark as migrated on fresh installs
			diffSettingsMigrated: true, // Mark as migrated on fresh installs
			openAiHeadersMigrated: true, // Mark as migrated on fresh installs
			consecutiveMistakeLimitMigrated: true, // Mark as migrated on fresh installs
			todoListEnabledMigrated: true, // Mark as migrated on fresh installs
			claudeCodeLegacySettingsMigrated: true, // Mark as migrated on fresh installs
		},
	}
	// kilocode_change end

	// kilocode_change start
	private pendingDuplicateIdRepairReport: Record<string, string[]> | null = null

	public consumeDuplicateIdRepairReport(): Record<string, string[]> | null {
		const report = this.pendingDuplicateIdRepairReport
		this.pendingDuplicateIdRepairReport = null
		return report
	}
	// kilocode_change end

	private readonly context: ExtensionContext

	constructor(context: ExtensionContext) {
		this.context = context

		// TODO: We really shouldn't have async methods in the constructor.
		// kilocode_change start
		// only initialize ONCE, and save the promise in case somebody needs to wait.
		this.initialization = this.init_runMigrations()
		this.initialization.catch(console.error)
		// kilocode_change end
	}

	// kilocode_change start
	private readonly initialization: Promise<void>
	/**
	 * Wait for initialization migrations to complete.  These were started during construction.
	 * The odd active-verb name is retained to simplify roo-merged.
	 */
	public initialize(): Promise<void> {
		return this.initialization
	}

	private generateUniqueId(existingIds: Set<string>): string {
		let id: string
		do {
			id = this.generateId()
		} while (existingIds.has(id))

		existingIds.add(id)
		return id
	}
	// kilocode_change end

	public generateId() {
		return Math.random().toString(36).substring(2, 15)
	}

	// Synchronize readConfig/writeConfig operations to avoid data loss.
	private _lock = Promise.resolve()
	private lock<T>(cb: () => Promise<T>) {
		const next = this._lock.then(cb)
		this._lock = next.catch(() => {}) as Promise<void>
		return next
	}

	// kilocode_change: private & renamed:
	async init_runMigrations() {
		try {
			return await this.lock(async () => {
				// kilocode_change start: Check if this is a new user (no stored config)
				const storedContent = await this.context.secrets.get(this.secretsKey)
				const isNewUser = !storedContent
				// kilocode_change end

				const providerProfiles = await this.loadFromContent(storedContent)

				if (isNewUser) {
					await this.store(providerProfiles)
					return
				}

				let isDirty = false

				// Migrate existing installs to have per-mode API config map
				if (!providerProfiles.modeApiConfigs) {
					// Use the currently selected config for all modes initially
					const currentName = providerProfiles.currentApiConfigName
					const seedId =
						providerProfiles.apiConfigs[currentName]?.id ??
						Object.values(providerProfiles.apiConfigs)[0]?.id ??
						this.defaultConfigId
					providerProfiles.modeApiConfigs = Object.fromEntries(modes.map((m) => [m.slug, seedId]))
					isDirty = true
				}

				// Apply model migrations for all providers
				if (this.applyModelMigrations(providerProfiles)) {
					isDirty = true
				}

				// Ensure all configs have IDs.
				for (const [_name, apiConfig] of Object.entries(providerProfiles.apiConfigs)) {
					if (!apiConfig.id) {
						apiConfig.id = this.generateId()
						isDirty = true
					}
				}

				// kilocode_change start: Repair duplicated IDs (keep the first occurrence based on apiConfigs insertion order).
				const existingIds = new Set(
					Object.values(providerProfiles.apiConfigs)
						.map((c) => c.id)
						.filter((id): id is string => Boolean(id)),
				)

				const seenIds = new Set<string>()
				let updatedCloudProfileIds: Set<string> | undefined
				const duplicateIdRepairReport: Record<string, string[]> = {}

				for (const [name, apiConfig] of Object.entries(providerProfiles.apiConfigs)) {
					const id = apiConfig.id
					if (!id) continue

					// first profile keeps its id
					if (!seenIds.has(id)) {
						seenIds.add(id)
						continue
					}

					const newId = this.generateUniqueId(existingIds)
					apiConfig.id = newId
					isDirty = true

					duplicateIdRepairReport[id] ??= []
					duplicateIdRepairReport[id].push(newId)

					// If this was considered cloud-managed before (by virtue of its old id being listed),
					// keep it cloud-managed by adding the new id as well.
					if (providerProfiles.cloudProfileIds?.includes(id)) {
						updatedCloudProfileIds ??= new Set(providerProfiles.cloudProfileIds)
						updatedCloudProfileIds.add(newId)
					}

					console.warn(
						`[ProviderSettingsManager] Deduped duplicate provider profile id '${id}' for '${name}', new id '${newId}'`,
					)
				}

				if (updatedCloudProfileIds) {
					providerProfiles.cloudProfileIds = Array.from(updatedCloudProfileIds)
					isDirty = true
				}

				if (Object.keys(duplicateIdRepairReport).length > 0) {
					this.pendingDuplicateIdRepairReport = duplicateIdRepairReport
				}

				// Keep secrets-side references consistent (post-dedupe).
				const validProfileIds = new Set(
					Object.values(providerProfiles.apiConfigs)
						.map((c) => c.id)
						.filter((id): id is string => Boolean(id)),
				)

				const firstProfileId = Object.values(providerProfiles.apiConfigs)[0]?.id

				// Fix modeApiConfigs stored inside providerProfiles (secrets) if they point to a missing id.
				if (providerProfiles.modeApiConfigs && firstProfileId) {
					for (const [mode, configId] of Object.entries(providerProfiles.modeApiConfigs)) {
						if (!validProfileIds.has(configId)) {
							providerProfiles.modeApiConfigs[mode] = firstProfileId
							isDirty = true
						}
					}
				}
				// kilocode_Change end

				// Ensure migrations field exists
				if (!providerProfiles.migrations) {
					providerProfiles.migrations = {
						rateLimitSecondsMigrated: false,
						diffSettingsMigrated: false,
						openAiHeadersMigrated: false,
						consecutiveMistakeLimitMigrated: false,
						todoListEnabledMigrated: false,
						morphApiKeyMigrated: false, // kilocode_change: Morph API key migration
						claudeCodeLegacySettingsMigrated: false,
					} // Initialize with default values
					isDirty = true
				}

				if (!providerProfiles.migrations.rateLimitSecondsMigrated) {
					await this.migrateRateLimitSeconds(providerProfiles)
					providerProfiles.migrations.rateLimitSecondsMigrated = true
					isDirty = true
				}

				if (!providerProfiles.migrations.diffSettingsMigrated) {
					await this.migrateDiffSettings(providerProfiles)
					providerProfiles.migrations.diffSettingsMigrated = true
					isDirty = true
				}

				if (!providerProfiles.migrations.openAiHeadersMigrated) {
					await this.migrateOpenAiHeaders(providerProfiles)
					providerProfiles.migrations.openAiHeadersMigrated = true
					isDirty = true
				}

				if (!providerProfiles.migrations.consecutiveMistakeLimitMigrated) {
					await this.migrateConsecutiveMistakeLimit(providerProfiles)
					providerProfiles.migrations.consecutiveMistakeLimitMigrated = true
					isDirty = true
				}

				if (!providerProfiles.migrations.todoListEnabledMigrated) {
					await this.migrateTodoListEnabled(providerProfiles)
					providerProfiles.migrations.todoListEnabledMigrated = true
					isDirty = true
				}

				// kilocode_change start
				if (!providerProfiles.migrations.morphApiKeyMigrated) {
					const result = await migrateMorphApiKey(this.context, providerProfiles)
					providerProfiles.migrations.morphApiKeyMigrated = true
					isDirty ||= result
				}
				// kilocode_change end
				if (!providerProfiles.migrations.claudeCodeLegacySettingsMigrated) {
					// These keys were used by the removed local Claude Code CLI wrapper.
					for (const apiConfig of Object.values(providerProfiles.apiConfigs)) {
						if (apiConfig.apiProvider !== "claude-code") continue

						const config = apiConfig as unknown as Record<string, unknown>
						if ("claudeCodePath" in config) {
							delete config.claudeCodePath
							isDirty = true
						}
						if ("claudeCodeMaxOutputTokens" in config) {
							delete config.claudeCodeMaxOutputTokens
							isDirty = true
						}
					}

					providerProfiles.migrations.claudeCodeLegacySettingsMigrated = true
					isDirty = true
				}

				if (isDirty) {
					await this.store(providerProfiles)
				}
			})
		} catch (error) {
			throw new Error(`Failed to initialize config: ${error}`)
		}
	}

	private async migrateRateLimitSeconds(providerProfiles: ProviderProfiles) {
		try {
			let rateLimitSeconds: number | undefined

			try {
				rateLimitSeconds = await this.context.globalState.get<number>("rateLimitSeconds")
			} catch (error) {
				console.error("[MigrateRateLimitSeconds] Error getting global rate limit:", error)
			}

			if (rateLimitSeconds === undefined) {
				// Failed to get the existing value, use the default.
				rateLimitSeconds = 0
			}

			for (const [_name, apiConfig] of Object.entries(providerProfiles.apiConfigs)) {
				if (apiConfig.rateLimitSeconds === undefined) {
					apiConfig.rateLimitSeconds = rateLimitSeconds
				}
			}
		} catch (error) {
			console.error(`[MigrateRateLimitSeconds] Failed to migrate rate limit settings:`, error)
		}
	}

	private async migrateDiffSettings(providerProfiles: ProviderProfiles) {
		try {
			let diffEnabled: boolean | undefined
			let fuzzyMatchThreshold: number | undefined

			try {
				diffEnabled = await this.context.globalState.get<boolean>("diffEnabled")
				fuzzyMatchThreshold = await this.context.globalState.get<number>("fuzzyMatchThreshold")
			} catch (error) {
				console.error("[MigrateDiffSettings] Error getting global diff settings:", error)
			}

			if (diffEnabled === undefined) {
				// Failed to get the existing value, use the default.
				diffEnabled = true
			}

			if (fuzzyMatchThreshold === undefined) {
				// Failed to get the existing value, use the default.
				fuzzyMatchThreshold = 1.0
			}

			for (const [_name, apiConfig] of Object.entries(providerProfiles.apiConfigs)) {
				if (apiConfig.diffEnabled === undefined) {
					apiConfig.diffEnabled = diffEnabled
				}
				if (apiConfig.fuzzyMatchThreshold === undefined) {
					apiConfig.fuzzyMatchThreshold = fuzzyMatchThreshold
				}
			}
		} catch (error) {
			console.error(`[MigrateDiffSettings] Failed to migrate diff settings:`, error)
		}
	}

	private async migrateOpenAiHeaders(providerProfiles: ProviderProfiles) {
		try {
			for (const [_name, apiConfig] of Object.entries(providerProfiles.apiConfigs)) {
				// Use type assertion to access the deprecated property safely
				const configAny = apiConfig as any

				// Check if openAiHostHeader exists but openAiHeaders doesn't
				if (
					configAny.openAiHostHeader &&
					(!apiConfig.openAiHeaders || Object.keys(apiConfig.openAiHeaders || {}).length === 0)
				) {
					// Create the headers object with the Host value
					apiConfig.openAiHeaders = { Host: configAny.openAiHostHeader }

					// Delete the old property to prevent re-migration
					// This prevents the header from reappearing after deletion
					configAny.openAiHostHeader = undefined
				}
			}
		} catch (error) {
			console.error(`[MigrateOpenAiHeaders] Failed to migrate OpenAI headers:`, error)
		}
	}

	private async migrateConsecutiveMistakeLimit(providerProfiles: ProviderProfiles) {
		try {
			for (const [name, apiConfig] of Object.entries(providerProfiles.apiConfigs)) {
				if (apiConfig.consecutiveMistakeLimit == null) {
					apiConfig.consecutiveMistakeLimit = DEFAULT_CONSECUTIVE_MISTAKE_LIMIT
				}
			}
		} catch (error) {
			console.error(`[MigrateConsecutiveMistakeLimit] Failed to migrate consecutive mistake limit:`, error)
		}
	}

	private async migrateTodoListEnabled(providerProfiles: ProviderProfiles) {
		try {
			for (const [_name, apiConfig] of Object.entries(providerProfiles.apiConfigs)) {
				if (apiConfig.todoListEnabled === undefined) {
					apiConfig.todoListEnabled = true
				}
			}
		} catch (error) {
			console.error(`[MigrateTodoListEnabled] Failed to migrate todo list enabled setting:`, error)
		}
	}

	/**
	 * Apply model migrations for all providers
	 * Returns true if any migrations were applied
	 */
	private applyModelMigrations(providerProfiles: ProviderProfiles): boolean {
		let migrated = false

		try {
			for (const [_name, apiConfig] of Object.entries(providerProfiles.apiConfigs)) {
				// Skip configs without provider or model ID
				if (!apiConfig.apiProvider || !apiConfig.apiModelId) {
					continue
				}

				// Check if this provider has migrations (with type safety)
				const provider = apiConfig.apiProvider as ProviderName
				const providerMigrations = MODEL_MIGRATIONS[provider]
				if (!providerMigrations) {
					continue
				}

				// Check if the current model ID needs migration
				const newModelId = providerMigrations[apiConfig.apiModelId]
				if (newModelId && newModelId !== apiConfig.apiModelId) {
					console.log(
						`[ModelMigration] Migrating ${apiConfig.apiProvider} model from ${apiConfig.apiModelId} to ${newModelId}`,
					)
					apiConfig.apiModelId = newModelId
					migrated = true
				}
			}
		} catch (error) {
			console.error(`[ModelMigration] Failed to apply model migrations:`, error)
		}

		return migrated
	}

	/**
	 * Clean model ID by removing prefix before "/"
	 */
	private cleanModelId(modelId: string | undefined): string | undefined {
		if (!modelId) return undefined

		// Check for "/" and take the part after it
		if (modelId.includes("/")) {
			return modelId.split("/").pop()
		}

		return modelId
	}

	/**
	 * List all available configs with metadata.
	 */
	public async listConfig(): Promise<ProviderSettingsEntry[]> {
		try {
			return await this.lock(async () => {
				const providerProfiles = await this.load()

				return Object.entries(providerProfiles.apiConfigs).map(([name, apiConfig]) => ({
					name,
					id: apiConfig.id || "",
					apiProvider: apiConfig.apiProvider,
					modelId: this.cleanModelId(getModelId(apiConfig)),
					profileType: apiConfig.profileType, // kilocode_change - autocomplete profile type system
				}))
			})
		} catch (error) {
			throw new Error(`Failed to list configs: ${error}`)
		}
	}

	// kilocode_change start - autocomplete profile type system
	/**
	 * Validate that only one autocomplete profile exists
	 */
	private async validateAutocompleteConstraint(
		profiles: ProviderProfiles,
		newProfileName: string,
		newProfileType?: ProfileType,
	): Promise<void> {
		if (newProfileType !== "autocomplete") {
			return // No constraint for non-autocomplete profiles
		}

		const autocompleteProfiles = Object.entries(profiles.apiConfigs).filter(
			([name, config]) => config.profileType === "autocomplete" && name !== newProfileName,
		)

		if (autocompleteProfiles.length > 0) {
			const existingName = autocompleteProfiles[0][0]
			throw new Error(t("settings:providers.autocomplete.onlyOneAllowed", { existingName }))
		}
	}
	// kilocode_change end

	/**
	 * Save a config with the given name.
	 * Preserves the ID from the input 'config' object if it exists,
	 * otherwise generates a new one (for creation scenarios).
	 */
	public async saveConfig(name: string, config: ProviderSettingsWithId): Promise<string> {
		try {
			return await this.lock(async () => {
				const providerProfiles = await this.load()

				// kilocode_change start" autocomplete profile type system and check for duplicate id's
				await this.validateAutocompleteConstraint(providerProfiles, name, config.profileType)

				const existingEntry = providerProfiles.apiConfigs[name]
				const existingIds = new Set(
					Object.values(providerProfiles.apiConfigs)
						.map((c) => c.id)
						.filter((id): id is string => Boolean(id)),
				)

				// EXISTING: preserve stored id; NEW: generate fresh unique id.
				const id =
					existingEntry?.id && existingEntry.id.length > 0
						? existingEntry.id
						: this.generateUniqueId(existingIds)
				// kilocode_change end

				// Filter out settings from other providers.
				const filteredConfig = discriminatedProviderSettingsWithIdSchema.parse(config)
				providerProfiles.apiConfigs[name] = { ...filteredConfig, id }
				await this.store(providerProfiles)
				return id
			})
		} catch (error) {
			throw new Error(`Failed to save config: ${error}`)
		}
	}

	public async getProfile(
		params: { name: string } | { id: string },
	): Promise<ProviderSettingsWithId & { name: string }> {
		try {
			return await this.lock(async () => {
				const providerProfiles = await this.load()
				let name: string
				let providerSettings: ProviderSettingsWithId

				if ("name" in params) {
					name = params.name

					if (!providerProfiles.apiConfigs[name]) {
						throw new Error(`Config with name '${name}' not found`)
					}

					providerSettings = providerProfiles.apiConfigs[name]
				} else {
					const id = params.id

					const entry = Object.entries(providerProfiles.apiConfigs).find(
						([_, apiConfig]) => apiConfig.id === id,
					)

					if (!entry) {
						throw new Error(`Config with ID '${id}' not found`)
					}

					name = entry[0]
					providerSettings = entry[1]
				}

				return { name, ...providerSettings }
			})
		} catch (error) {
			throw new Error(`Failed to get profile: ${error instanceof Error ? error.message : error}`)
		}
	}

	/**
	 * Activate a profile by name or ID.
	 */
	public async activateProfile(
		params: { name: string } | { id: string },
	): Promise<ProviderSettingsWithId & { name: string }> {
		const { name, ...providerSettings } = await this.getProfile(params)

		try {
			return await this.lock(async () => {
				const providerProfiles = await this.load()
				providerProfiles.currentApiConfigName = name
				await this.store(providerProfiles)
				return { name, ...providerSettings }
			})
		} catch (error) {
			throw new Error(`Failed to activate profile: ${error instanceof Error ? error.message : error}`)
		}
	}

	/**
	 * Delete a config by name.
	 */
	public async deleteConfig(name: string) {
		try {
			return await this.lock(async () => {
				const providerProfiles = await this.load()

				if (!providerProfiles.apiConfigs[name]) {
					throw new Error(`Config '${name}' not found`)
				}

				if (Object.keys(providerProfiles.apiConfigs).length === 1) {
					throw new Error(`Cannot delete the last remaining configuration`)
				}

				delete providerProfiles.apiConfigs[name]
				await this.store(providerProfiles)
			})
		} catch (error) {
			throw new Error(`Failed to delete config: ${error}`)
		}
	}

	/**
	 * Check if a config exists by name.
	 */
	public async hasConfig(name: string) {
		try {
			return await this.lock(async () => {
				const providerProfiles = await this.load()
				return name in providerProfiles.apiConfigs
			})
		} catch (error) {
			throw new Error(`Failed to check config existence: ${error}`)
		}
	}

	/**
	 * Set the API config for a specific mode.
	 */
	public async setModeConfig(mode: Mode, configId: string) {
		try {
			return await this.lock(async () => {
				const providerProfiles = await this.load()
				// Ensure the per-mode config map exists
				if (!providerProfiles.modeApiConfigs) {
					providerProfiles.modeApiConfigs = {}
				}
				// Assign the chosen config ID to this mode
				providerProfiles.modeApiConfigs[mode] = configId
				await this.store(providerProfiles)
			})
		} catch (error) {
			throw new Error(`Failed to set mode config: ${error}`)
		}
	}

	/**
	 * Get the API config ID for a specific mode.
	 */
	public async getModeConfigId(mode: Mode) {
		try {
			return await this.lock(async () => {
				const { modeApiConfigs } = await this.load()
				return modeApiConfigs?.[mode]
			})
		} catch (error) {
			throw new Error(`Failed to get mode config: ${error}`)
		}
	}

	public async export() {
		try {
			return await this.lock(async () => {
				const providerProfiles = await this.load()
				const profiles = providerProfilesSchema.parse(providerProfiles)
				const configs = profiles.apiConfigs
				for (const name in configs) {
					// Avoid leaking properties from other providers.
					configs[name] = discriminatedProviderSettingsWithIdSchema.parse(configs[name])

					// If it has no apiProvider, skip filtering
					if (!configs[name].apiProvider) {
						continue
					}

					// Try to build an API handler to get model information
					try {
						const apiHandler = buildApiHandler(configs[name])
						const modelInfo = apiHandler.getModel().info

						// Check if the model supports reasoning budgets
						const supportsReasoningBudget =
							modelInfo.supportsReasoningBudget || modelInfo.requiredReasoningBudget

						// If the model doesn't support reasoning budgets, remove the token fields
						if (!supportsReasoningBudget) {
							delete configs[name].modelMaxTokens
							delete configs[name].modelMaxThinkingTokens
						}
					} catch (error) {
						// If we can't build the API handler or get model info, skip filtering
						// to avoid accidental data loss from incomplete configurations
						console.warn(`Skipping token field filtering for config '${name}': ${error}`)
					}
				}
				return profiles
			})
		} catch (error) {
			throw new Error(`Failed to export provider profiles: ${error}`)
		}
	}

	public async import(providerProfiles: ProviderProfiles) {
		try {
			return await this.lock(() => this.store(providerProfiles))
		} catch (error) {
			throw new Error(`Failed to import provider profiles: ${error}`)
		}
	}

	/**
	 * Reset provider profiles by deleting them from secrets.
	 */
	public async resetAllConfigs() {
		return await this.lock(async () => {
			await this.context.secrets.delete(this.secretsKey)
		})
	}

	private get secretsKey() {
		return `${ProviderSettingsManager.SCOPE_PREFIX}api_config`
	}

	private async load(): Promise<ProviderProfiles> {
		const content = await this.context.secrets.get(this.secretsKey)
		return this.loadFromContent(content)
	}

	// kilocode_change start: Extract content parsing to avoid double-fetching in init_runMigrations
	private loadFromContent(content: string | undefined): ProviderProfiles {
		try {
			if (!content) {
				return this.defaultProviderProfiles
			}

			const providerProfiles = providerProfilesSchema
				.extend({
					apiConfigs: z.record(z.string(), z.any()),
				})
				.parse(JSON.parse(content))

			const apiConfigs = Object.entries(providerProfiles.apiConfigs).reduce(
				(acc, [key, apiConfig]) => {
					// First, sanitize invalid apiProvider values before parsing
					// This handles removed providers (like "glama") gracefully
					const sanitizedConfig = this.sanitizeProviderConfig(apiConfig)
					const result = providerSettingsWithIdSchema.safeParse(sanitizedConfig)
					return result.success ? { ...acc, [key]: result.data } : acc
				},
				{} as Record<string, ProviderSettingsWithId>,
			)

			return {
				...providerProfiles,
				apiConfigs: Object.fromEntries(
					Object.entries(apiConfigs).filter(([_, apiConfig]) => apiConfig !== null),
				),
			}
		} catch (error) {
			if (error instanceof ZodError) {
				TelemetryService.instance.captureSchemaValidationError({
					schemaName: "ProviderProfiles",
					error,
				})
			}

			throw new Error(`Failed to read provider profiles from secrets: ${error}`)
		}
	}
	// kilocode_change end

	/**
	 * Sanitizes a provider config by resetting invalid/removed apiProvider values.
	 * This handles cases where a user had a provider selected that was later removed
	 * from the extension (e.g., "glama").
	 */
	private sanitizeProviderConfig(apiConfig: unknown): unknown {
		if (typeof apiConfig !== "object" || apiConfig === null) {
			return apiConfig
		}

		const config = apiConfig as Record<string, unknown>

		// Check if apiProvider is set and if it's still valid
		if (config.apiProvider !== undefined && !isProviderName(config.apiProvider)) {
			console.log(
				`[ProviderSettingsManager] Sanitizing invalid provider "${config.apiProvider}" - resetting to undefined`,
			)
			// Return a new config object without the invalid apiProvider
			// This effectively resets the profile so the user can select a valid provider
			const { apiProvider, ...restConfig } = config
			return restConfig
		}

		return apiConfig
	}

	private async store(providerProfiles: ProviderProfiles) {
		try {
			await this.context.secrets.store(this.secretsKey, JSON.stringify(providerProfiles, null, 2))
		} catch (error) {
			throw new Error(`Failed to write provider profiles to secrets: ${error}`)
		}
	}

	private findUniqueProfileName(baseName: string, existingNames: Set<string>): string {
		if (!existingNames.has(baseName)) {
			return baseName
		}

		// Try _local first
		const localName = `${baseName}_local`
		if (!existingNames.has(localName)) {
			return localName
		}

		// Try _1, _2, etc.
		let counter = 1
		let candidateName: string
		do {
			candidateName = `${baseName}_${counter}`
			counter++
		} while (existingNames.has(candidateName))

		return candidateName
	}

	public async syncCloudProfiles(
		cloudProfiles: Record<string, ProviderSettingsWithId>,
		currentActiveProfileName?: string,
	): Promise<SyncCloudProfilesResult> {
		try {
			return await this.lock(async () => {
				const providerProfiles = await this.load()
				const changedProfiles: string[] = []
				const existingNames = new Set(Object.keys(providerProfiles.apiConfigs))

				let activeProfileChanged = false
				let activeProfileId = ""

				if (currentActiveProfileName && providerProfiles.apiConfigs[currentActiveProfileName]) {
					activeProfileId = providerProfiles.apiConfigs[currentActiveProfileName].id || ""
				}

				const currentCloudIds = new Set(providerProfiles.cloudProfileIds || [])
				const newCloudIds = new Set(
					Object.values(cloudProfiles)
						.map((p) => p.id)
						.filter((id): id is string => Boolean(id)),
				)

				// Step 1: Delete profiles that are cloud-managed but not in the new cloud profiles
				for (const [name, profile] of Object.entries(providerProfiles.apiConfigs)) {
					if (profile.id && currentCloudIds.has(profile.id) && !newCloudIds.has(profile.id)) {
						// Check if we're deleting the active profile
						if (name === currentActiveProfileName) {
							activeProfileChanged = true
							activeProfileId = "" // Clear the active profile ID since it's being deleted
						}
						delete providerProfiles.apiConfigs[name]
						changedProfiles.push(name)
						existingNames.delete(name)
					}
				}

				// Step 2: Process each cloud profile
				for (const [cloudName, cloudProfile] of Object.entries(cloudProfiles)) {
					if (!cloudProfile.id) {
						continue // Skip profiles without IDs
					}

					// Find existing profile with matching ID
					const existingEntry = Object.entries(providerProfiles.apiConfigs).find(
						([_, profile]) => profile.id === cloudProfile.id,
					)

					if (existingEntry) {
						// Step 3: Update existing profile
						const [existingName, existingProfile] = existingEntry

						// Check if this is the active profile
						const isActiveProfile = existingName === currentActiveProfileName

						// Merge settings, preserving secret keys
						const updatedProfile: ProviderSettingsWithId = { ...cloudProfile }
						for (const [key, value] of Object.entries(existingProfile)) {
							if (isSecretStateKey(key) && value !== undefined) {
								;(updatedProfile as any)[key] = value
							}
						}

						// Check if the profile actually changed using deepEqual
						const profileChanged = !deepEqual(existingProfile, updatedProfile)

						// Handle name change
						if (existingName !== cloudName) {
							// Remove old entry
							delete providerProfiles.apiConfigs[existingName]
							existingNames.delete(existingName)

							// Handle name conflict
							let finalName = cloudName
							if (existingNames.has(cloudName)) {
								// There's a conflict - rename the existing non-cloud profile
								const conflictingProfile = providerProfiles.apiConfigs[cloudName]
								if (conflictingProfile.id !== cloudProfile.id) {
									const newName = this.findUniqueProfileName(cloudName, existingNames)
									providerProfiles.apiConfigs[newName] = conflictingProfile
									existingNames.add(newName)
									changedProfiles.push(newName)
								}
								delete providerProfiles.apiConfigs[cloudName]
								existingNames.delete(cloudName)
							}

							// Add updated profile with new name
							providerProfiles.apiConfigs[finalName] = updatedProfile
							existingNames.add(finalName)
							changedProfiles.push(finalName)
							if (existingName !== finalName) {
								changedProfiles.push(existingName) // Mark old name as changed (deleted)
							}

							// If this was the active profile, mark it as changed
							if (isActiveProfile) {
								activeProfileChanged = true
								activeProfileId = cloudProfile.id || ""
							}
						} else if (profileChanged) {
							// Same name, but profile content changed - update in place
							providerProfiles.apiConfigs[existingName] = updatedProfile
							changedProfiles.push(existingName)

							// If this was the active profile and settings changed, mark it as changed
							if (isActiveProfile) {
								activeProfileChanged = true
								activeProfileId = cloudProfile.id || ""
							}
						}
						// If name is the same and profile hasn't changed, do nothing
					} else {
						// Step 4: Add new cloud profile
						let finalName = cloudName

						// Handle name conflict with existing non-cloud profile
						if (existingNames.has(cloudName)) {
							const existingProfile = providerProfiles.apiConfigs[cloudName]
							if (existingProfile.id !== cloudProfile.id) {
								// Rename the existing profile
								const newName = this.findUniqueProfileName(cloudName, existingNames)
								providerProfiles.apiConfigs[newName] = existingProfile
								existingNames.add(newName)
								changedProfiles.push(newName)

								// Remove the old entry
								delete providerProfiles.apiConfigs[cloudName]
								existingNames.delete(cloudName)
							}
						}

						// Add the new cloud profile (without secret keys)
						const newProfile: ProviderSettingsWithId = { ...cloudProfile }
						// Remove any secret keys from cloud profile
						for (const key of Object.keys(newProfile)) {
							if (isSecretStateKey(key)) {
								delete (newProfile as any)[key]
							}
						}

						providerProfiles.apiConfigs[finalName] = newProfile
						existingNames.add(finalName)
						changedProfiles.push(finalName)
					}
				}

				// Step 5: Handle case where all profiles might be deleted
				if (Object.keys(providerProfiles.apiConfigs).length === 0 && changedProfiles.length > 0) {
					// Create a default profile only if we have changed profiles
					const defaultProfile = { id: this.generateId() }
					providerProfiles.apiConfigs["default"] = defaultProfile
					activeProfileChanged = true
					activeProfileId = defaultProfile.id || ""
					changedProfiles.push("default")
				}

				// Step 6: If active profile was deleted, find a replacement
				if (activeProfileChanged && !activeProfileId) {
					const firstProfile = Object.values(providerProfiles.apiConfigs)[0]
					if (firstProfile?.id) {
						activeProfileId = firstProfile.id
					}
				}

				// Step 7: Update cloudProfileIds
				providerProfiles.cloudProfileIds = Array.from(newCloudIds)

				// Save the updated profiles
				await this.store(providerProfiles)

				return {
					hasChanges: changedProfiles.length > 0,
					activeProfileChanged,
					activeProfileId,
				}
			})
		} catch (error) {
			throw new Error(`Failed to sync cloud profiles: ${error}`)
		}
	}
}
