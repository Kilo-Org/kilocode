import { atom } from "jotai"
import type { AutoApprovalConfig, CLIConfig, ProviderConfig } from "../../config/types.js"
import { DEFAULT_CONFIG } from "../../config/defaults.js"
import { loadConfig, saveConfig } from "../../config/persistence.js"
import { mapConfigToExtensionState } from "../../config/mapper.js"
import type { ValidationResult } from "../../config/validation.js"
import { addCustomTheme, removeCustomTheme, updateCustomTheme } from "../../constants/themes/custom.js"
import type { Theme } from "../../types/theme.js"
import { logs } from "../../services/logs.js"
import { getTelemetryService } from "../../services/telemetry/index.js"
import { applyEnvOverrides } from "../../config/env-config.js"

// Core config atom - holds the current configuration
export const configAtom = atom<CLIConfig>(DEFAULT_CONFIG)

// Validation result atom - holds the validation status of the current config
export const configValidationAtom = atom<ValidationResult>({ valid: true })

// Loading state atom
export const configLoadingAtom = atom<boolean>(false)

// Error state atom
export const configErrorAtom = atom<Error | null>(null)

// Derived atom for selected provider
export const providerAtom = atom((get) => {
	const config = get(configAtom)
	return config.providers.find((p) => p.id === config.provider)
})

// Derived atom for provider list
export const providersAtom = atom((get) => get(configAtom).providers)

// Derived atom for current mode
export const modeAtom = atom((get) => {
	const config = get(configAtom)
	return config.mode
})

// Derived atom for current theme
export const themeAtom = atom((get) => {
	const config = get(configAtom)
	return config.theme || "dark"
})

// Action atom to load config from disk
// Accepts optional mode parameter to override the loaded config's mode
export const loadConfigAtom = atom(null, async (get, set, mode?: string) => {
	try {
		set(configLoadingAtom, true)
		set(configErrorAtom, null)

		const result = await loadConfig()

		// Store validation result
		set(configValidationAtom, result.validation)

		// Override mode if provided (e.g., from CLI options)
		let finalConfig = mode ? { ...result.config, mode } : result.config

		// Apply environment variable overrides
		finalConfig = applyEnvOverrides(finalConfig)

		set(configAtom, finalConfig)

		if (result.validation.valid) {
			logs.info("Config loaded successfully", "ConfigAtoms", { mode: finalConfig.mode })
			// Track config loaded
			getTelemetryService().trackConfigLoaded(finalConfig)
		} else {
			logs.warn("Config loaded with validation errors", "ConfigAtoms", {
				errors: result.validation.errors,
				mode: finalConfig.mode,
			})
		}

		return finalConfig
	} catch (error) {
		const err = error instanceof Error ? error : new Error(String(error))
		set(configErrorAtom, err)
		logs.error("Failed to load config", "ConfigAtoms", { error })
		throw err
	} finally {
		set(configLoadingAtom, false)
	}
})

// Action atom to save config to disk
export const saveConfigAtom = atom(null, async (get, set, config?: CLIConfig) => {
	try {
		const configToSave = config || get(configAtom)
		await saveConfig(configToSave)

		if (config) {
			set(configAtom, config)
		}

		logs.info("Config saved successfully", "ConfigAtoms")

		// Track config saved
		getTelemetryService().trackConfigSaved(configToSave)
	} catch (error) {
		const err = error instanceof Error ? error : new Error(String(error))
		set(configErrorAtom, err)
		logs.error("Failed to save config", "ConfigAtoms", { error })
		throw err
	}
})

// Action atom to update selected provider
export const selectProviderAtom = atom(null, async (get, set, providerId: string) => {
	const config = get(configAtom)
	const provider = config.providers.find((p) => p.id === providerId)

	if (!provider) {
		throw new Error(`Provider ${providerId} not found`)
	}

	const previousProvider = config.provider
	const updatedConfig = {
		...config,
		provider: providerId,
	}

	set(configAtom, updatedConfig)
	await set(saveConfigAtom, updatedConfig)

	// Import from config-sync to avoid circular dependency
	const { syncConfigToExtensionEffectAtom } = await import("./config-sync.js")

	// Trigger sync to extension after provider update
	await set(syncConfigToExtensionEffectAtom)

	// Track provider change
	getTelemetryService().trackProviderChanged(
		previousProvider,
		providerId,
		(provider.apiModelId as string | undefined) || (provider.kilocodeModel as string | undefined),
	)
})

// Action atom to add a new provider
export const addProviderAtom = atom(null, async (get, set, provider: ProviderConfig) => {
	const config = get(configAtom)

	// Check for duplicate ID
	if (config.providers.some((p) => p.id === provider.id)) {
		throw new Error(`Provider with ID ${provider.id} already exists`)
	}

	const updatedConfig = {
		...config,
		providers: [...config.providers, provider],
	}

	set(configAtom, updatedConfig)
	await set(saveConfigAtom, updatedConfig)
})

