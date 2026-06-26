import type { PermissionConfig, PermissionRuleItem } from "./permissions"

// Skill info from CLI backend
export interface SkillInfo {
  name: string
  description: string
  location: string
}

// Slash command info from CLI backend
export interface SlashCommandInfo {
  name: string
  description?: string
  source?: "command" | "mcp" | "skill"
  hints: string[]
}

// Agent/mode info from CLI backend
export interface AgentInfo {
  name: string
  displayName?: string
  description?: string
  mode: "subagent" | "primary" | "all"
  native?: boolean
  hidden?: boolean
  deprecated?: boolean
  color?: string
  permission?: PermissionRuleItem[]
}

export interface AgentRequirementSkill {
  name: string
  marketplace: string
  status: "ready" | "missing" | "error"
  message?: string
}

export interface AgentRequirementVSCodeExtension {
  name: string
  id: string
  status: "ready" | "missing" | "error"
  message?: string
}

export interface AgentRequirementResult {
  agent: string
  directory: string
  enabled: boolean
  state: "disabled" | "ready" | "blocked" | "error"
  skills: AgentRequirementSkill[]
  vscode_extensions: AgentRequirementVSCodeExtension[]
  mcps: string[]
  error?: {
    code: "unknown_agent" | "malformed_declaration" | "discovery_failed" | "scope_mismatch" | "request_failed"
    message: string
  }
}

export interface AgentRequirementInstall {
  marketplace: string
  status: "installing" | "succeeded" | "failed"
  code?: "skill_not_found" | "item_not_skill" | "installation_failed" | "unavailable" | "marketplace_unavailable"
  error?: string
}

export interface AgentConfig {
  model?: string | null
  variant?: string | null
  prompt?: string | null
  description?: string | null
  mode?: "subagent" | "primary" | "all"
  hidden?: boolean
  disable?: boolean
  temperature?: number | null
  top_p?: number | null
  steps?: number | null
  requirements?: {
    skills?: string[]
    vscode_extensions?: Array<{
      name: string
      id: string
    }>
    mcps?: string[]
  }
  permission?: PermissionConfig
}
