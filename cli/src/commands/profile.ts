/**
 * /profile command - View user profile information
 */

import type { Command } from "./core/types.js"

/**
 * Show user profile information
 */
async function showProfile(context: any): Promise<void> {
	const { currentProvider, addMessage, sendMessage } = context

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

	// Show loading message
	addMessage({
		id: Date.now().toString(),
		type: "system",
		content: "Loading profile information...",
		ts: Date.now(),
	})

	try {
		// Send profile data request
		await sendMessage({
			type: "fetchProfileDataRequest",
		})

		// Send balance data request
		await sendMessage({
			type: "fetchBalanceDataRequest",
		})

		// Note: The actual response handling is done by the extension
		// and will be displayed through the message stream
		addMessage({
			id: Date.now().toString(),
			type: "system",
			content: "Profile data requested. Check your profile in the Kilocode dashboard for detailed information.",
			ts: Date.now(),
		})
	} catch (error) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: `Failed to load profile: ${error instanceof Error ? error.message : String(error)}`,
			ts: Date.now(),
		})
	}
}

export const profileCommand: Command = {
	name: "profile",
	aliases: ["prof"],
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
