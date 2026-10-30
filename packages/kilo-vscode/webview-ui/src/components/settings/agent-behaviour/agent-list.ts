// Helpers for the Agents subtab: the agent list the tab shows, the v2 config paths each control writes, and the
// read-only permission projection. The list starts from `api.agent.list` and adds the config keys the server does
// not return, so a disabled mode stays visible, as on v1.
import type { AgentInfo, PermissionEffect, PermissionRule } from "@opencode/client"

// The agents the v2 core plugins register before user config. They have no config document behind them, so the tab
// shows them as built-in: the override layout, no export and no remove. Mirrors the built-in set in
// `kilo-plugin/src/agent/index.ts`.
export const BUILT_IN_AGENTS = new Set([
  "build",
  "code",
  "general",
  "plan",
  "ask",
  "debug",
  "orchestrator",
  "explore",
  "compaction",
  "title",
  "summary",
])

export function isBuiltInAgent(id: string) {
  return BUILT_IN_AGENTS.has(id)
}

export const agentPath = (id: string) => ["agents", id]
export const agentField = (id: string, ...rest: string[]) => ["agents", id, ...rest]

/** The agent's effective config from staged edits then the merged documents. */
export function agentConfig(value: (path: string[]) => unknown, id: string): Record<string, unknown> {
  const config: Record<string, unknown> = {}
  for (const key of ["mode", "description", "system", "model", "hidden", "disabled", "steps", "permissions"]) {
    const field = value(agentField(id, key))
    if (field !== undefined) config[key] = field
  }
  const temperature = value(agentField(id, "request", "body", "temperature"))
  const topP = value(agentField(id, "request", "body", "top_p"))
  if (temperature !== undefined || topP !== undefined)
    config.request = {
      body: { ...(temperature !== undefined ? { temperature } : {}), ...(topP !== undefined ? { top_p: topP } : {}) },
    }
  return config
}

export interface AgentRow {
  /** The config key and the `default_agent` value. */
  id: string
  /** The name the list shows. */
  label: string
  mode: AgentInfo["mode"]
  description?: string
  /** The agent's effective config. */
  config: Record<string, unknown>
  /** A built-in agent owns its base definition, so the edit view shows overrides only. */
  builtIn: boolean
  /** The agent is defined in a config file, so it can be removed and edited in full. */
  defined: boolean
  hidden: boolean
  disabled: boolean
  removable: boolean
}

/** The agents the tab lists: the visible server agents plus the config keys the server does not return. */
export function agentRows(
  agents: AgentInfo[],
  extraIds: string[],
  configOf: (id: string) => Record<string, unknown>,
  defined: (id: string) => boolean,
): AgentRow[] {
  const ids = agents.filter((agent) => !agent.hidden).map((agent) => agent.id)
  for (const id of extraIds) if (!ids.includes(id)) ids.push(id)
  return ids
    .sort()
    .map((id) => {
      const info = agents.find((agent) => agent.id === id)
      const config = configOf(id)
      const builtIn = isBuiltInAgent(id)
      const inConfig = defined(id)
      return {
        id,
        label: info?.name ?? id,
        mode: info?.mode ?? ((config.mode as AgentInfo["mode"]) ?? "primary"),
        description: info?.description ?? (config.description as string | undefined),
        config,
        builtIn,
        defined: inConfig,
        hidden: (config.hidden as boolean | undefined) ?? false,
        disabled: (config.disabled as boolean | undefined) ?? false,
        removable: inConfig && !builtIn,
      }
    })
}

/** The agents `default_agent` may name: the visible primary agents, as v1's `session.agents()`. */
export function primaryAgents(agents: AgentInfo[]): AgentInfo[] {
  return agents.filter((agent) => !agent.hidden && agent.mode !== "subagent")
}

export interface PermissionRow {
  tool: string
  pattern: string
  action: PermissionEffect
}

export function permissionRows(rules: PermissionRule[]): PermissionRow[] {
  return rules.map((rule) => ({ tool: rule.action, pattern: rule.resource, action: rule.effect }))
}

/** The effective action per tool for the wildcard pattern, the last rule winning. */
export function permissionSummary(rows: PermissionRow[]): [string, PermissionEffect][] {
  const tools = new Map<string, PermissionEffect>()
  for (const row of rows) if (row.pattern === "*") tools.set(row.tool, row.action)
  return [...tools.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}

/** A model selection as `ModelPicker` reads and writes it: a `provider/model#variant` string or the explicit object. */
export interface ModelSelection {
  providerID: string
  modelID: string
  variant?: string
}

export function parseModelSelection(value: unknown): ModelSelection | undefined {
  if (typeof value === "string") {
    const [ref, variant] = value.split("#")
    const separator = ref?.indexOf("/") ?? -1
    if (!ref || separator <= 0) return undefined
    return { providerID: ref.slice(0, separator), modelID: ref.slice(separator + 1), ...(variant ? { variant } : {}) }
  }
  if (typeof value === "object" && value !== null) {
    const item = value as Record<string, unknown>
    if (typeof item.providerID !== "string" || typeof item.model !== "string") return undefined
    return {
      providerID: item.providerID,
      modelID: item.model,
      ...(typeof item.variant === "string" ? { variant: item.variant } : {}),
    }
  }
  return undefined
}

export function modelSelection(value: ModelSelection | undefined): unknown {
  if (!value) return undefined
  return { providerID: value.providerID, model: value.modelID, ...(value.variant ? { variant: value.variant } : {}) }
}
