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

export interface AgentConfig {
  model?: string | null
  prompt?: string
  description?: string
  mode?: "subagent" | "primary" | "all"
  hidden?: boolean
  disable?: boolean
  temperature?: number
  top_p?: number
  steps?: number
  permission?: PermissionConfig
}
