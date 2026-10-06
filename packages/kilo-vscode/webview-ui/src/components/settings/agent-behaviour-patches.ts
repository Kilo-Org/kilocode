import type { AgentInfo, Config, ConfigCollections, McpConfig, McpStatusEntry } from "../../types/messages"

export function removable(agent: AgentInfo | undefined): boolean {
  return !!agent && !agent.native && agent.source !== "organization"
}

export function mcpEnabledPatch(name: string, enabled: boolean): Partial<Config> {
  return {
    mcp: {
      [name]: {
        enabled,
      },
    },
  }
}

export function mcpConfigScope(name: string, collections: ConfigCollections): "global" | "project" | undefined {
  const source = collections.mcp?.find((entry) => entry.key === name)?.source
  return source === "project" || source === "global" ? source : undefined
}

export function mcpEditPatch(name: string, current: McpConfig, partial: Partial<McpConfig>): Partial<Config> {
  return { mcp: { [name]: { ...current, ...partial } } }
}

export function pruneMcpExpanded(state: Record<string, boolean>, names: Set<string>): Record<string, boolean> {
  const stale = Object.keys(state).filter((name) => !names.has(name))
  if (stale.length === 0) return state
  const next = { ...state }
  for (const name of stale) delete next[name]
  return next
}

export function mcpStatusDetailVisible(status: McpStatusEntry["status"] | undefined): boolean {
  return status !== "needs_auth"
}

export function mcpStatusError(status: McpStatusEntry | undefined): string | undefined {
  if (status?.status === "failed" || status?.status === "needs_client_registration") return status.error
  return undefined
}

export function selectedDefaultAgentValue(value: string): string | null {
  return value || null
}

export function selectedAgentTextOverrideValue(value: string): string | null {
  return value === "" ? null : value
}

export function selectedAgentNumberOverrideValue(
  value: string,
  parse: (value: string) => number,
): number | null | undefined {
  if (value.trim() === "") return null
  const parsed = parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

export function shouldClearDefaultAgentWhenAgentBecomesUnavailable(
  nextValue: boolean,
  currentDefaultAgent: string | null | undefined,
  agentName: string,
): boolean {
  return nextValue && currentDefaultAgent === agentName
}
