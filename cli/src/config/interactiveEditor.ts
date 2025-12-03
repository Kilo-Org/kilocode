/**
 * Interactive config editor for the terminal
 * Provides a menu-driven interface to edit CLI configuration
 */

import type { CLIConfig } from "./types.js"
import type { CliMessage } from "../types/cli.js"
import { loadConfig, saveConfig } from "./persistence.js"

interface MenuOption {
	label: string
	action: () => Promise<void> | void
	description?: string
}

interface EditorContext {
	config: CLIConfig
	addMessage: (message: CliMessage) => void
	refreshConfig: () => Promise<void>
}

/**
 * Main interactive config editor
 */
export async function startInteractiveConfigEditor(
	context: { addMessage: (message: CliMessage) => void },
	_directOption?: number,
): Promise<void> {
	const { addMessage } = context

	try {
		const loadResult = await loadConfig()
		let config = loadResult.config

		const editorContext: EditorContext = {
			config,
			addMessage,
			refreshConfig: async () => {
				const result = await loadConfig()
				config = result.config
				editorContext.config = config
			},
		}

		if (_directOption !== undefined) {
			await handleDirectOption(editorContext, _directOption)
		} else {
			await showMainMenu(editorContext)
		}
	} catch (error) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: `Failed to load config: ${error instanceof Error ? error.message : String(error)}`,
			ts: Date.now(),
		})
	}
}

/**
 * Handle direct menu option selection
 */
async function handleDirectOption(context: EditorContext, option: number): Promise<void> {
	const { addMessage } = context

	// Map option numbers to menu actions (1-indexed)
	const menuActions = [
		() => showGeneralSettingsMenu(context), // 1. General Settings
		() => showProvidersMenu(context), // 2. Providers
		() => showAutoApprovalMenu(context), // 3. Auto Approval
		() => showCurrentConfig(context), // 4. View Current Config
		() => saveAndExit(context), // 5. Save and Exit
		() => exitWithoutSaving(context), // 6. Exit without Saving
	]

	const action = menuActions[option - 1]
	if (action) {
		await action()
	} else {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: `Invalid menu option: ${option}. Please enter a number between 1 and ${menuActions.length}.`,
			ts: Date.now(),
		})
		await showMainMenu(context)
	}
}

/**
 * Show the main configuration menu
 */
async function showMainMenu(context: EditorContext): Promise<void> {
	const { addMessage: _addMessage } = context

	const options: MenuOption[] = [
		{
			label: "General Settings",
			action: () => showGeneralSettingsMenu(context),
			description: "Mode, telemetry, theme",
		},
		{
			label: "Providers",
			action: () => showProvidersMenu(context),
			description: "Manage AI providers and their settings",
		},
		{
			label: "Auto Approval",
			action: () => showAutoApprovalMenu(context),
			description: "Configure automatic approval settings",
		},
		{
			label: "View Current Config",
			action: () => showCurrentConfig(context),
			description: "Display the current configuration",
		},
		{
			label: "Save and Exit",
			action: () => saveAndExit(context),
			description: "Save changes and exit the editor",
		},
		{
			label: "Exit without Saving",
			action: () => exitWithoutSaving(context),
			description: "Exit without saving changes",
		},
	]

	await showMenu("Configuration Editor", options, context)
}

/**
 * Show general settings menu
 */
async function showGeneralSettingsMenu(context: EditorContext): Promise<void> {
	const { config, addMessage: _addMessage } = context

	const options: MenuOption[] = [
		{
			label: `Mode: ${config.mode}`,
			action: () => editMode(context),
			description: "Change the default mode",
		},
		{
			label: `Telemetry: ${config.telemetry ? "Enabled" : "Disabled"}`,
			action: () => toggleTelemetry(context),
			description: "Enable or disable telemetry",
		},
		{
			label: `Theme: ${config.theme || "default"}`,
			action: () => editTheme(context),
			description: "Change the theme",
		},
		{
			label: "Back to Main Menu",
			action: () => showMainMenu(context),
			description: "Return to main menu",
		},
	]

	await showMenu("General Settings", options, context)
}

/**
 * Show providers menu
 */
async function showProvidersMenu(context: EditorContext): Promise<void> {
	const { config, addMessage: _addMessage } = context

	const options: MenuOption[] = [
		{
			label: `Current Provider: ${config.provider}`,
			action: () => selectCurrentProvider(context),
			description: "Change the active provider",
		},
		{
			label: "Manage Providers",
			action: () => showProviderManagementMenu(context),
			description: "Add, edit, or remove providers",
		},
		{
			label: "Back to Main Menu",
			action: () => showMainMenu(context),
			description: "Return to main menu",
		},
	]

	await showMenu("Providers", options, context)
}

/**
 * Show auto approval menu
 */
async function showAutoApprovalMenu(context: EditorContext): Promise<void> {
	const { config, addMessage: _addMessage } = context

	const autoApproval = config.autoApproval || {}

	const options: MenuOption[] = [
		{
			label: `Auto Approval: ${autoApproval.enabled ? "Enabled" : "Disabled"}`,
			action: () => toggleAutoApproval(context),
			description: "Enable or disable auto approval globally",
		},
		{
			label: "Configure Read Operations",
			action: () => showAutoApprovalReadMenu(context),
			description: "Configure auto approval for read operations",
		},
		{
			label: "Configure Write Operations",
			action: () => showAutoApprovalWriteMenu(context),
			description: "Configure auto approval for write operations",
		},
		{
			label: "Back to Main Menu",
			action: () => showMainMenu(context),
			description: "Return to main menu",
		},
	]

	await showMenu("Auto Approval", options, context)
}

