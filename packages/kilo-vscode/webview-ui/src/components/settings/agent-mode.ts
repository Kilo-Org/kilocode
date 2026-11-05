import type { AgentConfig, AgentInfo } from "../../types/messages"

export type AgentMode = AgentInfo["mode"]

export interface ModeOption {
  value: AgentMode
  labelKey: string
}

export const MODE_OPTIONS: ModeOption[] = [
  { value: "primary", labelKey: "settings.agentBehaviour.mode.primary" },
  { value: "subagent", labelKey: "settings.agentBehaviour.mode.subagent" },
  { value: "all", labelKey: "settings.agentBehaviour.mode.all" },
]

// The CLI renames the legacy "build" agent to the built-in "code" agent.
const ALIASES = new Set(["build"])

/**
 * Mode shown for an agent: the configured (possibly unsaved draft) value first,
 * then the mode reported by the CLI. Config-only custom agents default to "all"
 * in the CLI, so that is also the fallback here.
 */
export function agentMode(cfg: AgentConfig, agent?: AgentInfo): AgentMode {
  return cfg.mode ?? agent?.mode ?? "all"
}

/**
 * Whether the mode can be edited. Built-in agents keep their mode, but a built-in
 * agent is missing from the CLI list while it is disabled, so an agent without CLI
 * info only counts as custom when its config sets a mode — which every agent
 * created from the settings does.
 */
export function editable(name: string, cfg: AgentConfig, agent?: AgentInfo): boolean {
  if (agent) return !agent.native
  return cfg.mode !== undefined && !ALIASES.has(name)
}

export type Pin = "project" | "default"

/**
 * Why an agent cannot become a subagent only: the CLI rejects a subagent as
 * `default_agent`. `draft` is the effective, possibly unsaved default. `project`
 * is the project-level default, which takes precedence and which the settings
 * default-agent picker cannot change because it writes the global config.
 */
export function pin(
  name: string,
  draft: string | null | undefined,
  project: string | null | undefined,
): Pin | undefined {
  if (project === name) return "project"
  if (draft === name) return "default"
  return undefined
}

/** Mode choices for an agent. A pinned agent keeps "subagent" only if it already has it, so its current mode stays visible. */
export function modeOptions(pinned: boolean, mode: AgentMode): ModeOption[] {
  if (!pinned || mode === "subagent") return MODE_OPTIONS
  return MODE_OPTIONS.filter((o) => o.value !== "subagent")
}

/** Agents that can be picked as `default_agent`, taking unsaved mode changes into account. */
export function candidates(agents: AgentInfo[], cfg: Record<string, AgentConfig> | undefined): AgentInfo[] {
  return agents.filter((a) => agentMode(cfg?.[a.name] ?? {}, a) !== "subagent")
}
