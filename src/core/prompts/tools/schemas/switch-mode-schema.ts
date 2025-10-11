import { ToolArgs } from "../types"
import { BaseToolSchema } from "./base-tool-schema"

export function generateSwitchModeSchema(_: ToolArgs): BaseToolSchema {
	return {
		name: "switch_mode",
		description:
			"Switches to a different operational mode, like 'code' or 'architect'. The user must approve this switch. This is useful when a task requires a different set of capabilities.",
		parameters: [
			{
				name: "mode_slug",
				type: "string",
				description: "The unique identifier for the mode to switch to (e.g., 'code', 'ask', 'architect').",
				required: true,
			},
			{
				name: "reason",
				type: "string",
				description: "An optional explanation for why the mode switch is necessary.",
				required: false,
			},
		],
		systemPrompt: `## switch_mode
Description: Request to switch to a different mode. This tool allows modes to request switching to another mode when needed, such as switching to Code mode to make code changes. The user must approve the mode switch.
Parameters:
- mode_slug: (required) The slug of the mode to switch to (e.g., "code", "ask", "architect")
- reason: (optional) The reason for switching modes
Usage:
<switch_mode>
<mode_slug>Mode slug here</mode_slug>
<reason>Reason for switching here</reason>
</switch_mode>

Example: Requesting to switch to code mode
<switch_mode>
<mode_slug>code</mode_slug>
<reason>Need to make code changes</reason>
</switch_mode>`,
	}
}
