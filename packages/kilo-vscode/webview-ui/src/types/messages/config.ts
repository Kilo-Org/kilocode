import type { PermissionConfig } from "./permissions"
import type { AgentConfig } from "./agents"
import type { ProviderConfig } from "./providers"

export interface McpConfig {
  type?: "local" | "remote"
  command?: string[] | string
  args?: string[]
  env?: Record<string, string>
  environment?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  enabled?: boolean
}

export interface CommandConfig {
  template: string
  description?: string
  agent?: string
  model?: string
}

export interface SkillsConfig {
  paths?: string[]
  urls?: string[]
}

export interface CompactionConfig {
  auto?: boolean
  prune?: boolean
}

export interface WatcherConfig {
  ignore?: string[]
}

export interface ExperimentalConfig {
  disable_paste_summary?: boolean
  batch_tool?: boolean
  codebase_search?: boolean
  primary_tools?: string[]
  continue_loop_on_deny?: boolean
  mcp_timeout?: number
}

export interface CommitMessageConfig {
  prompt?: string
}

export interface BrowserSettings {
  enabled: boolean
  useSystemChrome: boolean
  headless: boolean
}

export interface Config {
  permission?: PermissionConfig
  model?: string | null
  small_model?: string | null
  default_agent?: string
  agent?: Record<string, AgentConfig>
  provider?: Record<string, ProviderConfig>
  disabled_providers?: string[]
  enabled_providers?: string[]
  mcp?: Record<string, McpConfig>
  command?: Record<string, CommandConfig>
  instructions?: string[]
  skills?: SkillsConfig
  snapshot?: boolean
  remote_control?: boolean
  share?: "manual" | "auto" | "disabled"
  username?: string
  watcher?: WatcherConfig
  formatter?: false | Record<string, unknown>
  lsp?: false | Record<string, unknown>
  compaction?: CompactionConfig
  commit_message?: CommitMessageConfig
  tools?: Record<string, boolean>
  layout?: "auto" | "stretch"
  experimental?: ExperimentalConfig
}
