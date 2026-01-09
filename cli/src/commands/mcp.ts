/**
 * /mcp command - Manage MCP (Model Context Protocol) servers
 * Allows adding, removing, listing, enabling, and disabling MCP servers
 */

import type { Command, CommandContext } from "./core/types.js"
import {
	loadMCPSettings,
	saveMCPSettings,
	loadProjectMCPSettings,
	saveProjectMCPSettings,
	getMergedMCPSettings,
	type MCPServerConfig,
	getMCPSettingsPath,
	getProjectMCPSettingsPath,
} from "../config/mcp-settings.js"

/**
 * Format server config for display
 */
function formatServerConfig(name: string, config: MCPServerConfig, isProjectLevel: boolean): string {
	let output = `**${name}**`
	if (isProjectLevel) {
		output += " *(project)*"
	}
	output += "\n"

	if (config.disabled) {
		output += "  Status: Disabled\n"
	}

	if (config.command) {
		output += `  Command: ${config.command}\n`
		if (config.args && config.args.length > 0) {
			output += `  Args: ${config.args.join(" ")}\n`
		}
	}

	if (config.type && config.type !== "stdio") {
		output += `  Type: ${config.type}\n`
		if (config.url) {
			output += `  URL: ${config.url}\n`
		}
		if (config.headers && Object.keys(config.headers).length > 0) {
			output += `  Headers: ${JSON.stringify(config.headers)}\n`
		}
	}

	if (config.env && Object.keys(config.env).length > 0) {
		output += `  Env: ${Object.keys(config.env).join(", ")}\n`
	}

	if (config.alwaysAllow && config.alwaysAllow.length > 0) {
		output += `  Always Allow: ${config.alwaysAllow.join(", ")}\n`
	}

	if (config.timeout && config.timeout !== 60) {
		output += `  Timeout: ${config.timeout}s\n`
	}

	return output
}

/**
 * Parse options with proper defaults
 */
function parseOptions(options: Record<string, string | number | boolean>): {
	global: boolean
	project: boolean
	json: boolean
} {
	const globalOpt = options.global
	const projectOpt = options.project
	const jsonOpt = options.json

	const global = globalOpt === true || (globalOpt === undefined && projectOpt !== true)
	const project = projectOpt === true
	const json = jsonOpt === true

	return { global, project, json }
}

/**
 * List all MCP servers
 */
async function listMCPServers(
	context: CommandContext,
	options: { global?: boolean; project?: boolean; json?: boolean },
): Promise<void> {
	const { addMessage } = context
	const cwd = process.cwd()

	try {
		const useGlobal = (options.global ?? true) !== false && !options.project
		const useProject = options.project === true

		if (options.json) {
			// JSON output
			if (useProject) {
				const projectSettings = await loadProjectMCPSettings(cwd)
				const output = projectSettings || { mcpServers: {} }
				addMessage({
					id: Date.now().toString(),
					type: "system",
					content: JSON.stringify(output, null, 2),
					ts: Date.now(),
				})
			} else {
				const settings = await loadMCPSettings()
				addMessage({
					id: Date.now().toString(),
					type: "system",
					content: JSON.stringify(settings, null, 2),
					ts: Date.now(),
				})
			}
			return
		}

		// Human-readable output
		let content = ""

		if (useProject && useGlobal) {
			// Show merged settings
			const mergedSettings = await getMergedMCPSettings(cwd)
			const projectSettings = await loadProjectMCPSettings(cwd)

			const serverNames = Object.keys(mergedSettings.mcpServers)

			if (serverNames.length === 0) {
				content = "No MCP servers configured.\n"
			} else {
				content = `**MCP Servers** (${serverNames.length} total)\n\n`

				for (const name of serverNames.sort()) {
					const isProject = projectSettings?.mcpServers[name] !== undefined
					content += formatServerConfig(name, mergedSettings.mcpServers[name]!, isProject)
					content += "\n"
				}
			}

			if (projectSettings) {
				content += `\nProject config: ${getProjectMCPSettingsPath(cwd)}\n`
			}
			content += `Global config: ${getMCPSettingsPath()}`
		} else if (useProject) {
			const projectSettings = await loadProjectMCPSettings(cwd)

			if (!projectSettings) {
				content = "No project-level MCP configuration found.\n"
				content += `Config path: ${getProjectMCPSettingsPath(cwd)}`
			} else {
				const serverNames = Object.keys(projectSettings.mcpServers)

				if (serverNames.length === 0) {
					content = "No MCP servers configured in project.\n"
				} else {
					content = `**Project MCP Servers** (${serverNames.length})\n\n`

					for (const name of serverNames.sort()) {
						content += formatServerConfig(name, projectSettings.mcpServers[name]!, true)
						content += "\n"
					}
				}
				content += `\nConfig path: ${getProjectMCPSettingsPath(cwd)}`
			}
		} else {
			const settings = await loadMCPSettings()
			const serverNames = Object.keys(settings.mcpServers)

			if (serverNames.length === 0) {
				content = "No MCP servers configured globally.\n"
			} else {
				content = `**Global MCP Servers** (${serverNames.length})\n\n`

				for (const name of serverNames.sort()) {
					content += formatServerConfig(name, settings.mcpServers[name]!, false)
					content += "\n"
				}
			}
			content += `\nConfig path: ${getMCPSettingsPath()}`
		}

		addMessage({
			id: Date.now().toString(),
			type: "system",
			content,
			ts: Date.now(),
		})
	} catch (error) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: `Failed to list MCP servers: ${error instanceof Error ? error.message : String(error)}`,
			ts: Date.now(),
		})
	}
}

