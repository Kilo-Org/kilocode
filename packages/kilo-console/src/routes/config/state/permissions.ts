import { createMemo, createSignal } from "solid-js"
import type { Snapshot } from "../../../client"
import { useConfig } from "../../../context/config"
import { clean, type PermissionMap } from "../../../shared/utils"

type Resolved = Snapshot["overlay"]["collections"][string][number]
export type PermissionAction = "ask" | "allow" | "deny"
export type PermissionTool = "external_directory" | "bash" | "read" | "edit"
export type PermissionDef = {
  id: string
  title: string
  description: string
}
export type RuleDef = PermissionDef & {
  id: PermissionTool
  noun: string
  placeholder: string
}

export type PermissionRule = {
  tool: string
  pattern: string
  action: PermissionAction
  source: string
  inherited: boolean
  overridden: boolean
  path: string[]
}

export type PermissionGroup = {
  id: PermissionTool
  title: string
  description: string
  noun: string
  placeholder: string
  action: PermissionAction
  source: string
  inherited: boolean
  overridden: boolean
  rules: PermissionRule[]
}

export type PermissionDefault = PermissionDef & {
  action: PermissionAction
  source: string
  inherited: boolean
  overridden: boolean
}

export const actions: Array<{ value: PermissionAction; label: string }> = [
  { value: "ask", label: "Ask" },
  { value: "allow", label: "Allow" },
  { value: "deny", label: "Deny" },
]

export const ruleDefs: RuleDef[] = [
  {
    id: "external_directory",
    title: "External Directory",
    description: "Access files outside the project directory.",
    noun: "path",
    placeholder: "e.g. ~/Downloads/**",
  },
  {
    id: "bash",
    title: "Bash",
    description: "Run shell commands.",
    noun: "command",
    placeholder: "e.g. git status or npm *",
  },
  {
    id: "read",
    title: "Read",
    description: "Read files by matching file paths.",
    noun: "path",
    placeholder: "e.g. **/*.env",
  },
  {
    id: "edit",
    title: "Edit",
    description: "Modify files, including writes, patches, and multi-edits.",
    noun: "path",
    placeholder: "e.g. src/**/*.ts",
  },
]

export const defaults: PermissionDef[] = [
  { id: "glob", title: "Glob", description: "Match files using glob patterns." },
  { id: "grep", title: "Grep", description: "Search file contents using regular expressions." },
  { id: "list", title: "List", description: "List files within a directory." },
  { id: "task", title: "Task", description: "Launch sub-agents." },
  { id: "skill", title: "Skill", description: "Load a skill by name." },
  { id: "lsp", title: "LSP", description: "Run language server queries." },
  { id: "todowrite", title: "Todo Write", description: "Update the todo list." },
  { id: "question", title: "Question", description: "Ask the user a question." },
  { id: "webfetch", title: "Web Fetch", description: "Fetch content from a URL." },
  { id: "websearch", title: "Web Search", description: "Search the web." },
  { id: "doom_loop", title: "Doom Loop", description: "Detect repeated tool calls with identical input." },
  { id: "agent_manager", title: "Agent Manager", description: "Manage Agent Manager operations." },
]

export const defs = [...ruleDefs, ...defaults]
const ruleIDs = new Set<string>(ruleDefs.map((item) => item.id))

const known = new Set<string>(defs.map((item) => item.id))

function act(input: unknown, fallback: PermissionAction = "ask"): PermissionAction {
  if (input === "ask" || input === "allow" || input === "deny") return input
  return fallback
}

function record(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) return input as Record<string, unknown>
  return {}
}

function cfg(data: Snapshot) {
  return record(data.effective.permission)
}

function meta(data: Snapshot, tool: string) {
  return data.overlay.collections.permission?.find((item) => item.key === tool)
}

function raw(data: Snapshot, tool: string) {
  if (typeof data.effective.permission === "string") return data.effective.permission
  return cfg(data)[tool]
}

function fallback(data: Snapshot) {
  return act(data.effective.permission)
}

function paths(item: Resolved | undefined, pattern: string) {
  if (!item) return ["permission", pattern]
  if (pattern === "*" && typeof item.value === "string") return item.path
  return [...item.path, pattern]
}

