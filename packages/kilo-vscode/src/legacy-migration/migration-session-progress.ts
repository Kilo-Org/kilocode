import type { MigrationSessionInfo, MigrationSessionProgress } from "./legacy-types"
import type { SessionProgressCallback } from "./migration-service"

export interface MigrationSessionMeta {
  session: MigrationSessionInfo
  index: number
  total: number
}

export function buildSessionMeta(
  session: MigrationSessionInfo | undefined,
  index: number,
  total: number,
): MigrationSessionMeta | undefined {
  if (!session) return undefined
  return {
    session,
    index: index + 1,
    total,
  }
}

export function buildSessionProgress(
  meta: MigrationSessionMeta | undefined,
  onProgress: SessionProgressCallback | undefined,
) {
  if (!meta || !onProgress) return undefined
  return (progress: Omit<MigrationSessionProgress, "session" | "index" | "total">) => {
    onProgress({
      session: meta.session,
      index: meta.index,
      total: meta.total,
      phase: progress.phase,
      error: progress.error,
    })
  }
}
