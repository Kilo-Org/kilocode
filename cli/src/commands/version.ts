/**
 * /version command - Display CLI version information
 */

import os from "os"
import type { Command } from "./core/types.js"
import { Package } from "../constants/package.js"
import { getAutoUpdateStatus } from "../utils/auto-update.js"
import { generateMessage } from "../ui/utils/messages.js"

function formatUpdateLine(status: Awaited<ReturnType<typeof getAutoUpdateStatus>>): string[] {
	if (status.isOutdated) {
		return [
			`Update: v${status.latestVersion} available (current v${status.currentVersion})`,
			`Run: npm install -g ${status.name}`,
		]
	}

	return ["Update: up to date"]
}

export const versionCommand: Command = {
	name: "version",
	aliases: ["about", "ver"],
	description: "Show CLI version information",
	usage: "/version",
	examples: ["/version", "/about", "/ver"],
	category: "system",
	priority: 7,
	handler: async (context) => {
		const { addMessage } = context
		const status = await getAutoUpdateStatus()

		const lines = [
			"**Version Information**",
			"",
			`CLI: ${Package.name} v${Package.version}`,
			`Node: ${process.version}`,
			`OS: ${os.platform()} ${os.release()} (${process.arch})`,
			...formatUpdateLine(status),
		]

		addMessage({
			...generateMessage(),
			type: "system",
			content: lines.join("\n"),
		})
	},
}
