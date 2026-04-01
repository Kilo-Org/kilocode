/**
 * legacy-migration - Types for legacy Kilo Code extension (v5.x) data structures.
 *
 * These types represent the shapes stored in VS Code SecretStorage and on disk
 * by the legacy extension (kilocode.kilo-code v5.x, a Roo Code fork).
 * They are intentionally loose (allowing [key: string]: unknown) to tolerate
 * schema drift between legacy versions.
 */

// ---------------------------------------------------------------------------
// Provider profiles (stored in SecretStorage under "roo_cline_config_api_config")
// ---------------------------------------------------------------------------

export interface LegacyProviderProfiles {
  currentApiConfigName: string
  apiConfigs: Record<string, LegacyProviderSettings>
  modeApiConfigs?: Record<string, string>
}

/**
 * Flat union of every provider-specific field from the legacy extension.
 * Only the fields we actually need for migration are explicitly typed;
 * the rest are captured by the index signature.
 */
export interface LegacyProviderSettings {
  id?: string
  apiProvider?: string
  apiModelId?: string

  // Anthropic
  apiKey?: string
  anthropicBaseUrl?: string

  // OpenRouter
  openRouterApiKey?: string
  openRouterModelId?: string
  openRouterBaseUrl?: string

  // OpenAI (custom/compatible)
  openAiApiKey?: string
  openAiModelId?: string
  openAiBaseUrl?: string

  // OpenAI Native
  openAiNativeApiKey?: string
  openAiNativeBaseUrl?: string

  // Gemini
  geminiApiKey?: string
  googleGeminiBaseUrl?: string

  // Vertex AI
  vertexJsonCredentials?: string
  vertexProjectId?: string
  vertexRegion?: string

  // AWS Bedrock
  awsAccessKey?: string
  awsSecretKey?: string
  awsSessionToken?: string
  awsRegion?: string
  awsApiKey?: string

  // DeepSeek
  deepSeekApiKey?: string
  deepSeekBaseUrl?: string

  // Mistral
  mistralApiKey?: string

  // Groq
  groqApiKey?: string

  // xAI
  xaiApiKey?: string

  // Fireworks
  fireworksApiKey?: string

  // Featherless
  featherlessApiKey?: string

  // Cerebras
  cerebrasApiKey?: string

  // SambaNova
  sambaNovaApiKey?: string

  // Ollama
  ollamaApiKey?: string
  ollamaBaseUrl?: string
  ollamaModelId?: string

  // LM Studio
  lmStudioBaseUrl?: string
  lmStudioModelId?: string

  // Kilocode
  kilocodeToken?: string
  kilocodeModel?: string
  kilocodeOrganizationId?: string

  // LiteLLM
  litellmApiKey?: string
  litellmBaseUrl?: string
  litellmModelId?: string

  // DeepInfra
  deepInfraApiKey?: string
  deepInfraBaseUrl?: string
  deepInfraModelId?: string

  // Chutes
  chutesApiKey?: string

  // Baseten
  basetenApiKey?: string

  // Corethink
  corethinkApiKey?: string

  // Unbound
  unboundApiKey?: string
  unboundModelId?: string

  // Requesty
  requestyApiKey?: string
  requestyBaseUrl?: string
  requestyModelId?: string

  // Hugging Face
  huggingFaceApiKey?: string
  huggingFaceModelId?: string

  // IO Intelligence
  ioIntelligenceApiKey?: string
  ioIntelligenceModelId?: string

  // Vercel AI Gateway
  vercelAiGatewayApiKey?: string
  vercelAiGatewayModelId?: string

  // Z.ai
  zaiApiKey?: string

  // Moonshot
  moonshotApiKey?: string
  moonshotBaseUrl?: string

  // Doubao
  doubaoApiKey?: string
  doubaoBaseUrl?: string

  // MiniMax
  minimaxApiKey?: string
  minimaxBaseUrl?: string

  // OVHcloud
  ovhCloudAiEndpointsApiKey?: string
  ovhCloudAiEndpointsBaseUrl?: string
  ovhCloudAiEndpointsModelId?: string

  // Inception Labs
  inceptionLabsApiKey?: string
  inceptionLabsBaseUrl?: string
  inceptionLabsModelId?: string

  // SAP AI Core
  sapAiCoreServiceKey?: string

  // Synthetic
  syntheticApiKey?: string

  // NanoGPT
  nanoGptApiKey?: string
  nanoGptModelId?: string

  // Poe
  poeApiKey?: string
  poeModelId?: string

