import { NavSection } from "../types"

export const ToolsNav: NavSection[] = [
	{
		title: "Tools",
		links: [{ href: "/automate/tools", children: "Overview" }],
	},
	{
		title: "Read Tools",
		links: [
			{ href: "/automate/tools/read-file", children: "read_file" },
			{ href: "/automate/tools/search-files", children: "search_files" },
			{ href: "/automate/tools/list-files", children: "list_files" },
			{ href: "/automate/tools/list-code-definition-names", children: "list_code_definition_names" },
			{ href: "/automate/tools/codebase-search", children: "codebase_search" },
		],
	},
	{
		title: "Edit Tools",
		links: [
			{ href: "/automate/tools/apply-diff", children: "apply_diff" },
			{ href: "/automate/tools/delete-file", children: "delete_file" },
			{ href: "/automate/tools/write-to-file", children: "write_to_file" },
		],
	},
	{
		title: "Browser Tools",
		links: [{ href: "/automate/tools/browser-action", children: "browser_action" }],
	},
	{
		title: "Command Tools",
		links: [{ href: "/automate/tools/execute-command", children: "execute_command" }],
	},
	{
		title: "MCP Tools",
		links: [
			{ href: "/automate/tools/use-mcp-tool", children: "use_mcp_tool" },
			{ href: "/automate/tools/access-mcp-resource", children: "access_mcp_resource" },
		],
	},
	{
		title: "Workflow Tools",
		links: [
			{ href: "/automate/tools/switch-mode", children: "switch_mode" },
			{ href: "/automate/tools/new-task", children: "new_task" },
			{ href: "/automate/tools/ask-followup-question", children: "ask_followup_question" },
			{ href: "/automate/tools/attempt-completion", children: "attempt_completion" },
			{ href: "/automate/tools/update-todo-list", children: "update_todo_list" },
		],
	},
]