/**
 * Add a new MCP server
 */
async function addMCPServer(
	context: CommandContext,
	name: string | undefined,
	options: { global?: boolean; project?: boolean },
): Promise<void> {
	const { addMessage } = context
	const cwd = process.cwd()

	if (!name) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: "Usage: /mcp add <name>",
			ts: Date.now(),
		})
		return
	}

	try {
		const useGlobal = (options.global ?? true) !== false && !options.project

		if (useGlobal) {
			const settings = await loadMCPSettings()

			if (settings.mcpServers[name]) {
				addMessage({
					id: Date.now().toString(),
					type: "error",
					content: `MCP server "${name}" already exists. Use /mcp edit <name> to modify it.`,
					ts: Date.now(),
				})
				return
			}

			// Create a placeholder config that the user needs to edit
			settings.mcpServers[name] = {
				command: "",
				args: [],
				env: {},
				alwaysAllow: [],
				disabled: false,
				timeout: 60,
			}

			await saveMCPSettings(settings)

			addMessage({
				id: Date.now().toString(),
				type: "system",
				content: `MCP server "${name}" added successfully.\n\nUse /mcp edit ${name} to configure it.`,
				ts: Date.now(),
			})
		} else {
			let projectSettings = await loadProjectMCPSettings(cwd)

			if (!projectSettings) {
				projectSettings = { mcpServers: {} }
			}

			if (projectSettings.mcpServers[name]) {
				addMessage({
					id: Date.now().toString(),
					type: "error",
					content: `MCP server "${name}" already exists in project config. Use /mcp edit <name> to modify it.`,
					ts: Date.now(),
				})
				return
			}

			projectSettings.mcpServers[name] = {
				command: "",
				args: [],
				env: {},
				alwaysAllow: [],
				disabled: false,
				timeout: 60,
			}

			await saveProjectMCPSettings(cwd, projectSettings)

			addMessage({
				id: Date.now().toString(),
				type: "system",
				content: `MCP server "${name}" added to project config.\n\nUse /mcp edit ${name} to configure it.`,
				ts: Date.now(),
			})
		}
	} catch (error) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: `Failed to add MCP server: ${error instanceof Error ? error.message : String(error)}`,
			ts: Date.now(),
		})
	}
}

/**
 * Remove an MCP server
 */