// Action atom to update a provider
export const updateProviderAtom = atom(null, async (get, set, providerId: string, updates: Partial<ProviderConfig>) => {
	const config = get(configAtom)
	const providerIndex = config.providers.findIndex((p) => p.id === providerId)

	if (providerIndex === -1) {
		throw new Error(`Provider ${providerId} not found`)
	}

	const updatedProviders = [...config.providers]
	updatedProviders[providerIndex] = {
		...updatedProviders[providerIndex],
		...updates,
	} as ProviderConfig

	const updatedConfig = {
		...config,
		providers: updatedProviders,
	}

	set(configAtom, updatedConfig)
	await set(saveConfigAtom, updatedConfig)

	logs.info("Provider updated, syncing to extension", "ConfigAtoms")

	// Import from config-sync to avoid circular dependency
	const { syncConfigToExtensionEffectAtom } = await import("./config-sync.js")

	// Trigger sync to extension after provider update
	await set(syncConfigToExtensionEffectAtom)
})

// Action atom to remove a provider
export const removeProviderAtom = atom(null, async (get, set, providerId: string) => {
	const config = get(configAtom)

	const updatedConfig = {
		...config,
		providers: config.providers.filter((p) => p.id !== providerId),
		// Update selected if we're removing the selected provider
		provider: config.provider === providerId ? config.providers[0]?.id || "" : config.provider,
	}

	set(configAtom, updatedConfig)
	await set(saveConfigAtom, updatedConfig)
})

// Action atom to update mode in config and persist
export const setModeAtom = atom(null, async (get, set, mode: string) => {
	const config = get(configAtom)
	const previousMode = config.mode
	const updatedConfig = {
		...config,
		mode,
	}

	set(configAtom, updatedConfig)
	await set(saveConfigAtom, updatedConfig)

	logs.info(`Mode updated to: ${mode}`, "ConfigAtoms")

	// Track mode change
	getTelemetryService().trackModeChanged(previousMode, mode)
	getTelemetryService().setMode(mode)

	// Import from config-sync to avoid circular dependency
	const { syncConfigToExtensionEffectAtom } = await import("./config-sync.js")

	// Trigger sync to extension after mode change
	await set(syncConfigToExtensionEffectAtom)
})

// Action atom to update theme in config and persist
export const setThemeAtom = atom(null, async (get, set, theme: string) => {
	const config = get(configAtom)
	const previousTheme = config.theme || "dark"
	const updatedConfig = {
		...config,
		theme,
	}

	set(configAtom, updatedConfig)
	await set(saveConfigAtom, updatedConfig)

	logs.info(`Theme updated to: ${theme}`, "ConfigAtoms")

	// Track theme change
	getTelemetryService().trackThemeChanged?.(previousTheme, theme)

	// Import from config-sync to avoid circular dependency
	const { syncConfigToExtensionEffectAtom } = await import("./config-sync.js")

	// Trigger sync to extension after theme change
	await set(syncConfigToExtensionEffectAtom)
})

// Atom to get mapped extension state
export const mappedExtensionStateAtom = atom((get) => {
	const config = get(configAtom)
	return mapConfigToExtensionState(config)
})

// ============================================================================
// Auto Approval Atoms
// ============================================================================

/**
 * Derived atom to get the complete auto approval configuration
 */
export const autoApprovalConfigAtom = atom((get) => {
	const config = get(configAtom)
	return config.autoApproval
})

/**
 * Derived atom to get the global auto approval enabled state
 */
export const autoApprovalEnabledAtom = atom((get) => {
	const autoApproval = get(autoApprovalConfigAtom)
	return autoApproval?.enabled ?? false
})

/**
 * Derived atom to check if read operations should be auto-approved
 */
export const autoApproveReadAtom = atom((get) => {
	const enabled = get(autoApprovalEnabledAtom)
	const autoApproval = get(autoApprovalConfigAtom)
	return enabled && (autoApproval?.read?.enabled ?? true)
})

/**
 * Derived atom to check if read operations outside workspace should be auto-approved
 */
export const autoApproveReadOutsideAtom = atom((get) => {
	const autoApproveRead = get(autoApproveReadAtom)
	const autoApproval = get(autoApprovalConfigAtom)
	return autoApproveRead && (autoApproval?.read?.outside ?? true)
})

/**
 * Derived atom to check if write operations should be auto-approved
 */
export const autoApproveWriteAtom = atom((get) => {
	const enabled = get(autoApprovalEnabledAtom)
	const autoApproval = get(autoApprovalConfigAtom)
	return enabled && (autoApproval?.write?.enabled ?? true)
})

