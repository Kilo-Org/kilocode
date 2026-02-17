import { ToolArgs } from "./types"

const PROMPT = `## subagent
Description: Run a subagent in the background to do a focused sub-task. When the subagent finishes, its result or summary is returned as this tool's result and you can use it in your next step. Use when: (1) you need to offload research, exploration, or a multi-step sub-task without switching the user's view, or (2) you want read-only exploration (subagent_type "explore") with no file edits or commands. Do not use for creating a new user-visible task—use new_task instead.

Parameters:
- description: (required) Short label for this subagent, shown in the chat (e.g., "List exports in src", "Check README")
- prompt: (required) Full instructions for the subagent. Its result or summary will be returned as this tool's result.
- subagent_type: (required) "general": full tools—subagent can read, edit, and run commands. Use when the sub-task may need to change files or run commands. "explore": read-only—subagent can only use read/search/list tools (no file edits or commands). Use for research or gathering information.

Usage:
<subagent>
<description>Your description here</description>
<prompt>Your full instructions here</prompt>
<subagent_type>general</subagent_type>
</subagent>

Example:
<subagent>
<description>List exports in src</description>
<prompt>Find all exported functions and classes in the src directory. List them with their file paths.</prompt>
<subagent_type>explore</subagent_type>
</subagent>
`

export function getSubagentDescription(args: ToolArgs): string {
	return PROMPT
}
