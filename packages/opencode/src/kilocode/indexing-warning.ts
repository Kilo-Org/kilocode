import type { IndexingStatus } from "@kilocode/kilo-indexing/status"

export const INDEXING_WARNING_CODES = ["qdrant.version-incompatible", "qdrant.version-unavailable"] as const

export type IndexingWarning = {
  code: (typeof INDEXING_WARNING_CODES)[number]
  message: string
}

const incompatible =
  /^Client version .+ is incompatible with server version .+\. Major versions should match and minor version difference must not exceed 1\. Set checkCompatibility=false to skip version check\.$/
const detail = " Major versions should match and minor version difference must not exceed 1."
const unavailable =
  /^Failed to obtain server version\. Unable to check client-server compatibility\. Set checkCompatibility=false to skip version check\.$/

export function parseQdrantWarning(value: unknown): IndexingWarning | undefined {
  if (typeof value !== "string") return undefined
  if (incompatible.test(value)) return { code: "qdrant.version-incompatible", message: value.replace(detail, "") }
  if (unavailable.test(value)) return { code: "qdrant.version-unavailable", message: value }
  return undefined
}

export function indexingWarningKey(warning: IndexingWarning): string {
  return `${warning.code}\u0000${warning.message}`
}

export function indexingErrorMessage(status: IndexingStatus): string | undefined {
  return status.state === "Error" ? status.message : undefined
}
