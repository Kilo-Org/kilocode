export interface MigrationSessionInfo {
  id: string
  title: string
  directory: string
  time: number
}

export interface MigrationResultItem {
  item: string
  category: "session"
  status: "success" | "warning" | "error"
  message?: string
}

export type MigrationSource = "roo"

export interface MigrationDataMessage {
  type: "migrationData"
  source: MigrationSource
  operationId: string
  data: {
    sessions?: MigrationSessionInfo[]
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

export interface MigrationSessionSelection {
  id: string
  force?: boolean
}

export interface StartMigrationMessage {
  type: "startMigration"
  source: MigrationSource
  operationId: string
  selections: {
    sessions?: MigrationSessionSelection[]
  }
}
