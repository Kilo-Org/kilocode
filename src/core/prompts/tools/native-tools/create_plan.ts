// kilocode_change - new file: Native tool definition for create_plan
import type OpenAI from "openai"

const CREATE_PLAN_DESCRIPTION = `Create an ephemeral planning document for brainstorming, strategy, and structured thinking. The document appears as an editor tab and is fully accessible during this session, but will be automatically discarded when the editor session ends (not saved to disk).

DEFAULT RULE: Use create_plan for ANY planning task unless the user EXPLICITLY requests disk persistence. The word "plan", "planning", "plan document", or any planning-related request should default to create_plan.

WHEN TO USE create_plan (DEFAULT for planning):
- ANY request involving "plan", "planning", "plan document", "create a plan", "plan something"
- Outlining strategies, organizing thoughts, brainstorming
- Requests to "plan it first" or "create a planning document"
- Iterating on ideas before committing to implementation
- Collaborative planning sessions
- When user asks about planning documents or wants to check for them
- IMPORTANT: Even if you think the user "might want persistence" - use create_plan unless they explicitly say so

WHEN NOT TO USE create_plan (use write_to_file instead):
- User EXPLICITLY says "save to disk", "persist", "save permanently", or "write to file"
- User EXPLICITLY provides a specific file path like "/plans/my-plan.md" or "save it to plans/"
- User EXPLICITLY mentions they want the document to "survive sessions" or "persist across sessions"
- User uses the word "write" or "save" instead of "plan" or "create"
- DO NOT infer persistence from context - only use write_to_file if user explicitly requests it

COMMON MISTAKES TO AVOID:
- ❌ DON'T use write_to_file just because you think "planning documents should persist" - that's an inference, not an explicit request
- ❌ DON'T use write_to_file because "real-world projects need persistent files" - use create_plan unless explicitly told otherwise
- ❌ DON'T use write_to_file because the user "might want to revisit it later" - use create_plan unless they explicitly say so
- ✅ DO use create_plan for any planning task unless the user explicitly requests persistence

KEY POINTS:
- Ephemeral plans are FULLY FUNCTIONAL during the session - they're not "temporary" in the sense of being less useful
- Ephemeral plans appear as editor tabs and are FULLY EDITABLE during this session
- Can be read and modified using read_file and write_to_file with the returned plan:// path
- Even ephemeral plans can be referenced by Code mode during this session - they don't need to be saved to disk to be useful
- The key distinction is EXPLICIT REQUEST for persistence vs DEFAULT ephemeral behavior
- "Ephemeral" means session-only, NOT "unusable" or "temporary" - it's a fully functional document during the session

The created document will:
- Appear as a normal editor tab that can be edited by the user
- Be accessible via read_file and write_to_file tools using the returned plan:// path
- Be automatically discarded when the editor session ends (not saved to disk)

Parameters:
- title: (required) The title/name of the plan document. Will be used as the filename with a unique ID suffix (automatically adds .plan.md extension if not present)
- content: (required) The initial content of the plan document

Example: Creating a planning document
{ "title": "implementation-plan", "content": "# Implementation Plan\n\n## Step 1\n- Task A\n- Task B\n\n## Step 2\n- Task C" }

Example: Creating a quick note
{ "title": "quick-notes", "content": "Remember to:\n1. Check API documentation\n2. Test edge cases\n3. Update tests" }`

const TITLE_PARAMETER_DESCRIPTION = `The title/name of the plan document. Will be used as the filename with a unique ID suffix (automatically adds .plan.md extension if not present)`

const CONTENT_PARAMETER_DESCRIPTION = `The initial content of the plan document`

export default {
	type: "function",
	function: {
		name: "create_plan",
		description: CREATE_PLAN_DESCRIPTION,
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
