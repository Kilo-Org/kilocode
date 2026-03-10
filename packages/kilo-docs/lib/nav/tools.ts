import { NavSection } from "../types"

export const ToolsNav: NavSection[] = [
  {
    title: "Tools",
    links: [{ href: "/automate/tools", children: "Overview", platform: "classic" }],
  },
  {
    title: "Read Tools",
    links: [
      { href: "/automate/tools/read-file", children: "read_file", platform: "classic" },
      { href: "/automate/tools/search-files", children: "search_files", platform: "classic" },
      { href: "/automate/tools/list-files", children: "list_files", platform: "classic" },
      {
        href: "/automate/tools/list-code-definition-names",
        children: "list_code_definition_names",
        platform: "classic",
      },
      { href: "/automate/tools/codebase-search", children: "codebase_search", platform: "classic" },
    ],
  },
  {
    title: "Edit Tools",
    links: [
      { href: "/automate/tools/apply-diff", children: "apply_diff", platform: "classic" },
      { href: "/automate/tools/delete-file", children: "delete_file", platform: "classic" },
      { href: "/automate/tools/write-to-file", children: "write_to_file", platform: "classic" },
    ],
  },
  {
    title: "Browser Tools",
    links: [{ href: "/automate/tools/browser-action", children: "browser_action", platform: "classic" }],
  },
  {
    title: "Command Tools",
    links: [{ href: "/automate/tools/execute-command", children: "execute_command", platform: "classic" }],
  },
  {
    title: "MCP Tools",
    links: [
      { href: "/automate/tools/use-mcp-tool", children: "use_mcp_tool", platform: "classic" },
      { href: "/automate/tools/access-mcp-resource", children: "access_mcp_resource", platform: "classic" },
    ],
  },
  {
    title: "Workflow Tools",
    links: [
      { href: "/automate/tools/switch-mode", children: "switch_mode", platform: "classic" },
      { href: "/automate/tools/new-task", children: "new_task", platform: "classic" },
      { href: "/automate/tools/ask-followup-question", children: "ask_followup_question", platform: "classic" },
      { href: "/automate/tools/attempt-completion", children: "attempt_completion", platform: "classic" },
      { href: "/automate/tools/update-todo-list", children: "update_todo_list", platform: "classic" },
    ],
  },
]
