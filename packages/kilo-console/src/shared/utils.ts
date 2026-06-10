import type { Provider, ToolListItem } from "@kilocode/sdk/v2/client"
import type { Snapshot } from "../client"

export type McpMap = NonNullable<Snapshot["effective"]["mcp"]>
export type FormatterMap = Exclude<NonNullable<Snapshot["effective"]["formatter"]>, boolean>
export type LspMap = Exclude<NonNullable<Snapshot["effective"]["lsp"]>, boolean>
export type PermissionMap = Exclude<NonNullable<Snapshot["effective"]["permission"]>, string | null>
export type ToolItem = { id: string; detail: ToolListItem | undefined }

const labels: Record<string, string> = {
  apply_patch: "Apply Patch",
  bash: "Bash",
  edit: "Edit File",
  glob: "Find Files",
  grep: "Search Content",
  lsp: "Language Server",
  question: "Ask User",
  read: "Read File",
  recall: "Local Recall",
  skill: "Load Skill",
  task: "Subagent Task",
  todowrite: "Todo List",
  webfetch: "Fetch URL",
  websearch: "Web Search",
  write: "Write File",
}

const copy: Record<string, string[]> = {
  apply_patch: [
    "Apply structured patches to add, update, move, or delete files.",
    "Keeps edits explicit and easy to review.",
  ],
  bash: [
    "Run shell commands in the current workspace.",
    "Supports timeouts, working directories, and command descriptions.",
  ],
  edit: ["Replace exact text inside an existing file.", "Can update one match or all matches when needed."],
  glob: ["Find files by path patterns.", "Useful for locating files before reading or editing them."],
  grep: [
    "Search file contents with regular expressions.",
    "Can limit results to a file pattern such as TypeScript or CSS files.",
  ],
  lsp: [
    "Use language-server features for code navigation.",
    "Supports operations such as definitions, references, and diagnostics.",
  ],
  question: ["Ask the user for a decision during execution.", "Supports single-choice and multi-choice prompts."],
  read: [
    "Read files, directories, images, and PDFs from the workspace.",
    "Supports line offsets and limits for large files.",
  ],
  recall: [
    "Search and read previous project conversations.",
    "Useful for recovering prior decisions or implementation context.",
  ],
  skill: [
    "Load task-specific instructions and workflows.",
    "Applies specialized repo guidance when a matching skill exists.",
  ],
  task: [
    "Delegate focused exploration or implementation work to a subagent.",
    "Useful for parallel codebase research and complex subtasks.",
  ],
  todowrite: [
    "Track multi-step implementation work.",
    "Shows progress with pending, in-progress, and completed states.",
  ],
  webfetch: ["Fetch and convert web pages for analysis.", "Supports markdown, text, and HTML output formats."],
  websearch: ["Search the web for external information.", "Supports fast, automatic, and deep search modes."],
  write: ["Create or overwrite files with complete contents.", "Best for new files or full-file replacements."],
}

const acronyms = new Set(["api", "html", "id", "json", "lsp", "mcp", "pdf", "url"])

export function clean(input: string) {
  return input.trim()
}

export function text(input: unknown): string {
  if (input === undefined || input === null || input === "") return "Not set"
  if (typeof input === "string") return input
  if (typeof input === "number" || typeof input === "boolean") return String(input)
  return JSON.stringify(input) ?? "Unserializable value"
}

export function sorted(input: Iterable<string>) {
  return [...input].sort((a, b) => a.localeCompare(b))
}

export function words(input: string) {
  return input
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
}

export function friendly(input: string) {
  return input
    .trim()
    .split(/[\s._/-]+/)
    .filter(Boolean)
    .map((part) => {
      if (/^[A-Z0-9]+$/.test(part) && part.length <= 4) return part
      return `${part[0]?.toUpperCase() ?? ""}${part.slice(1).toLowerCase()}`
    })
    .join(" ")
}

function word(input: string) {
  const lower = input.toLowerCase()
  if (acronyms.has(lower)) return lower.toUpperCase()
  return input.charAt(0).toUpperCase() + input.slice(1)
}

function clip(input: string) {
  if (input.length <= 180) return input
  return `${input.slice(0, 177)}...`
}

function summary(input: string) {
  const value = input
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*`#>_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  const parts = value
    .split(/(?:\.|\?|!)\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2)
  if (parts.length) return parts.map(clip)
  return value ? [clip(value)] : []
}

export function toolName(id: string) {
  const known = labels[id]
  if (known) return known
  const value = id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._:/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!value) return id
  return value.split(" ").map(word).join(" ")
}

export function toolCapabilities(item: ToolItem) {
  const known = copy[item.id]
  if (known) return known
  const desc = item.detail?.description.trim()
  if (desc) return summary(desc)
  return ["No capability description is available for this tool."]
}

export function csv(input: string) {
  return input
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean)
}

export function size(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return 0
  return Object.keys(input).length
}

export function catalog(data: Snapshot) {
  return data.providers.all.flatMap((provider) =>
    Object.values(provider.models).map((model) => ({
      id: `${provider.id}/${model.id}`,
      provider,
      model,
    })),
  )
}

export function providerState(provider: Provider, data: Snapshot) {
  if (data.effective.disabled_providers?.includes(provider.id)) return "disabled"
  if (data.providers.failed.includes(provider.id)) return "failed"
  if (data.providers.connected.includes(provider.id)) return "connected"
  if (provider.source === "env" || provider.source === "config" || provider.source === "custom") return "configured"
  return "available"
}

export function fmtRecord(input: Snapshot["effective"]["formatter"]): FormatterMap {
  if (input && typeof input === "object") return input
  return {}
}

export function lspRecord(input: Snapshot["effective"]["lsp"]): LspMap {
  if (input && typeof input === "object") return input
  return {}
}

export function dupBindings(data: Snapshot, key: string, value: string) {
  if (!value) return []
  return Object.entries(data.tui.keybinds ?? {})
    .filter(([name, binding]) => name !== key && binding === value)
    .map(([name]) => name)
}

export function errMsg(input: unknown) {
  if (input instanceof Error) return input.message
  if (typeof input === "string") return input
  return text(input)
}

export function toScope(input: string | null): "global" | "project" {
  if (input === "global") return "global"
  return "project"
}

export function toMode(input: string): "primary" | "subagent" | "all" {
  if (input === "subagent") return "subagent"
  if (input === "all") return "all"
  return "primary"
}

export function toAction(input: string): "ask" | "allow" | "deny" {
  if (input === "allow") return "allow"
  if (input === "deny") return "deny"
  return "ask"
}
