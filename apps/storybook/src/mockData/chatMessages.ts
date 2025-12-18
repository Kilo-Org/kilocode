import { ClineMessage, SuggestionItem } from "@roo-code/types"
import { BASE_TIMESTAMP } from "./clineMessages"

/**
 * Type alias for ClineMessage without timestamp
 * Cleaner than writing Omit<ClineMessage, 'ts'> everywhere
 */
export type ClineMessageData = Omit<ClineMessage, "ts">

/**
 * Type-safe message presets for Storybook
 * Each preset must satisfy ClineMessageData to ensure type safety
 * If ClineMessage shape changes, TypeScript will error here
 */

// ============================================================================
// ASK MESSAGE PRESETS
// ============================================================================

export const ASK_PRESETS = {
	followup: {
		type: "ask",
		ask: "followup",
		text: JSON.stringify({
			question: "Would you like me to add error handling to this component?",
			suggest: [
				{ answer: "Yes, please add error handling" },
				{ answer: "No, keep it simple" },
				{ answer: "Add error handling and logging" },
			] as SuggestionItem[],
		}),
	} satisfies ClineMessageData,

	followup_no_suggestions: {
		type: "ask",
		ask: "followup",
		text: JSON.stringify({
			question: "What should I do next?",
			suggest: [] as SuggestionItem[],
		}),
	} satisfies ClineMessageData,

	command: {
		type: "ask",
		ask: "command",
		text: "npm install react react-dom",
	} satisfies ClineMessageData,

	command_output: {
		type: "ask",
		ask: "command_output",
		text: "Command output here...",
	} satisfies ClineMessageData,

	tool_edited_file: {
		type: "ask",
		ask: "tool",
		text: JSON.stringify({
			tool: "editedExistingFile",
			path: "src/components/Example.tsx",
			diff: `--- a/src/components/Example.tsx\n+++ b/src/components/Example.tsx\n@@ -1,3 +1,4 @@\n import React from 'react'\n+\n+export const Example = () => <div>Example</div>`,
		}),
	} satisfies ClineMessageData,

	tool_applied_diff: {
		type: "ask",
		ask: "tool",
		text: JSON.stringify({
			tool: "appliedDiff",
			path: "src/utils.ts",
			diff: `--- a/src/utils.ts\n+++ b/src/utils.ts\n@@ -1,5 +1,6 @@\n export const add = (a, b) => a + b\n+export const subtract = (a, b) => a - b`,
		}),
	} satisfies ClineMessageData,

	tool_new_file: {
		type: "ask",
		ask: "tool",
		text: JSON.stringify({
			tool: "newFileCreated",
			path: "src/components/NewComponent.tsx",
			content: `import React from 'react'\n\nexport const Example = () => {\n  return <div>Example Component</div>\n}`,
		}),
	} satisfies ClineMessageData,

	tool_read_file: {
		type: "ask",
		ask: "tool",
		text: JSON.stringify({
			tool: "read_file",
			path: "src/components/Example.tsx",
		}),
	} satisfies ClineMessageData,

	tool_codebase_search: {
		type: "ask",
		ask: "tool",
		text: JSON.stringify({
			tool: "codebase_search",
			query: "user authentication",
		}),
	} satisfies ClineMessageData,

	tool_search_files: {
		type: "ask",
		ask: "tool",
		text: JSON.stringify({
			tool: "search_files",
			regex: ".*\\.ts$",
			path: "src/",
		}),
	} satisfies ClineMessageData,

	tool_list_files_top: {
		type: "ask",
		ask: "tool",
		text: JSON.stringify({
			tool: "listFilesTopLevel",
			path: "src/",
		}),
	} satisfies ClineMessageData,

	tool_list_files_recursive: {
		type: "ask",
		ask: "tool",
		text: JSON.stringify({
			tool: "listFilesRecursive",
			path: "src/",
		}),
	} satisfies ClineMessageData,

	tool_list_code_definitions: {
		type: "ask",
		ask: "tool",
		text: JSON.stringify({
			tool: "list_code_definition_names",
			path: "src/components/",
		}),
	} satisfies ClineMessageData,

	tool_switch_mode: {
		type: "ask",
		ask: "tool",
		text: JSON.stringify({
			tool: "switch_mode",
			mode: "code",
			reason: "Need to write some code",
		}),
	} satisfies ClineMessageData,

	tool_new_task: {
		type: "ask",
		ask: "tool",
		text: JSON.stringify({
			tool: "new_task",
			content: "Create a new feature component",
			mode: "code",
		}),
	} satisfies ClineMessageData,

	tool_generate_image: {
		type: "ask",
		ask: "tool",
		text: JSON.stringify({
			tool: "generate_image",
			path: "assets/diagram.png",
			prompt: "A flowchart showing the authentication process",
		}),
	} satisfies ClineMessageData,

	tool_run_slash_command: {
		type: "ask",
		ask: "tool",
		text: JSON.stringify({
			tool: "run_slash_command",
			command: "/test",
			args: "--verbose",
			description: "Run test suite",
			source: "custom",
		}),
	} satisfies ClineMessageData,

	tool_update_todo: {
		type: "ask",
		ask: "tool",
		text: JSON.stringify({
			tool: "update_todo_list",
			todos: [
				{ id: "1", text: "Create component", completed: false },
				{ id: "2", text: "Add tests", completed: false },
				{ id: "3", text: "Update documentation", completed: true },
			],
			content: "Updated todo list",
		}),
	} satisfies ClineMessageData,

	browser_action_launch: {
		type: "ask",
		ask: "browser_action_launch",
		text: JSON.stringify({ action: "navigate" }),
	} satisfies ClineMessageData,

	mcp_use_tool: {
		type: "ask",
		ask: "use_mcp_server",
		text: JSON.stringify({
			type: "use_mcp_tool",
			serverName: "filesystem",
			toolName: "read_file",
			arguments: '{"path": "/example"}',
		}),
	} satisfies ClineMessageData,

	mcp_access_resource: {
		type: "ask",
		ask: "use_mcp_server",
		text: JSON.stringify({
			type: "access_mcp_resource",
			serverName: "filesystem",
			uri: "file:///path/to/file",
		}),
	} satisfies ClineMessageData,

	completion_result: {
		type: "ask",
		ask: "completion_result",
		text: "Task completed successfully! I've created a new React component with proper TypeScript typing and error handling.",
	} satisfies ClineMessageData,

	api_req_failed: {
		type: "ask",
		ask: "api_req_failed",
		text: "API request failed: Connection timeout",
	} satisfies ClineMessageData,

	resume_task: {
		type: "ask",
		ask: "resume_task",
		text: "Resume previous task?",
	} satisfies ClineMessageData,

	resume_completed_task: {
		type: "ask",
		ask: "resume_completed_task",
		text: "Task was already completed. Start new task?",
	} satisfies ClineMessageData,

	mistake_limit_reached: {
		type: "ask",
		ask: "mistake_limit_reached",
		text: "Mistake limit reached. Too many errors encountered.",
	} satisfies ClineMessageData,

	auto_approval_max_reached: {
		type: "ask",
		ask: "auto_approval_max_req_reached",
		text: JSON.stringify({ count: 10, limit: 10 }),
	} satisfies ClineMessageData,

	payment_required: {
		type: "ask",
		ask: "payment_required_prompt",
		text: JSON.stringify({ message: "Low credit warning", credits: 0.5 }),
	} satisfies ClineMessageData,

	invalid_model: {
		type: "ask",
		ask: "invalid_model",
		text: JSON.stringify({
			model: "gpt-3.5-turbo",
			message: "Model gpt-3.5-turbo is not available",
		}),
	} satisfies ClineMessageData,

	report_bug: {
		type: "ask",
		ask: "report_bug",
		text: JSON.stringify({
			title: "Bug Report",
			body: "Description of the bug",
			labels: ["bug"],
		}),
	} satisfies ClineMessageData,

	condense: {
		type: "ask",
		ask: "condense",
		text: "Condensed conversation context",
	} satisfies ClineMessageData,
} as const