/**
 * Derived atom to check if write operations outside workspace should be auto-approved
 */
export const autoApproveWriteOutsideAtom = atom((get) => {
	const autoApproveWrite = get(autoApproveWriteAtom)
	const autoApproval = get(autoApprovalConfigAtom)
	return autoApproveWrite && (autoApproval?.write?.outside ?? true)
})

/**
 * Derived atom to check if write operations to protected files should be auto-approved
 */
export const autoApproveWriteProtectedAtom = atom((get) => {
	const autoApproveWrite = get(autoApproveWriteAtom)
	const autoApproval = get(autoApprovalConfigAtom)
	return autoApproveWrite && (autoApproval?.write?.protected ?? false)
})

/**
 * Derived atom to check if browser operations should be auto-approved
 */
export const autoApproveBrowserAtom = atom((get) => {
	const enabled = get(autoApprovalEnabledAtom)
	const autoApproval = get(autoApprovalConfigAtom)
	return enabled && (autoApproval?.browser?.enabled ?? false)
})

/**
 * Derived atom to check if retry operations should be auto-approved
 */
export const autoApproveRetryAtom = atom((get) => {
	const enabled = get(autoApprovalEnabledAtom)
	const autoApproval = get(autoApprovalConfigAtom)
	return enabled && (autoApproval?.retry?.enabled ?? false)
})

/**
 * Derived atom to get retry delay in seconds
 */
export const autoApproveRetryDelayAtom = atom((get) => {
	const autoApproval = get(autoApprovalConfigAtom)
	return autoApproval?.retry?.delay ?? 10
})

/**
 * Derived atom to check if MCP operations should be auto-approved
 */
export const autoApproveMcpAtom = atom((get) => {
	const enabled = get(autoApprovalEnabledAtom)
	const autoApproval = get(autoApprovalConfigAtom)
	return enabled && (autoApproval?.mcp?.enabled ?? true)
})

/**
 * Derived atom to check if mode switching should be auto-approved
 */
export const autoApproveModeAtom = atom((get) => {
	const enabled = get(autoApprovalEnabledAtom)
	const autoApproval = get(autoApprovalConfigAtom)
	return enabled && (autoApproval?.mode?.enabled ?? true)
})

/**
 * Derived atom to check if subtask creation should be auto-approved
 */
export const autoApproveSubtasksAtom = atom((get) => {
	const enabled = get(autoApprovalEnabledAtom)
	const autoApproval = get(autoApprovalConfigAtom)
	return enabled && (autoApproval?.subtasks?.enabled ?? true)
})

/**
 * Derived atom to check if command execution should be auto-approved
 */
export const autoApproveExecuteAtom = atom((get) => {
	const enabled = get(autoApprovalEnabledAtom)
	const autoApproval = get(autoApprovalConfigAtom)
	return enabled && (autoApproval?.execute?.enabled ?? true)
})

/**
 * Derived atom to get allowed commands list
 */
export const autoApproveExecuteAllowedAtom = atom((get) => {
	const autoApproval = get(autoApprovalConfigAtom)
	return autoApproval?.execute?.allowed ?? []
})

/**
 * Derived atom to get denied commands list
 */
export const autoApproveExecuteDeniedAtom = atom((get) => {
	const autoApproval = get(autoApprovalConfigAtom)
	return autoApproval?.execute?.denied ?? []
})

/**
 * Derived atom to check if followup questions should be auto-approved
 */
export const autoApproveQuestionAtom = atom((get) => {
	const enabled = get(autoApprovalEnabledAtom)
	const autoApproval = get(autoApprovalConfigAtom)
	return enabled && (autoApproval?.question?.enabled ?? false)
})

/**
 * Derived atom to get followup question timeout in seconds
 */
export const autoApproveQuestionTimeoutAtom = atom((get) => {
	const autoApproval = get(autoApprovalConfigAtom)
	return autoApproval?.question?.timeout ?? 60
})

/**
 * Derived atom to check if todo list updates should be auto-approved
 */
export const autoApproveTodoAtom = atom((get) => {
	const enabled = get(autoApprovalEnabledAtom)
	const autoApproval = get(autoApprovalConfigAtom)
	return enabled && (autoApproval?.todo?.enabled ?? true)
})

/**
 * Action atom to toggle global auto approval
 */
export const toggleAutoApprovalAtom = atom(null, async (get, set) => {
	const config = get(configAtom)
	const currentEnabled = config.autoApproval?.enabled ?? false

	const updatedConfig = {
		...config,
		autoApproval: {
			...config.autoApproval,
			enabled: !currentEnabled,
		},
	}

	set(configAtom, updatedConfig)
	await set(saveConfigAtom, updatedConfig)

	logs.info(`Auto approval ${!currentEnabled ? "enabled" : "disabled"}`, "ConfigAtoms")
})

