/**
 * Build a human-readable description for a permission request's patterns.
 *
 * Returns null when there are no meaningful patterns to display (e.g. only "*").
 * For a single pattern: "Read src/app.ts"
 * For multiple patterns: { title: "Read:", paths: ["src/app.ts", "src/index.ts"] }
 */

const TOOL_LABELS: Record<string, string> = {
  read: "Read",
  edit: "Edit",
  write: "Write",
  patch: "Patch",
  multiedit: "Edit",
  glob: "Search",
  grep: "Search",
  list: "List",
  external_directory: "External Directory",
  webfetch: "Fetch",
  websearch: "Search",
  task: "Task",
  skill: "Skill",
  lsp: "LSP",
}

export type PatternDescription = { kind: "single"; text: string } | { kind: "multi"; title: string; paths: string[] }

export function describePatterns(tool: string, patterns: string[]): PatternDescription | null {
  const filtered = patterns.filter((p) => p !== "*")
  if (filtered.length === 0) return null

  const label = TOOL_LABELS[tool] ?? tool
  if (filtered.length === 1) return { kind: "single", text: `${label} ${filtered[0]}` }
  return { kind: "multi", title: `${label}:`, paths: filtered }
}