// ============================================================================
// SAY MESSAGE PRESETS
// ============================================================================

export const SAY_PRESETS = {
	text: {
		type: "say",
		say: "text",
		text: "I'll help you with that task.",
	} satisfies ClineMessageData,

	reasoning: {
		type: "say",
		say: "reasoning",
		reasoning: "First, I need to understand the current state of the project...",
	} satisfies ClineMessageData,

	error: {
		type: "say",
		say: "error",
		text: "An error occurred while processing the request.",
	} satisfies ClineMessageData,

	api_req_started: {
		type: "say",
		say: "api_req_started",
		text: JSON.stringify({ request: "chat" }),
	} satisfies ClineMessageData,

	api_req_finished: {
		type: "say",
		say: "api_req_finished",
		text: JSON.stringify({ tokensIn: 1500, tokensOut: 300, cost: 0.05 }),
	} satisfies ClineMessageData,

	command_output: {
		type: "say",
		say: "command_output",
		text: "Installation complete.\n\nadded 42 packages in 3s",
	} satisfies ClineMessageData,

	browser_action: {
		type: "say",
		say: "browser_action",
		text: "Navigating to https://example.com",
	} satisfies ClineMessageData,

	browser_action_result: {
		type: "say",
		say: "browser_action_result",
		text: JSON.stringify({ success: true, url: "https://example.com" }),
		images: [
			"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
		],
	} satisfies ClineMessageData,

	mcp_server_request_started: {
		type: "say",
		say: "mcp_server_request_started",
		text: JSON.stringify({ serverName: "filesystem", toolName: "read_file" }),
	} satisfies ClineMessageData,

	mcp_server_response: {
		type: "say",
		say: "mcp_server_response",
		text: JSON.stringify({ result: "File contents here" }),
	} satisfies ClineMessageData,

	checkpoint_saved: {
		type: "say",
		say: "checkpoint_saved",
		text: "Checkpoint saved successfully",
	} satisfies ClineMessageData,

	condense_context: {
		type: "say",
		say: "condense_context",
		contextCondense: {
			cost: 0.02,
			prevContextTokens: 5000,
			newContextTokens: 2000,
			summary: "Condensed conversation about React component development",
		},
	} satisfies ClineMessageData,

	codebase_search_result: {
		type: "say",
		say: "codebase_search_result",
		text: JSON.stringify({
			results: [
				{ file: "src/auth/login.ts", score: 0.95 },
				{ file: "src/auth/register.ts", score: 0.87 },
			],
		}),
	} satisfies ClineMessageData,
} as const

// ============================================================================
// PUBLIC API
// ============================================================================

export type AskPresetKey = keyof typeof ASK_PRESETS
export type SayPresetKey = keyof typeof SAY_PRESETS
export type PresetKey = AskPresetKey | SayPresetKey

/**
 * Create a ClineMessage from a preset key with optional overrides and timestamp offset
 */
export function createMessage(
	preset: PresetKey,
	overrides: Partial<ClineMessageData> = {},
	tsOffset: number = 0,
): ClineMessage {
	const presetData = (ASK_PRESETS[preset as AskPresetKey] || SAY_PRESETS[preset as SayPresetKey]) as ClineMessageData

	return {
		...presetData,
		...overrides,
		ts: BASE_TIMESTAMP + tsOffset,
	}
}
