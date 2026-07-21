export const opaque = [
  {
    id: "codebase_search",
    file: "tool/warpgrep.ts",
    client: {
      name: "ad hoc network client",
      count: 1,
      reason: "opaque SDK traffic is denied by the common executeTool network boundary",
    },
  },
  { id: "semantic_search", file: "kilocode/tool/semantic-search.ts" },
  { id: "lsp", file: "tool/lsp.ts" },
] as const

export const host = [
  { id: "interactive_terminal", file: "kilocode/tool/interactive-terminal.ts" },
  { id: "notebook_execute", file: "kilocode/tool/notebook-host.ts" },
  { id: "background_process", file: "kilocode/tool/background-process.ts" },
] as const
