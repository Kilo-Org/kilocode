/**
 * /config command - Interactive CLI configuration editor with autocomplete
 */

import type { Command, ArgumentProviderContext } from "./core/types.js"
import { loadConfig, saveConfig } from "../config/persistence.js"
import { getAllModes } from "../constants/modes/defaults.js"

/**
 * Available config settings that can be modified
 */
const CONFIG_SETTINGS = ["mode", "telemetry", "theme", "provider", "auto-approval"] as const
type ConfigSetting = (typeof CONFIG_SETTINGS)[number]

/**
 * Available telemetry values
 */
const TELEMETRY_VALUES = ["true", "false"] as const

/**
 * Available theme values
 */
const THEME_VALUES = ["dark", "light", "default", "auto"] as const

/**
 * Available auto-approval values
 */
const AUTO_APPROVAL_VALUES = ["true", "false"] as const

/**
 * Autocomplete provider for config settings
 */
async function configSettingProvider(_context: ArgumentProviderContext) {
	return CONFIG_SETTINGS.map((setting) => ({
		value: setting,
		description: getSettingDescription(setting),
		matchScore: 1.0,
		highlightedValue: setting,
	}))
}

/**
 * Autocomplete provider for mode values
 */
async function modeProvider(_context: ArgumentProviderContext) {
	const allModes = getAllModes([])
	return allModes.map((mode) => ({
		value: mode.slug,
		title: mode.name,
		description: mode.description || "No description",
		matchScore: 1.0,
		highlightedValue: mode.slug,
	}))
}

/**
 * Autocomplete provider for telemetry values
 */
async function telemetryProvider(_context: ArgumentProviderContext) {
	return TELEMETRY_VALUES.map((value) => ({
		value,
		description: `Set telemetry to ${value}`,
		matchScore: 1.0,
		highlightedValue: value,
	}))
}

/**
 * Autocomplete provider for theme values
 */
async function themeProvider(_context: ArgumentProviderContext) {
	return THEME_VALUES.map((theme) => ({
		value: theme,
		description: `Set theme to ${theme}`,
		matchScore: 1.0,
		highlightedValue: theme,
	}))
}

/**
 * Autocomplete provider for provider values
 */
async function providerProvider(context: ArgumentProviderContext) {
	if (!context.commandContext) {
		return []
	}

	try {
		const loadResult = await loadConfig()
		const config = loadResult.config

		return config.providers.map((provider) => ({
			value: provider.id,
			title: provider.provider,
			description: `Switch to ${provider.provider} provider`,
			matchScore: 1.0,
			highlightedValue: provider.id,
		}))
	} catch {
		return []
	}
}

/**
 * Autocomplete provider for auto-approval values
 */
async function autoApprovalProvider(_context: ArgumentProviderContext) {
	return AUTO_APPROVAL_VALUES.map((value) => ({
		value,
		description: `Set auto-approval to ${value}`,
		matchScore: 1.0,
		highlightedValue: value,
	}))
}

/**
 * Get description for a config setting
 */
function getSettingDescription(setting: ConfigSetting): string {
	const descriptions: Record<ConfigSetting, string> = {
		mode: "Set the default mode (code, architect, ask, debug, etc.)",
		telemetry: "Enable or disable telemetry (true/false)",
		theme: "Set the UI theme (dark, light, default, auto)",
		provider: "Set the active AI provider",
		"auto-approval": "Enable or disable auto-approval globally (true/false)",
	}
	return descriptions[setting]
}

