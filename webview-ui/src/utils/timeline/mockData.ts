import type { ClineMessage } from "@roo-code/types"
import seedrandom from "seedrandom"

// Fixed base timestamp for consistent snapshots (January 1, 2024, 12:00:00 UTC)
const BASE_TIMESTAMP = 1704110400000
const rng = seedrandom("TimelineData")

export function generateSampleTimelineData(): ClineMessage[] {
	const messages: ClineMessage[] = []

	const messageTemplates = [
		{
			type: "ask",
			ask: "command",
			texts: ["Create a React component", "Build a todo app", "Fix the login bug", "Add dark mode support"],
		},
		{
			type: "say",
			say: "text",
			texts: [
				"I'll help you with that",
				"Let me analyze the requirements",
				"I'll start by examining the code",
				"Let me understand the current setup",
			],
		},
		{
			type: "ask",
			ask: "tool",
			texts: [
				JSON.stringify({ tool: "read_file", path: "src/App.tsx" }),
				JSON.stringify({ tool: "list_files", path: "src/components" }),
				JSON.stringify({ tool: "search_files", query: "useState" }),
				JSON.stringify({ tool: "read_file", path: "package.json" }),
			],
		},
		{
			type: "say",
			say: "command_output",
			texts: ["File created successfully", "Changes applied", "Build completed", "Tests passed"],
		},
		{ type: "say", say: "checkpoint_saved", texts: ["Checkpoint saved", "Progress saved", "State preserved"] },
		{
			type: "say",
			say: "completion_result",
			texts: ["Task completed successfully!", "All done!", "Implementation finished", "Ready to use"],
		},
	]

	for (let cycle = 0; cycle < 8; cycle++) {
		messageTemplates.forEach((template, i) => {
			const randomText = template.texts[Math.floor(rng() * template.texts.length)]
			messages.push({
				ts: BASE_TIMESTAMP + (cycle * 8 + i) * (1000 + rng() * 3000),
				type: template.type as "ask" | "say",
				...(template.ask && { ask: template.ask as any }),
				...(template.say && { say: template.say as any }),
				text: randomText,
			})
		})
	}

	return messages
}
