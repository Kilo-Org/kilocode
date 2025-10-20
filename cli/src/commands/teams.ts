/**
 * /teams command - Manage team/organization selection
 */

import type { Command } from "./core/types.js"

/**
 * Show current team
 */
async function showCurrentTeam(context: any): Promise<void> {
	const { currentProvider, addMessage, sendMessage } = context

	// Check if user is authenticated with Kilocode
	if (!currentProvider || currentProvider.provider !== "kilocode") {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: "Teams command requires Kilocode provider. Please configure Kilocode as your provider.",
			ts: Date.now(),
		})
		return
	}

	if (!currentProvider.kilocodeToken) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: "Not authenticated. Please configure your Kilocode token first.",
			ts: Date.now(),
		})
		return
	}

	const currentOrgId = currentProvider.kilocodeOrganizationId

	// If no organization is set, show Personal
	if (!currentOrgId) {
		addMessage({
			id: Date.now().toString(),
			type: "system",
			content: "**Current Team:** Personal",
			ts: Date.now(),
		})
		return
	}

	// Show current organization ID (name would require fetching profile data)
	addMessage({
		id: Date.now().toString(),
		type: "system",
		content: `**Current Team:** ${currentOrgId}\n\nUse \`/teams list\` to see team details.`,
		ts: Date.now(),
	})
}

/**
 * List all available teams
 */
async function listTeams(context: any): Promise<void> {
	const { currentProvider, addMessage, sendMessage } = context

	// Check if user is authenticated with Kilocode
	if (!currentProvider || currentProvider.provider !== "kilocode") {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: "Teams command requires Kilocode provider. Please configure Kilocode as your provider.",
			ts: Date.now(),
		})
		return
	}

	if (!currentProvider.kilocodeToken) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: "Not authenticated. Please configure your Kilocode token first.",
			ts: Date.now(),
		})
		return
	}

	addMessage({
		id: Date.now().toString(),
		type: "system",
		content: "Loading available teams...",
		ts: Date.now(),
	})

	try {
		// Send profile data request to fetch organizations
		await sendMessage({
			type: "fetchProfileDataRequest",
		})

		// Note: The actual response handling is done by the extension
		// and will be displayed through the message stream
		addMessage({
			id: Date.now().toString(),
			type: "system",
			content: "Teams data requested. Check your profile in the Kilocode dashboard for available teams.",
			ts: Date.now(),
		})
	} catch (error) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: `Failed to load teams: ${error instanceof Error ? error.message : String(error)}`,
			ts: Date.now(),
		})
	}
}

/**
 * Select a team
 */
async function selectTeam(context: any, teamId: string): Promise<void> {
	const { currentProvider, addMessage, sendMessage, updateProvider } = context

	// Check if user is authenticated with Kilocode
	if (!currentProvider || currentProvider.provider !== "kilocode") {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: "Teams command requires Kilocode provider. Please configure Kilocode as your provider.",
			ts: Date.now(),
		})
		return
	}

	if (!currentProvider.kilocodeToken) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: "Not authenticated. Please configure your Kilocode token first.",
			ts: Date.now(),
		})
		return
	}

	try {
		// Handle "personal" as special case
		if (teamId.toLowerCase() === "personal") {
			// Update provider configuration to remove organization ID
			await updateProvider(currentProvider.id, {
				kilocodeOrganizationId: undefined,
			})

			addMessage({
				id: Date.now().toString(),
				type: "system",
				content: "✓ Switched to **Personal** account",
				ts: Date.now(),
			})
			return
		}

		// Update provider configuration with new organization ID
		await updateProvider(currentProvider.id, {
			kilocodeOrganizationId: teamId,
		})

		addMessage({
			id: Date.now().toString(),
			type: "system",
			content: `✓ Switched to team: **${teamId}**`,
			ts: Date.now(),
		})
	} catch (error) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: `Failed to switch team: ${error instanceof Error ? error.message : String(error)}`,
			ts: Date.now(),
		})
	}
}

export const teamsCommand: Command = {
	name: "teams",
	aliases: ["team", "org"],
	description: "Manage team/organization selection",
	usage: "/teams [subcommand] [args]",
	examples: ["/teams", "/teams list", "/teams select personal", "/teams select org-123"],
	category: "settings",
	priority: 10,
	arguments: [
		{
			name: "subcommand",
			description: "Subcommand: list, select",
			required: false,
			values: [
				{ value: "list", description: "List all available teams" },
				{ value: "select", description: "Switch to a different team" },
			],
		},
		{
			name: "team-id",
			description: "Team ID or 'personal' (for select subcommand)",
			required: false,
		},
	],
	handler: async (context) => {
		const { args } = context

		// No arguments - show current team
		if (args.length === 0) {
			await showCurrentTeam(context)
			return
		}

		const subcommand = args[0]?.toLowerCase()
		if (!subcommand) {
			await showCurrentTeam(context)
			return
		}

		// Handle subcommands
		switch (subcommand) {
			case "list":
				await listTeams(context)
				break

			case "select":
				if (args.length < 2 || !args[1]) {
					context.addMessage({
						id: Date.now().toString(),
						type: "error",
						content: "Usage: /teams select <team-id>\nUse 'personal' to switch to personal account.",
						ts: Date.now(),
					})
					return
				}
				await selectTeam(context, args[1])
				break

			default:
				context.addMessage({
					id: Date.now().toString(),
					type: "error",
					content: `Unknown subcommand "${subcommand}". Available: list, select`,
					ts: Date.now(),
				})
		}
	},
}
