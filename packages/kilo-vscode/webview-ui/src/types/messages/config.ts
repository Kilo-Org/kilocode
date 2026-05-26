import type { PermissionConfig } from "./permissions"
import type { AgentConfig } from "./agents"
import type { ProviderConfig } from "./providers"

type SdkIndexingStatus = import("@kilocode/sdk/v2/client").IndexingStatus

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
  threshold_percent?: number | null
  prune?: boolean
}

export interface WatcherConfig {
  ignore?: string[]
}

export interface ExperimentalConfig {
  batch_tool?: boolean
  codebase_search?: boolean
  image_generation?: boolean
  image_generation_model?: string
  agent_requirements?: boolean
  native_notebook_tools?: boolean
  speech_to_text_model?: string
  primary_tools?: string[]
  continue_loop_on_deny?: boolean
  mcp_timeout?: number
  swe_pruner?: boolean
  swe_pruner_model?: string
}

export interface SandboxConfig {
  enabled?: boolean
  network?: "allow" | "deny"
  writable_paths?: string[]
  allowed_hosts?: string[]
}

export interface CommitMessageConfig {
  prompt?: string
}

export type IndexingProvider =
  | "kilo"
  | "openai"
  | "ollama"
  | "openai-compatible"
  | "gemini"
  | "mistral"
  | "vercel-ai-gateway"
  | "bedrock"
  | "openrouter"
  | "voyage"

export interface IndexingConfig {
  enabled?: boolean
  provider?: IndexingProvider
  model?: string | null
  dimension?: number | null
  vectorStore?: "lancedb" | "qdrant" | "valkey"
  kilo?: { apiKey?: string; baseUrl?: string; organizationId?: string }
  openai?: { apiKey?: string }
  ollama?: { baseUrl?: string }
  "openai-compatible"?: { baseUrl?: string; apiKey?: string }
  gemini?: { apiKey?: string }
  mistral?: { apiKey?: string }
  "vercel-ai-gateway"?: { apiKey?: string }
  bedrock?: { region?: string; profile?: string }
  openrouter?: { apiKey?: string; specificProvider?: string }
  voyage?: { apiKey?: string }
  qdrant?: { url?: string; apiKey?: string }
  lancedb?: { directory?: string }
  valkey?: { url?: string; password?: string }
  searchMinScore?: number
  searchMaxResults?: number
  embeddingBatchSize?: number
  scannerMaxBatchRetries?: number
}

export type KiloEmbeddingModel = {
  id: string
  name: string
  dimension: number
  scoreThreshold: number
  note?: string
}

export type KiloEmbeddingModelCatalog = {
  defaultModel: string
  models: KiloEmbeddingModel[]
  aliases: Record<string, string>
}

export type IndexingStatus = SdkIndexingStatus

export interface BrowserSettings {
  enabled: boolean
  useSystemChrome: boolean
  headless: boolean
}

export type TerminalCommandDisplay = "expanded" | "collapsed"
export type CodeEditDisplay = "expanded" | "collapsed"

export interface Config {
  permission?: PermissionConfig
  model?: string | null
  small_model?: string | null
  subagent_model?: string | null
  subagent_variant?: string | null
  subagent_variant_overrides?: Record<string, string | null> | null
  default_agent?: string | null
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
  terminal_command_display?: TerminalCommandDisplay
  code_edit_display?: CodeEditDisplay
  hide_prompt_training_models?: boolean
  share?: "manual" | "auto" | "disabled"
  username?: string
  watcher?: WatcherConfig
  formatter?: false | Record<string, unknown>
  lsp?: false | Record<string, unknown>
  compaction?: CompactionConfig
  commit_message?: CommitMessageConfig
  tools?: Record<string, boolean>
  auto_collapse_reasoning?: boolean
  experimental?: ExperimentalConfig
  sandbox?: SandboxConfig
  indexing?: IndexingConfig
}

export interface FeatureFlags {
  indexing: boolean
  sandboxControls: boolean
}