/**
 * Action atom to update auto approval configuration
 */
export const updateAutoApprovalAtom = atom(
	null,
	async (get, set, updates: Partial<import("../../config/types.js").AutoApprovalConfig>) => {
		const config = get(configAtom)

		const updatedConfig = {
			...config,
			autoApproval: {
				...config.autoApproval,
				...updates,
			},
		}

		set(configAtom, updatedConfig)
		await set(saveConfigAtom, updatedConfig)

		logs.info("Auto approval configuration updated", "ConfigAtoms")
	},
)

/**
 * Action atom to update a specific auto approval setting
 */
export const updateAutoApprovalSettingAtom = atom(
	null,
	async (get, set, category: keyof AutoApprovalConfig, updates: Record<string, unknown>) => {
		const config = get(configAtom)

		const updatedConfig = {
			...config,
			autoApproval: {
				...config.autoApproval,
				[category]: {
					...(config.autoApproval?.[category] as Record<string, unknown>),
					...updates,
				},
			},
		}

		set(configAtom, updatedConfig)
		await set(saveConfigAtom, updatedConfig)

		logs.info(`Auto approval ${category} setting updated`, "ConfigAtoms")
	},
)

/**
 * Action atom to add a command pattern to the auto-approval allowed list
 */
export const addAllowedCommandAtom = atom(null, async (get, set, commandPattern: string) => {
	const config = get(configAtom)
	const currentAllowed = config.autoApproval?.execute?.allowed ?? []

	// Don't add if already exists
	if (currentAllowed.includes(commandPattern)) {
		logs.debug("Command pattern already in allowed list", "ConfigAtoms", { commandPattern })
		return
	}

	const updatedConfig = {
		...config,
		autoApproval: {
			...config.autoApproval,
			execute: {
				...config.autoApproval?.execute,
				enabled: true, // Enable execute auto-approval when adding patterns
				allowed: [...currentAllowed, commandPattern],
			},
		},
	}

	set(configAtom, updatedConfig)
	await set(saveConfigAtom, updatedConfig)

	logs.info(`Added command pattern to allowed list: ${commandPattern}`, "ConfigAtoms")
})

// ============================================================================
// Custom Theme Management Atoms
// ============================================================================

/**
 * Action atom to add a custom theme
 */
export const addCustomThemeAtom = atom(null, async (get, set, themeId: string, theme: Theme) => {
	const config = get(configAtom)

	// Check if theme ID already exists (either built-in or custom)
	const existingThemes = config.customThemes || {}
	const builtInThemeIds = [
		"dark",
		"light",
		"alpha",
		"ansi",
		"ansi-light",
		"atom-one-dark",
		"ayu-dark",
		"ayu-light",
		"dracula",
		"github-dark",
		"github-light",
		"googlecode",
		"shades-of-purple",
		"xcode",
	]

	if (builtInThemeIds.includes(themeId) || existingThemes[themeId]) {
		throw new Error(`Theme "${themeId}" already exists`)
	}

	const updatedConfig = addCustomTheme(config, themeId, theme)

	set(configAtom, updatedConfig)
	await set(saveConfigAtom, updatedConfig)

	logs.info(`Custom theme "${themeId}" added`, "ConfigAtoms")
})

/**
 * Action atom to remove a custom theme
 */
export const removeCustomThemeAtom = atom(null, async (get, set, themeId: string) => {
	const config = get(configAtom)

	if (!config.customThemes || !config.customThemes[themeId]) {
		throw new Error(`Custom theme "${themeId}" not found`)
	}

	const updatedConfig = removeCustomTheme(config, themeId)

	set(configAtom, updatedConfig)
	await set(saveConfigAtom, updatedConfig)

	logs.info(`Custom theme "${themeId}" removed`, "ConfigAtoms")
})

/**
 * Action atom to update a custom theme
 */
export const updateCustomThemeAtom = atom(null, async (get, set, themeId: string, updates: Partial<Theme>) => {
	const config = get(configAtom)

	if (!config.customThemes || !config.customThemes[themeId]) {
		throw new Error(`Custom theme "${themeId}" not found`)
	}

	const updatedConfig = updateCustomTheme(config, themeId, updates)

	set(configAtom, updatedConfig)
	await set(saveConfigAtom, updatedConfig)

	logs.info(`Custom theme "${themeId}" updated`, "ConfigAtoms")
})

/**
 * Derived atom to get all custom themes
 */
export const customThemesAtom = atom((get) => {
	const config = get(configAtom)
	return config.customThemes || {}
})