  // AiHubMix
  aihubmixApiKey?: string
  aihubmixModelId?: string
  aihubmixBaseUrl?: string

  // ZenMux
  zenmuxApiKey?: string
  zenmuxModelId?: string
  zenmuxBaseUrl?: string

  // Allow dynamic property access for provider-mapping lookups
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// MCP settings (stored on disk at <globalStorage>/settings/mcp_settings.json)
// ---------------------------------------------------------------------------

export interface LegacyMcpSettings {
  mcpServers: Record<string, LegacyMcpServer>
}

export interface LegacyMcpServer {
  type?: "stdio" | "sse" | "streamable-http"
  command?: string
  args?: string[]
  cwd?: string
  url?: string
  env?: Record<string, string>
  headers?: Record<string, string>
  disabled?: boolean
  timeout?: number
}

// ---------------------------------------------------------------------------
// Autocomplete settings (stored in globalState under "ghostServiceSettings")
// ---------------------------------------------------------------------------

export interface LegacyAutocompleteSettings {
  enableAutoTrigger?: boolean
  enableSmartInlineTaskKeybinding?: boolean
  enableChatAutocomplete?: boolean
}

// ---------------------------------------------------------------------------
// Settings (stored in VS Code globalState under "kilo-code.*" keys)
// ---------------------------------------------------------------------------

export interface LegacySettings {
  autoApprovalEnabled?: boolean
  allowedCommands?: string[]
  deniedCommands?: string[]
  // Fine-grained auto-approval (legacy globalState keys — no prefix)
  alwaysAllowReadOnly?: boolean
  alwaysAllowReadOnlyOutsideWorkspace?: boolean
  alwaysAllowWrite?: boolean
  alwaysAllowExecute?: boolean
  alwaysAllowMcp?: boolean
  alwaysAllowModeSwitch?: boolean
  alwaysAllowSubtasks?: boolean
  language?: string
  autocomplete?: LegacyAutocompleteSettings
}

// ---------------------------------------------------------------------------
// Custom modes (stored on disk at <globalStorage>/settings/custom_modes.yaml)
// ---------------------------------------------------------------------------

interface LegacyCustomModesFile {
  customModes: LegacyCustomMode[]
}

export interface LegacyCustomMode {
  slug: string
  name: string
  roleDefinition: string
  customInstructions?: string
  whenToUse?: string
  description?: string
  groups: Array<string | [string, Record<string, string>]>
}

// ---------------------------------------------------------------------------
// Custom mode prompts (stored in VS Code globalState under "customModePrompts")
// ---------------------------------------------------------------------------

/** Partial prompt overrides the legacy extension stored per-mode in globalState */
export interface LegacyPromptComponent {
  roleDefinition?: string
  customInstructions?: string
  whenToUse?: string
  description?: string
}

// ---------------------------------------------------------------------------
// Migration data shapes
// ---------------------------------------------------------------------------

export interface MigrationProviderInfo {
  profileName: string
  provider: string
  model?: string
  hasApiKey: boolean
  supported: boolean
  newProviderName?: string
}

export interface MigrationMcpServerInfo {
  name: string
  type: string
  disabled?: boolean
}

export interface MigrationCustomModeInfo {
  name: string
  slug: string
  /** Original slug when migrating a modified native mode under a new slug */
  nativeSlug?: string
}

export interface LegacyMigrationData {
  providers: MigrationProviderInfo[]
  mcpServers: MigrationMcpServerInfo[]
  customModes: MigrationCustomModeInfo[]
  sessions?: string[]
  defaultModel?: { provider: string; model: string }
  settings?: LegacySettings
  hasData: boolean
}

export interface MigrationAutoApprovalSelections {
  /** Master toggle + command allowlist/denylist */
  commandRules: boolean
  /** Read permission (alwaysAllowReadOnly / alwaysAllowReadOnlyOutsideWorkspace) */
  readPermission: boolean
  /** Write permission (alwaysAllowWrite) */
  writePermission: boolean
  /** Execute permission (alwaysAllowExecute) */
  executePermission: boolean
  /** MCP tool permission (alwaysAllowMcp) */
  mcpPermission: boolean
  /** Task/subtask permission (alwaysAllowModeSwitch / alwaysAllowSubtasks) */
  taskPermission: boolean
}

export interface MigrationSettingsSelections {
  autoApproval: MigrationAutoApprovalSelections
  language: boolean
  autocomplete: boolean
}

export interface MigrationSelections {
  providers: string[]
  mcpServers: string[]
  customModes: string[]
  sessions?: string[]
  defaultModel: boolean
  settings: MigrationSettingsSelections
}
