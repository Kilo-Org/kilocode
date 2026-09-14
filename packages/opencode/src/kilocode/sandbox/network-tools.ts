export const opaque = [
  { id: "semantic_search", file: "kilocode/tool/semantic-search.ts" },
  { id: "lsp", file: "tool/lsp.ts" },
] as const

export const host = [
  { id: "notebook_execute", file: "kilocode/tool/notebook-host.ts" },
  { id: "background_process", file: "kilocode/tool/background-process.ts" },
] as const
