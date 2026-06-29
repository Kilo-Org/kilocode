// legacy-migration start
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
}

export interface MigrationCustomModeInfo {
  name: string
  slug: string
}

export interface LegacyAutocompleteSettings {
  enableAutoTrigger?: boolean
  enableSmartInlineTaskKeybinding?: boolean
  enableChatAutocomplete?: boolean
}

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

export interface MigrationSessionInfo {
  id: string
  title: string
  directory: string
  time: number
}

export interface MigrationResultItem {
  item: string
  category: "provider" | "mcpServer" | "customMode" | "session" | "defaultModel" | "settings"
  status: "success" | "warning" | "error"
  message?: string
}

export type MigrationSource = "legacy" | "roo"

export interface MigrationStateMessage {
  type: "migrationState"
  needed: boolean
  source: "legacy"
}

export interface MigrationDataMessage {
  type: "migrationData"
  source: MigrationSource
  operationId: string
  data: {
    providers: MigrationProviderInfo[]
    mcpServers: MigrationMcpServerInfo[]
    customModes: MigrationCustomModeInfo[]
    sessions?: MigrationSessionInfo[]
    defaultModel?: { provider: string; model: string }
    settings?: LegacySettings
  }
}

export interface MigrationProgressMessage {
  type: "migrationProgress"
  source: MigrationSource
  operationId: string
  item: string
  status: "migrating" | "success" | "warning" | "error"
  message?: string
}

export type LegacyMigrationSessionPhase = "preparing" | "storing" | "skipped" | "done" | "summary" | "error"

export interface MigrationSessionProgressMessage {
  type: "migrationSessionProgress"
  source: MigrationSource
  operationId: string
  session: MigrationSessionInfo
  index: number
  total: number
  phase: LegacyMigrationSessionPhase
  error?: string
}

export interface MigrationCompleteMessage {
  type: "migrationComplete"
  source: MigrationSource
  operationId: string
  results: MigrationResultItem[]
}

export interface RequestMigrationDataMessage {
  type: "requestMigrationData"
  source: MigrationSource
  operationId: string
}

export interface MigrationAutoApprovalSelections {
  commandRules: boolean
  readPermission: boolean
  writePermission: boolean
  executePermission: boolean
  mcpPermission: boolean
  taskPermission: boolean
}

export interface MigrationSessionSelection {
  id: string
  force?: boolean
}

export interface StartMigrationMessage {
  type: "startMigration"
  source: MigrationSource
  operationId: string
  selections: {
    providers: string[]
    mcpServers: string[]
    customModes: string[]
    sessions?: MigrationSessionSelection[]
    defaultModel: boolean
    settings: {
      autoApproval: MigrationAutoApprovalSelections
      language: boolean
      autocomplete: boolean
    }
  }
}

export interface SkipLegacyMigrationMessage {
  type: "skipLegacyMigration"
}

export interface ClearLegacyDataMessage {
  type: "clearLegacyData"
}

export interface FinalizeLegacyMigrationMessage {
  type: "finalizeLegacyMigration"
}
// legacy-migration end
