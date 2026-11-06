export const opaque = [
  { id: "semantic_search", file: "kilocode/tool/semantic-search.ts" },
  { id: "lsp", file: "tool/lsp.ts" },
  // MCP resources are delegated MCP authority, as MCP tool calls are.
  { id: "list_mcp_resources", file: "tool/plugin/mcp-resource.ts" },
  { id: "read_mcp_resource", file: "tool/plugin/mcp-resource.ts" },
] as const

export const host = [
  { id: "notebook_execute", file: "kilocode/tool/notebook-host.ts" },
  { id: "background_process", file: "kilocode/tool/background-process.ts" },
] as const

/**
 * Tools that ship with the Kilo host and run inside the session's sandbox profile. A tool outside this list (an MCP
 * tool, a config or package plugin tool) is delegated authority: it runs only while the network is unrestricted.
 */
export const builtin = [
  "shell",
  "read",
  "write",
  "edit",
  "patch",
  "glob",
  "grep",
  "webfetch",
  "websearch",
  "question",
  "todowrite",
  "skill",
  "subagent",
  "goal",
  "review",
  "experimental_image_generate",
  "schedule",
  "schedule_create",
  "schedule_list",
  "schedule_pause",
  "schedule_resume",
  "schedule_delete",
  "artifact_create",
  "artifact_read",
  "artifact_update",
  "artifact_delete",
  "opencode",
  "session_rename",
  "session_move",
  "worktree_create",
  "worktree_list",
  "worktree_remove",
  "models",
  "agent_manager",
  "agent_manager_models",
  ...opaque.map((item) => item.id),
  ...host.map((item) => item.id),
] as const
