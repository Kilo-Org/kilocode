/**
 * /profile command - View user profile information
 */

import type { Command, CommandContext } from "./core/types.js"
import type { UserOrganization } from "../state/atoms/profile.js"

/**
 * Show user profile information
 */
async function showProfile(context: CommandContext): Promise<void> {
	const { currentProvider, addMessage, profileData, balanceData, profileLoading, balanceLoading } = context

	// Check if user is authenticated with Kilocode
	if (!currentProvider || currentProvider.provider !== "kilocode") {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: "Profile command requires Kilocode provider. Please configure Kilocode as your provider.",
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
	if (profileLoading || balanceLoading) {
		addMessage({
			id: Date.now().toString(),
			type: "system",
			content: "Loading profile information...",
			ts: Date.now(),
		})
		return
	}

	// Display profile information
	if (!profileData) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: "No profile data available",
			ts: Date.now(),
		})
		return
	}

	const user = profileData.user

	if (!user) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: "No user data available",
			ts: Date.now(),
		})
		return
	}

	// Format profile information
	let content = "**Profile Information:**\n\n"

	if (user.name) {
		content += `Name: ${user.name}\n`
	}

	if (user.email) {
		content += `Email: ${user.email}\n`
	}

	if (balanceData?.balance !== undefined && balanceData?.balance !== null) {
		content += `Balance: $${balanceData.balance.toFixed(2)}\n`
	}

	// Show current organization if set
	const currentOrgId = currentProvider.kilocodeOrganizationId
	if (currentOrgId && profileData?.organizations) {
		const currentOrg = profileData.organizations.find((org: UserOrganization) => org.id === currentOrgId)
		if (currentOrg) {
			content += `Teams: ${currentOrg.name} (${currentOrg.role})\n`
		}
	} else {
		content += `Teams: Personal\n`
	}

	addMessage({
		id: Date.now().toString(),
		type: "system",
		content,
		ts: Date.now(),
	})
}

export const profileCommand: Command = {
	name: "profile",
	aliases: ["me", "whoami"],
	description: "View your Kilocode profile information",
	usage: "/profile",
	examples: ["/profile"],
	category: "settings",
	priority: 9,
	arguments: [],
	handler: async (context) => {
		await showProfile(context)
	},
}
