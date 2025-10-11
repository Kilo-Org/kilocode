import { ToolArgs } from "../types"
import { BaseToolSchema } from "./base-tool-schema"

/**
 * Prompt when todos are NOT required (default)
 */
const PROMPT_WITHOUT_TODOS = `## new_task
Description: This will let you create a new task instance in the chosen mode using your provided message.

Parameters:
- mode: (required) The slug of the mode to start the new task in (e.g., "code", "debug", "architect").
- message: (required) The initial user message or instructions for this new task.

Usage:
<new_task>
<mode>your-mode-slug-here</mode>
<message>Your initial instructions here</message>
</new_task>

Example:
<new_task>
<mode>code</mode>
<message>Implement a new feature for the application</message>
</new_task>
`

/**
 * Prompt when todos ARE required
 */
const PROMPT_WITH_TODOS = `## new_task
Description: This will let you create a new task instance in the chosen mode using your provided message and initial todo list.

Parameters:
- mode: (required) The slug of the mode to start the new task in (e.g., "code", "debug", "architect").
- message: (required) The initial user message or instructions for this new task.
- todos: (required) The initial todo list in markdown checklist format for the new task.

Usage:
<new_task>
<mode>your-mode-slug-here</mode>
<message>Your initial instructions here</message>
<todos>
[ ] First task to complete
[ ] Second task to complete
[ ] Third task to complete
</todos>
</new_task>

Example:
<new_task>
<mode>code</mode>
<message>Implement user authentication</message>
<todos>
[ ] Set up auth middleware
[ ] Create login endpoint
[ ] Add session management
[ ] Write tests
</todos>
</new_task>

`

export function generateNewTaskSchema(args: ToolArgs): BaseToolSchema {
	const todosRequired = args.settings?.newTaskRequireTodos === true
	const schema: BaseToolSchema = {
		name: "new_task",
		description: "This will let you create a new task instance in the chosen mode using your provided message.",
		parameters: [
			{
				name: "mode",
				type: "string",
				description: 'The slug of the mode to start the new task in (e.g., "code", "debug", "architect").',
				required: true,
			},
			{
				name: "message",
				type: "string",
				description: "The initial user message or instructions for this new task.",
				required: true,
			},
		],
		systemPrompt: todosRequired ? PROMPT_WITH_TODOS : PROMPT_WITHOUT_TODOS,
	}
	if (todosRequired) {
		schema.parameters.push({
			name: "todos",
			type: "string",
			description: "The initial todo list in markdown checklist format for the new task. Use '[ ]' for pending",
			required: true,
		})
	}

	return schema
}