function row(tool: string, pattern: string, action: unknown, item?: Resolved): PermissionRule | undefined {
  if (action !== "ask" && action !== "allow" && action !== "deny") return undefined
  return {
    tool,
    pattern,
    action,
    source: item?.source ?? "default",
    inherited: item?.inherited ?? false,
    overridden: item?.overridden ?? false,
    path: item ? paths(item, pattern) : ["permission", tool, pattern],
  }
}

function entries(item: Resolved): PermissionRule[] {
  const rule = item.value
  if (rule && typeof rule === "object" && !Array.isArray(rule)) {
    return Object.entries(rule as Record<string, unknown>).flatMap(
      ([glob, value]) => row(item.key, glob, value, item) ?? [],
    )
  }
  const value = row(item.key, "*", rule, item)
  return value ? [value] : []
}

function listed(tool: string, value: unknown, item?: Resolved) {
  const obj = record(value)
  if (Object.keys(obj).length) {
    return Object.entries(obj).flatMap(([pattern, action]) => row(tool, pattern, action, item) ?? [])
  }
  const itemRow = row(tool, "*", value, item)
  return itemRow ? [itemRow] : []
}

function setting(data: Snapshot, def: PermissionDef): PermissionDefault {
  const item = meta(data, def.id)
  const value = raw(data, def.id)
  const obj = record(value)
  const base = fallback(data)
  return {
    ...def,
    action: act(typeof value === "string" ? value : obj["*"], base),
    source: item?.source ?? "default",
    inherited: item?.inherited ?? false,
    overridden: item?.overridden ?? false,
  }
}

function group(data: Snapshot, def: RuleDef): PermissionGroup {
  const item = meta(data, def.id)
  const value = raw(data, def.id)
  const obj = record(value)
  const base = fallback(data)
  return {
    ...def,
    action: act(typeof value === "string" ? value : obj["*"], base),
    source: item?.source ?? "default",
    inherited: item?.inherited ?? false,
    overridden: item?.overridden ?? false,
    rules: Object.entries(obj)
      .filter(([pattern]) => pattern !== "*")
      .flatMap(([pattern, action]) => row(def.id, pattern, action, item) ?? []),
  }
}

export function usePermissionSettings() {
  const ctx = useConfig()
  const snap = () => ctx.data()
  const [mode, setMode] = createSignal<"closed" | "rule">("closed")
  const [kind, setKind] = createSignal<PermissionTool>("external_directory")
  const [pattern, setPattern] = createSignal("")
  const [action, setAction] = createSignal<PermissionAction>("ask")

  const rules = createMemo(() => (snap()?.overlay.collections.permission ?? []).flatMap(entries))
  const groups = createMemo(() => {
    const data = snap()
    if (!data) return []
    return ruleDefs.map((def) => group(data, def))
  })
  const settings = createMemo(() => {
    const data = snap()
    if (!data) return []
    return defaults.map((def) => setting(data, def))
  })
  const other = createMemo(() => {
    const data = snap()
    if (!data) return []
    return Object.entries(cfg(data))
      .filter(([tool]) => !known.has(tool))
      .flatMap(([tool, value]) => listed(tool, value, meta(data, tool)))
      .sort((a, b) => a.tool.localeCompare(b.tool) || a.pattern.localeCompare(b.pattern))
  })
  const selected = createMemo(() => ruleDefs.find((def) => def.id === kind()) ?? ruleDefs[0])

  function open(tool: PermissionTool) {
    setKind(tool)
    setPattern("")
    setAction("ask")
    setMode("rule")
  }

  function close() {
    setMode("closed")
  }

  function add() {
    const data = snap()
    const glob = clean(pattern())
    if (!data || !glob) {
      ctx.fail(`Enter a ${selected().noun} pattern before saving.`)
      return
    }
    const permission = { [kind()]: { [glob]: action() } } as PermissionMap
    ctx.save({ permission })
    close()
  }

  function setDefault(tool: string, action: PermissionAction) {
    const permission = ruleIDs.has(tool)
      ? ({ [tool]: { "*": action } } as PermissionMap)
      : ({ [tool]: action } as PermissionMap)
    ctx.save({ permission })
  }

  function remove(rule: PermissionRule) {
    ctx.unset([rule.path])
  }

  return {
    ctx,
    mode,
    kind,
    pattern,
    setPattern,
    action,
    setAction,
    rules,
    groups,
    settings,
    other,
    selected,
    open,
    close,
    add,
    setDefault,
    remove,
  }
}