export const configCommand: Command = {
	name: "config",
	aliases: ["c", "settings"],
	description: "Configure CLI settings with autocomplete",
	usage: "/config [setting] [value] or /config menu",
	examples: [
		"/config mode code",
		"/config telemetry false",
		"/config theme dark",
		"/config provider openai",
		"/config auto-approval true",
		"/config menu",
	],
	category: "settings",
	priority: 8,
	arguments: [
		{
			name: "setting",
			description: "Configuration setting to modify",
			required: false,
			values: CONFIG_SETTINGS.map((setting) => ({
				value: setting,
				description: getSettingDescription(setting),
			})),
			provider: configSettingProvider,
			placeholder: "Select a setting or type 'menu' for interactive mode",
		},
		{
			name: "value",
			description: "Value to set for the configuration setting",
			required: false,
			conditionalProviders: [
				{
					condition: (context) => context.getArgument("setting") === "mode",
					provider: modeProvider,
				},
				{
					condition: (context) => context.getArgument("setting") === "telemetry",
					provider: telemetryProvider,
				},
				{
					condition: (context) => context.getArgument("setting") === "theme",
					provider: themeProvider,
				},
				{
					condition: (context) => context.getArgument("setting") === "provider",
					provider: providerProvider,
				},
				{
					condition: (context) => context.getArgument("setting") === "auto-approval",
					provider: autoApprovalProvider,
				},
			],
			placeholder: "Enter value for the setting",
		},
	],
	handler: async (context) => {
		const { args, addMessage } = context

		// If no arguments or first arg is "menu", show interactive menu
		if (args.length === 0 || args[0] === "menu") {
			const { startInteractiveConfigEditor } = await import("../config/interactiveEditor.js")
			addMessage({
				id: Date.now().toString(),
				type: "system",
				content: "Starting interactive configuration editor...",
				ts: Date.now(),
			})
			try {
				await startInteractiveConfigEditor(context)
			} catch (error) {
				addMessage({
					id: Date.now().toString(),
					type: "error",
					content: `Failed to start configuration editor: ${error instanceof Error ? error.message : String(error)}`,
					ts: Date.now(),
				})
			}
			return
		}

		const setting = args[0] as ConfigSetting
		const value = args[1]

		if (!CONFIG_SETTINGS.includes(setting)) {
			addMessage({
				id: Date.now().toString(),
				type: "error",
				content: `Unknown setting "${setting}". Available settings: ${CONFIG_SETTINGS.join(", ")}`,
				ts: Date.now(),
			})
			return
		}

		if (!value) {
			addMessage({
				id: Date.now().toString(),
				type: "error",
				content: `Missing value for setting "${setting}". Use: /config ${setting} <value>`,
				ts: Date.now(),
			})
			return
		}

		try {
			const loadResult = await loadConfig()
			const config = loadResult.config

			// Apply the setting change
			switch (setting) {
				case "mode":
					if (!getAllModes([]).find((m) => m.slug === value)) {
						addMessage({
							id: Date.now().toString(),
							type: "error",
							content: `Invalid mode "${value}". Available modes: ${getAllModes([])
								.map((m) => m.slug)
								.join(", ")}`,
							ts: Date.now(),
						})
						return
					}
					config.mode = value
					break

				case "telemetry":
					if (!TELEMETRY_VALUES.includes(value as (typeof TELEMETRY_VALUES)[number])) {
						addMessage({
							id: Date.now().toString(),
							type: "error",
							content: `Invalid telemetry value "${value}". Must be: ${TELEMETRY_VALUES.join(" or ")}`,
							ts: Date.now(),
						})
						return
					}
					config.telemetry = value === "true"
					break

				case "theme":
					if (!THEME_VALUES.includes(value as (typeof THEME_VALUES)[number])) {
						addMessage({
							id: Date.now().toString(),
							type: "error",
							content: `Invalid theme "${value}". Available themes: ${THEME_VALUES.join(", ")}`,
							ts: Date.now(),
						})
						return
					}
					config.theme = value
					break

				case "provider": {
					const providerExists = config.providers.some((p) => p.id === value)
					if (!providerExists) {
						addMessage({
							id: Date.now().toString(),
							type: "error",
							content: `Provider "${value}" not found. Available providers: ${config.providers
								.map((p) => p.id)
								.join(", ")}`,
							ts: Date.now(),
						})
						return
					}
					config.provider = value
					break
				}

				case "auto-approval":
					if (!AUTO_APPROVAL_VALUES.includes(value as (typeof AUTO_APPROVAL_VALUES)[number])) {
						addMessage({
							id: Date.now().toString(),
							type: "error",
							content: `Invalid auto-approval value "${value}". Must be: ${AUTO_APPROVAL_VALUES.join(" or ")}`,
							ts: Date.now(),
						})
						return
					}
					if (!config.autoApproval) {
						config.autoApproval = { enabled: false }
					}
					config.autoApproval.enabled = value === "true"
					break
			}

			// Save the configuration
			await saveConfig(config)

			addMessage({
				id: Date.now().toString(),
				type: "system",
				content: `✅ Configuration updated: ${setting} = ${value}`,
				ts: Date.now(),
			})
		} catch (error) {
			addMessage({
				id: Date.now().toString(),
				type: "error",
				content: `Failed to update configuration: ${error instanceof Error ? error.message : String(error)}`,
				ts: Date.now(),
			})
		}
	},
}