/**
 * Generic menu display function
 */
async function showMenu(title: string, options: MenuOption[], context: EditorContext): Promise<void> {
	const { addMessage } = context

	let content = `**${title}**\n\n`

	options.forEach((option, index) => {
		content += `${index + 1}. ${option.label}`
		if (option.description) {
			content += ` - ${option.description}`
		}
		content += `\n`
	})

	content += `\nEnter a number (1-${options.length}) to select an option:`

	addMessage({
		id: Date.now().toString(),
		type: "system",
		content,
		ts: Date.now(),
	})

	// In a real implementation, we'd need to handle user input here
	// For now, we'll just show the menu and wait for user interaction
	// This would need to be integrated with the command input system
}

/**
 * Placeholder functions for menu actions
 * These would need to be implemented with proper user input handling
 */
async function editMode(context: EditorContext): Promise<void> {
	const { addMessage } = context
	addMessage({
		id: Date.now().toString(),
		type: "system",
		content: "Mode editing not yet implemented. Available modes: code, architect, ask, debug, test, etc.",
		ts: Date.now(),
	})
	await showGeneralSettingsMenu(context)
}

async function toggleTelemetry(context: EditorContext): Promise<void> {
	const { config, addMessage } = context
	config.telemetry = !config.telemetry
	addMessage({
		id: Date.now().toString(),
		type: "system",
		content: `Telemetry ${config.telemetry ? "enabled" : "disabled"}`,
		ts: Date.now(),
	})
	await showGeneralSettingsMenu(context)
}

async function editTheme(context: EditorContext): Promise<void> {
	const { addMessage } = context
	addMessage({
		id: Date.now().toString(),
		type: "system",
		content: "Theme editing not yet implemented. Available themes: dark, light, etc.",
		ts: Date.now(),
	})
	await showGeneralSettingsMenu(context)
}

async function selectCurrentProvider(context: EditorContext): Promise<void> {
	const { config, addMessage } = context

	const providerNames = config.providers.map((p) => p.provider)
	addMessage({
		id: Date.now().toString(),
		type: "system",
		content: `Available providers: ${providerNames.join(", ")}\nCurrent: ${config.provider}`,
		ts: Date.now(),
	})
	await showProvidersMenu(context)
}

async function showProviderManagementMenu(context: EditorContext): Promise<void> {
	const { addMessage } = context
	addMessage({
		id: Date.now().toString(),
		type: "system",
		content: "Provider management not yet implemented.",
		ts: Date.now(),
	})
	await showProvidersMenu(context)
}

async function toggleAutoApproval(context: EditorContext): Promise<void> {
	const { config, addMessage } = context

	if (!config.autoApproval) {
		config.autoApproval = { enabled: false }
	}

	config.autoApproval.enabled = !config.autoApproval.enabled
	addMessage({
		id: Date.now().toString(),
		type: "system",
		content: `Auto approval ${config.autoApproval.enabled ? "enabled" : "disabled"}`,
		ts: Date.now(),
	})
	await showAutoApprovalMenu(context)
}

async function showAutoApprovalReadMenu(context: EditorContext): Promise<void> {
	const { addMessage } = context
	addMessage({
		id: Date.now().toString(),
		type: "system",
		content: "Auto approval read settings not yet implemented.",
		ts: Date.now(),
	})
	await showAutoApprovalMenu(context)
}

async function showAutoApprovalWriteMenu(context: EditorContext): Promise<void> {
	const { addMessage } = context
	addMessage({
		id: Date.now().toString(),
		type: "system",
		content: "Auto approval write settings not yet implemented.",
		ts: Date.now(),
	})
	await showAutoApprovalMenu(context)
}

async function showCurrentConfig(context: EditorContext): Promise<void> {
	const { config, addMessage } = context

	let content = "**Current Configuration:**\n\n"
	content += `Version: ${config.version}\n`
	content += `Mode: ${config.mode}\n`
	content += `Provider: ${config.provider}\n`
	content += `Telemetry: ${config.telemetry ? "Enabled" : "Disabled"}\n`
	content += `Theme: ${config.theme || "default"}\n\n`

	content += `**Providers:**\n`
	config.providers.forEach((provider) => {
		content += `- ${provider.provider} (${provider.id})\n`
	})

	if (config.autoApproval) {
		content += `\n**Auto Approval:**\n`
		content += `Enabled: ${config.autoApproval.enabled ? "Yes" : "No"}\n`
	}

	addMessage({
		id: Date.now().toString(),
		type: "system",
		content,
		ts: Date.now(),
	})

	// Return to main menu after showing config
	await showMainMenu(context)
}

async function saveAndExit(context: EditorContext): Promise<void> {
	const { config, addMessage } = context

	try {
		await saveConfig(config)
		addMessage({
			id: Date.now().toString(),
			type: "system",
			content: "Configuration saved successfully!",
			ts: Date.now(),
		})
	} catch (error) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: `Failed to save configuration: ${error instanceof Error ? error.message : String(error)}`,
			ts: Date.now(),
		})
	}
}

async function exitWithoutSaving(context: EditorContext): Promise<void> {
	const { addMessage } = context
	addMessage({
		id: Date.now().toString(),
		type: "system",
		content: "Exiting without saving changes.",
		ts: Date.now(),
	})
}
