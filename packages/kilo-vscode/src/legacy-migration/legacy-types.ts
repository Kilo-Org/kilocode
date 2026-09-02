export interface MigrationSessionInfo {
  id: string
  title: string
  directory: string
  time: number
}

export interface MigrationSessionSelection {
  id: string
  force?: boolean
}

export interface MigrationSelections {
  sessions?: MigrationSessionSelection[]
}

export type MigrationSessionPhase = "preparing" | "storing" | "skipped" | "done" | "summary" | "error"

export interface MigrationSessionProgress {
  session: MigrationSessionInfo
  index: number
  total: number
  phase: MigrationSessionPhase
  error?: string
}
