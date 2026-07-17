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
  model?: string | null
}

export interface AgentRequirementSkill {
  name: string
  status: "ready" | "missing" | "error"
  message?: string
}

export interface AgentRequirementMCP {
  name: string
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
  mcps: AgentRequirementMCP[]
  vscode_extensions: AgentRequirementVSCodeExtension[]
  error?: {
    code:
      | "unknown_agent"
      | "malformed_declaration"
      | "discovery_failed"
      | "mcp_status_failed"
      | "scope_mismatch"
      | "request_failed"
    message: string
  }
}

export interface AgentRequirements {
  skills?: string[]
  mcps?: string[]
  vscode_extensions?: Array<{ name: string; id: string }>
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
  requirements?: AgentRequirements
  permission?: PermissionConfig
}
