// kilocode_change - new file: Native tool definition for create_draft
import type OpenAI from "openai"

const CREATE_DRAFT_DESCRIPTION = `Create a temporary, in-memory planning document that appears as an editor tab but is not saved to disk. These documents use a special draft:// URI scheme and are discarded when the editor session ends. This enables creating planning documents, implementation plans, and other ephemeral working documents for structured thinking.

The created document will:
- Appear as a normal editor tab that can be edited by the user
- Be accessible via read_file and write_to_file tools using the returned draft:// path
- Be automatically discarded when the editor session ends (not saved to disk)

Parameters:
- title: (required) The title/name of the draft document. Will be used as the filename with a unique ID suffix (automatically adds .plan.md extension if not present)
- content: (required) The initial content of the draft document

Example: Creating a planning document
{ "title": "implementation-plan", "content": "# Implementation Plan\n\n## Step 1\n- Task A\n- Task B\n\n## Step 2\n- Task C" }

Example: Creating a quick note
{ "title": "quick-notes", "content": "Remember to:\n1. Check API documentation\n2. Test edge cases\n3. Update tests" }`

const TITLE_PARAMETER_DESCRIPTION = `The title/name of the draft document. Will be used as the filename with a unique ID suffix (automatically adds .plan.md extension if not present)`

const CONTENT_PARAMETER_DESCRIPTION = `The initial content of the draft document`

export default {
	type: "function",
	function: {
		name: "create_draft",
		description: CREATE_DRAFT_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				title: {
					type: "string",
					description: TITLE_PARAMETER_DESCRIPTION,
				},
				content: {
					type: "string",
					description: CONTENT_PARAMETER_DESCRIPTION,
				},
			},
			required: ["title", "content"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