async function removeMCPServer(
	context: CommandContext,
	name: string | undefined,
	options: { global?: boolean; project?: boolean },
): Promise<void> {
	const { addMessage } = context
	const cwd = process.cwd()

	if (!name) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: "Usage: /mcp remove <name>",
			ts: Date.now(),
		})
		return
	}

	try {
		const useGlobal = (options.global ?? true) !== false && !options.project

		if (useGlobal) {
			const settings = await loadMCPSettings()

			if (!settings.mcpServers[name]) {
				addMessage({
					id: Date.now().toString(),
					type: "error",
					content: `MCP server "${name}" not found in global config.`,
					ts: Date.now(),
				})
				return
			}

			delete settings.mcpServers[name]
			await saveMCPSettings(settings)

			addMessage({
				id: Date.now().toString(),
				type: "system",
				content: `MCP server "${name}" removed from global config.`,
				ts: Date.now(),
			})
		} else {
			const projectSettings = await loadProjectMCPSettings(cwd)

			if (!projectSettings || !projectSettings.mcpServers[name]) {
				addMessage({
					id: Date.now().toString(),
					type: "error",
					content: `MCP server "${name}" not found in project config.`,
					ts: Date.now(),
				})
				return
			}

			delete projectSettings.mcpServers[name]
			await saveProjectMCPSettings(cwd, projectSettings)

			addMessage({
				id: Date.now().toString(),
				type: "system",
				content: `MCP server "${name}" removed from project config.`,
				ts: Date.now(),
			})
		}
	} catch (error) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: `Failed to remove MCP server: ${error instanceof Error ? error.message : String(error)}`,
			ts: Date.now(),
		})
	}
}

/**
 * Edit an existing MCP server configuration
 * This is an interactive-like editor that outputs the current config and tells the user to edit manually
 */
async function editMCPServer(
	context: CommandContext,
	name: string | undefined,
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	_options?: { global?: boolean; project?: boolean },
): Promise<void> {
	const { addMessage } = context
	const cwd = process.cwd()

	if (!name) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: "Usage: /mcp edit <name>",
			ts: Date.now(),
		})
		return
	}

	try {
		// Try project first, then global
		const projectSettings = await loadProjectMCPSettings(cwd)
		const globalSettings = await loadMCPSettings()

		const isProjectLevel = projectSettings?.mcpServers[name] !== undefined
		const currentConfig = isProjectLevel ? projectSettings!.mcpServers[name] : globalSettings.mcpServers[name]

		if (!currentConfig) {
			addMessage({
				id: Date.now().toString(),
				type: "error",
				content: `MCP server "${name}" not found. Use /mcp add ${name} to create it.`,
				ts: Date.now(),
			})
			return
		}

		// Output the current configuration in JSON format for editing
		const configPath = isProjectLevel ? getProjectMCPSettingsPath(cwd) : getMCPSettingsPath()

		addMessage({
			id: Date.now().toString(),
			type: "system",
			content:
				`Edit the MCP server configuration for "${name}" in:\n` +
				`${configPath}\n\n` +
				`Current configuration:\n` +
				`${JSON.stringify({ mcpServers: { [name]: currentConfig } }, null, 2)}\n\n` +
				`After editing, use /mcp list to verify changes.`,
			ts: Date.now(),
		})
	} catch (error) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: `Failed to edit MCP server: ${error instanceof Error ? error.message : String(error)}`,
			ts: Date.now(),
		})
	}
}

/**
 * Enable a disabled MCP server
 */
