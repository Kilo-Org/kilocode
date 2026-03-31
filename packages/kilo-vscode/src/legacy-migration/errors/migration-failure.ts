export type MigrationFailureKind = "unknown" | "generic" | "http" | "sdk"

export interface MigrationFailure {
  kind: MigrationFailureKind
  message: string
  detail?: string
  cause?: string
}
