/**
 * /shortcuts command - Display keyboard shortcuts
 */

import type { Command } from "./core/types.js"
import { generateMessage } from "../ui/utils/messages.js"

type ShortcutItem = {
	keys: string
	description: string
}

type ShortcutSection = {
	title: string
	items: ShortcutItem[]
}

function getModifierKey(): "Cmd" | "Ctrl" {
	return process.platform === "darwin" ? "Cmd" : "Ctrl"
}

function buildShortcutSections(modifierKey: "Cmd" | "Ctrl"): ShortcutSection[] {
	return [
		{
			title: "Global",
			items: [
				{ keys: `${modifierKey}+C`, description: "Exit (press twice to confirm)" },
				{ keys: `${modifierKey}+Y`, description: "Toggle YOLO mode (auto-approve all operations)" },
				{ keys: `${modifierKey}+R`, description: "Resume task (when a task is ready to resume)" },
				{ keys: "Shift+Tab", description: "Cycle through modes" },
				{ keys: "!", description: "Enter shell mode (when input is empty)" },
				{ keys: "Up/Down", description: "Navigate command history (when input is empty)" },
				{ keys: `${modifierKey}+V`, description: "Paste image from clipboard (if available)" },
			],
		},
		{
			title: "Streaming/Task",
			items: [
				{ keys: "Esc", description: "Cancel current task (while streaming) or clear input" },
				{ keys: `${modifierKey}+X`, description: "Cancel current task (while streaming)" },
			],
		},
		{
			title: "Input",
			items: [
				{ keys: "Enter", description: "Submit message" },
				{ keys: "Shift+Enter", description: "Insert newline" },
			],
		},
		{
			title: "Approvals",
			items: [
				{ keys: "Y", description: "Approve" },
				{ keys: "N", description: "Reject" },
				{ keys: "1-9", description: "Select an approval scope (when shown)" },
				{ keys: "Esc", description: "Cancel approval prompt" },
			],
		},
		{
			title: "Followup Suggestions",
			items: [
				{ keys: "Up/Down", description: "Navigate suggestions" },
				{ keys: "Tab", description: "Fill suggestion" },
				{ keys: "Enter", description: "Submit suggestion" },
			],
		},
		{
			title: "Shell Mode",
			items: [
				{ keys: "Up/Down", description: "History" },
				{ keys: "Enter", description: "Execute command" },
				{ keys: "Esc", description: "Exit shell mode" },
				{ keys: "!", description: "Exit shell mode" },
			],
		},
	]
}

function formatShortcutSections(sections: ShortcutSection[]): string {
	const lines: string[] = ["**Keyboard Shortcuts**", ""]

	sections.forEach((section) => {
		lines.push(`**${section.title}**`)
		section.items.forEach((item) => {
			lines.push(`- \`${item.keys}\` - ${item.description}`)
		})
		lines.push("")
	})

	return lines.join("\n").trim()
}

export const shortcutsCommand: Command = {
	name: "shortcuts",
	aliases: ["keys", "hotkeys"],
	description: "Show keyboard shortcuts",
	usage: "/shortcuts",
	examples: ["/shortcuts", "/keys", "/hotkeys"],
	category: "system",
	priority: 7,
	handler: async (context) => {
		const { addMessage } = context
		const modifierKey = getModifierKey()
		const sections = buildShortcutSections(modifierKey)
		const content = formatShortcutSections(sections)

		addMessage({
			...generateMessage(),
			type: "system",
			content,
		})
	},
}
