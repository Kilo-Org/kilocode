/**
 * /teams command - Manage team/organization selection
 */

import type { Command, ArgumentProviderContext, ArgumentSuggestion, CommandContext } from "./core/types.js"
import type { UserOrganization } from "../state/atoms/profile.js"

/**
 * Normalize team name to lowercase with dashes
 * Example: "Kilo Code" -> "kilo-code"
 */
function normalizeTeamName(name: string): string {
	return name
		.toLowerCase()
		.trim()
		.replace(/\s+/g, "-") // Replace spaces with dashes
		.replace(/[^a-z0-9-]/g, "") // Remove special characters except dashes
		.replace(/-+/g, "-") // Replace multiple dashes with single dash
		.replace(/^-|-$/g, "") // Remove leading/trailing dashes
}

/**
 * List all available teams
 */
async function listTeams(context: CommandContext): Promise<void> {
	const { currentProvider, addMessage, profileData, profileLoading } = context

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

	// Check if still loading
	if (profileLoading) {
		addMessage({
			id: Date.now().toString(),
			type: "system",
			content: "Loading available teams...",
			ts: Date.now(),
		})
		return
	}

	const organizations = profileData?.organizations || []
	const currentOrgId = currentProvider.kilocodeOrganizationId

	if (organizations.length < 1) {
		addMessage({
			id: Date.now().toString(),
			type: "system",
			content: `You're currently not a part of any Kilo Code teams. Go to https://app.kilo.ai/get-started/teams to get started with Kilo Code for Teams!`,
			ts: Date.now(),
		})
		return
	}

	let content = "**Available Teams:**\n\n"

	// Add Personal option
	const isPersonal = !currentOrgId
	content += `${isPersonal ? "→ " : "  "}Personal${isPersonal ? " (current)" : ""}\n`

	// Add organizations
	for (const org of organizations) {
		const isCurrent = org.id === currentOrgId
		content += `${isCurrent ? "→ " : "  "}${normalizeTeamName(org.name)}${isCurrent ? " (current)" : ""}\n`
	}
	if (organizations.length > 0) {
		content += `\nUse \`/teams select ${normalizeTeamName(organizations[0]!.name)}\` to select a team profile\n`
	}
	content += `Use \`/teams select personal\` to switch to personal account\n`

	addMessage({
		id: Date.now().toString(),
		type: "system",
		content,
		ts: Date.now(),
	})
}

/**
 * Select a team
 */
async function selectTeam(context: CommandContext, teamId: string): Promise<void> {
	const { currentProvider, addMessage, updateProvider, profileData, refreshRouterModels } = context

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
			await refreshRouterModels()

			addMessage({
				id: Date.now().toString(),
				type: "system",
				content: "Switched to **Personal** account",
				ts: Date.now(),
			})

			return
		}

		// Validate team ID if we have profile data
		if (profileData?.organizations) {
			// Try to find by ID first
			let targetOrg = profileData.organizations.find((org: UserOrganization) => org.id === teamId)

			// If not found by ID, try normalized name match
			if (!targetOrg) {
				const normalizedInput = normalizeTeamName(teamId)
				targetOrg = profileData.organizations.find(
					(org: UserOrganization) => normalizeTeamName(org.name) === normalizedInput,
				)
			}

			if (!targetOrg) {
				addMessage({
					id: Date.now().toString(),
					type: "error",
					content: `Team "${teamId}" not found. Use \`/teams list\` to see available teams.`,
					ts: Date.now(),
				})
				return
			}

			// Update provider configuration with new organization ID
			await updateProvider(currentProvider.id, {
				kilocodeOrganizationId: targetOrg.id,
			})

			await refreshRouterModels()

			addMessage({
				id: Date.now().toString(),
				type: "system",
				content: `Switched to team: **${targetOrg.name}** (${targetOrg.role})`,
				ts: Date.now(),
			})
		} else {
			// No profile data loaded
			addMessage({
				id: Date.now().toString(),
				type: "error",
				content: `Failed to switch team`,
				ts: Date.now(),
			})
		}
	} catch (error) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: `Failed to switch team: ${error instanceof Error ? error.message : String(error)}`,
			ts: Date.now(),
		})
	}
}
/**
 * Autocomplete provider for team names
 */
async function teamAutocompleteProvider(context: ArgumentProviderContext): Promise<ArgumentSuggestion[]> {
	// Check if commandContext is available
	if (!context.commandContext) {
		return []
	}

	const { currentProvider, profileData, profileLoading } = context.commandContext

	// Check if user is authenticated with Kilocode
	if (!currentProvider || currentProvider.provider !== "kilocode") {
		return []
	}

	if (!currentProvider.kilocodeToken) {
		return []
	}

	// If still loading, return loading state
	if (profileLoading) {
		return [
			{
				value: "loading",
				title: "Loading teams...",
				description: "Please wait",
				matchScore: 1.0,
				highlightedValue: "loading",
				loading: true,
			},
		]
	}

	const organizations = profileData?.organizations || []
	const suggestions: ArgumentSuggestion[] = []

	// Add Personal option
	suggestions.push({
		value: "personal",
		title: "Personal",
		description: "Your personal account",
		matchScore: 1.0,
		highlightedValue: "personal",
	})

	// Add organizations
	for (const org of organizations) {
		const normalizedName = normalizeTeamName(org.name)
		suggestions.push({
			value: normalizedName,
			title: org.name,
			description: `${org.name} (${org.role})`,
			matchScore: 1.0,
			highlightedValue: normalizedName,
		})
	}

	return suggestions
}

export const teamsCommand: Command = {
	name: "teams",
	aliases: ["team", "org", "orgs"],
	description: "Manage team/organization selection",
	usage: "/teams [subcommand] [args]",
	examples: ["/teams", "/teams list", "/teams select personal", "/teams select kilo-code", "/teams select my-team"],
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
			name: "team-name",
			description:
				"Team name in lowercase with dashes (e.g., 'kilo-code' for 'Kilo Code') or 'personal' (for select subcommand)",
			required: false,
			conditionalProviders: [
				{
					condition: (context) => {
						const subcommand = context.getArgument("subcommand")
						return subcommand === "select"
					},
					provider: teamAutocompleteProvider,
				},
			],
		},
	],
	handler: async (context) => {
		const { args } = context

		// No arguments - show current team
		if (args.length === 0) {
			await listTeams(context)
			return
		}

		const subcommand = args[0]?.toLowerCase()
		if (!subcommand) {
			await listTeams(context)
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
						content:
							"Usage: /teams select <team-id-or-name>\nUse 'personal' to switch to personal account.",
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