async function enableMCPServer(
	context: CommandContext,
	name: string | undefined,
	options: { global?: boolean; project?: boolean },
): Promise<void> {
	const { addMessage } = context
	const cwd = process.cwd()

	if (!name) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: "Usage: /mcp enable <name>",
			ts: Date.now(),
		})
		return
	}

	try {
		const useGlobal = (options.global ?? true) !== false && !options.project

		if (useGlobal) {
			const settings = await loadMCPSettings()

			if (!settings.mcpServers[name]) {
				addMessage({
					id: Date.now().toString(),
					type: "error",
					content: `MCP server "${name}" not found in global config.`,
					ts: Date.now(),
				})
				return
			}

			if (!settings.mcpServers[name].disabled) {
				addMessage({
					id: Date.now().toString(),
					type: "system",
					content: `MCP server "${name}" is already enabled.`,
					ts: Date.now(),
				})
				return
			}

			settings.mcpServers[name].disabled = false
			await saveMCPSettings(settings)

			addMessage({
				id: Date.now().toString(),
				type: "system",
				content: `MCP server "${name}" enabled.`,
				ts: Date.now(),
			})
		} else {
			let projectSettings = await loadProjectMCPSettings(cwd)

			if (!projectSettings) {
				projectSettings = { mcpServers: {} }
			}

			if (!projectSettings.mcpServers[name]) {
				addMessage({
					id: Date.now().toString(),
					type: "error",
					content: `MCP server "${name}" not found in project config.`,
					ts: Date.now(),
				})
				return
			}

			if (!projectSettings.mcpServers[name].disabled) {
				addMessage({
					id: Date.now().toString(),
					type: "system",
					content: `MCP server "${name}" is already enabled.`,
					ts: Date.now(),
				})
				return
			}

			projectSettings.mcpServers[name].disabled = false
			await saveProjectMCPSettings(cwd, projectSettings)

			addMessage({
				id: Date.now().toString(),
				type: "system",
				content: `MCP server "${name}" enabled in project config.`,
				ts: Date.now(),
			})
		}
	} catch (error) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: `Failed to enable MCP server: ${error instanceof Error ? error.message : String(error)}`,
			ts: Date.now(),
		})
	}
}

/**
 * Disable an MCP server
 */
async function disableMCPServer(
	context: CommandContext,
	name: string | undefined,
	options: { global?: boolean; project?: boolean },
): Promise<void> {
	const { addMessage } = context
	const cwd = process.cwd()

	if (!name) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: "Usage: /mcp disable <name>",
			ts: Date.now(),
		})
		return
	}

	try {
		const useGlobal = (options.global ?? true) !== false && !options.project

		if (useGlobal) {
			const settings = await loadMCPSettings()

			if (!settings.mcpServers[name]) {
				addMessage({
					id: Date.now().toString(),
					type: "error",
					content: `MCP server "${name}" not found in global config.`,
					ts: Date.now(),
				})
				return
			}

			if (settings.mcpServers[name].disabled) {
				addMessage({
					id: Date.now().toString(),
					type: "system",
					content: `MCP server "${name}" is already disabled.`,
					ts: Date.now(),
				})
				return
			}

			settings.mcpServers[name].disabled = true
			await saveMCPSettings(settings)

			addMessage({
				id: Date.now().toString(),
				type: "system",
				content: `MCP server "${name}" disabled.`,
				ts: Date.now(),
			})
		} else {
			let projectSettings = await loadProjectMCPSettings(cwd)

			if (!projectSettings) {
				projectSettings = { mcpServers: {} }
			}

			if (!projectSettings.mcpServers[name]) {
				addMessage({
					id: Date.now().toString(),
					type: "error",
					content: `MCP server "${name}" not found in project config.`,
					ts: Date.now(),
				})
				return
			}

			if (projectSettings.mcpServers[name].disabled) {
				addMessage({
					id: Date.now().toString(),
					type: "system",
					content: `MCP server "${name}" is already disabled.`,
					ts: Date.now(),
				})
				return
			}

			projectSettings.mcpServers[name].disabled = true
			await saveProjectMCPSettings(cwd, projectSettings)

			addMessage({
				id: Date.now().toString(),
				type: "system",
				content: `MCP server "${name}" disabled in project config.`,
				ts: Date.now(),
			})
		}
	} catch (error) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: `Failed to disable MCP server: ${error instanceof Error ? error.message : String(error)}`,
			ts: Date.now(),
		})
	}
}

/**
 * Show help for /mcp command
 */
async function showMCPhelp(context: CommandContext): Promise<void> {
	const { addMessage } = context

	const content = `**MCP (Model Context Protocol) Server Management**

Manage MCP servers for your Kilo Code CLI.

**Usage:**
\`/mcp [subcommand] [options]\`

**Subcommands:**
- \`list\` - List all configured MCP servers
- \`add <name>\` - Add a new MCP server
- \`remove <name>\` - Remove an MCP server
- \`edit <name>\` - Edit an existing MCP server
- \`enable <name>\` - Enable a disabled server
- \`disable <name>\` - Disable a server

**Options:**
- \`--global\` - Use global settings (default)
- \`--project\` - Use project-level settings
- \`--json\` - Output as JSON (for list command)

**Examples:**
\`/mcp list\` - List all MCP servers
\`/mcp list --json\` - List all MCP servers in JSON format
\`/mcp add myserver\` - Add a new server named "myserver"
\`/mcp remove myserver\` - Remove "myserver"
\`/mcp edit myserver --project\` - Edit project-level server config
\`/mcp disable myserver\` - Disable "myserver"
\`/mcp enable myserver\` - Enable "myserver"

**Configuration Files:**
- Global: \`~/.kilocode/cli/global/settings/mcp_settings.json\`
- Project: \`<cwd>/.kilocode/mcp.json\``

	addMessage({
		id: Date.now().toString(),
		type: "system",
		content,
		ts: Date.now(),
	})
}

export const mcpCommand: Command = {
	name: "mcp",
	aliases: [],
	description: "Manage MCP (Model Context Protocol) servers",
	usage: "/mcp [subcommand] [args] [options]",
	examples: [
		"/mcp",
		"/mcp list",
		"/mcp list --json",
		"/mcp add myserver",
		"/mcp remove myserver",
		"/mcp edit myserver",
		"/mcp disable myserver",
		"/mcp enable myserver",
	],
	category: "settings",
	priority: 8,
	arguments: [
		{
			name: "subcommand",
			description: "Subcommand: list, add, remove, edit, enable, disable",
			required: false,
			values: [
				{ value: "list", description: "List all configured MCP servers" },
				{ value: "add", description: "Add a new MCP server" },
				{ value: "remove", description: "Remove an MCP server" },
				{ value: "edit", description: "Edit an existing MCP server" },
				{ value: "enable", description: "Enable a disabled server" },
				{ value: "disable", description: "Disable a server" },
			],
		},
		{
			name: "server-name",
			description: "Name of the MCP server",
			required: false,
		},
	],
	options: [
		{
			name: "global",
			alias: "g",
			description: "Use global settings (default)",
			type: "boolean",
			default: true,
		},
		{
			name: "project",
			alias: "p",
			description: "Use project-level settings",
			type: "boolean",
			default: false,
		},
		{
			name: "json",
			alias: "j",
			description: "Output as JSON (for list command)",
			type: "boolean",
			default: false,
		},
	],
	handler: async (context) => {
		const { args, options } = context

		// No arguments - show help
		if (args.length === 0) {
			await showMCPhelp(context)
			return
		}

		const subcommand = args[0]?.toLowerCase()
		const serverName = args[1]

		// Parse options with proper defaults
		const opt = parseOptions(options)

		switch (subcommand) {
			case "list":
				await listMCPServers(context, { global: opt.global, project: opt.project, json: opt.json })
				break

			case "add":
				await addMCPServer(context, serverName, { global: opt.global, project: opt.project })
				break

			case "remove":
			case "rm":
				await removeMCPServer(context, serverName, { global: opt.global, project: opt.project })
				break

			case "edit":
				await editMCPServer(context, serverName, { global: opt.global, project: opt.project })
				break

			case "enable":
				await enableMCPServer(context, serverName, { global: opt.global, project: opt.project })
				break

			case "disable":
				await disableMCPServer(context, serverName, { global: opt.global, project: opt.project })
				break

			default:
				context.addMessage({
					id: Date.now().toString(),
					type: "error",
					content: `Unknown subcommand "${subcommand}". Use /mcp for help.`,
					ts: Date.now(),
				})
		}
	},
}
