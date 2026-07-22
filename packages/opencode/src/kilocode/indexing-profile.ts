import { createHash } from "node:crypto"
import path from "node:path"
import type { IndexingProfileRecord } from "@kilocode/kilo-indexing/engine"

const allowed = new Set([
  "enabled",
  "configured",
  "requiresRestart",
  "provider",
  "modelId",
  "vectorStore",
  "baseline",
  "validationMs",
  "trigger",
  "mode",
  "watcherInitMs",
  "storeInitMs",
  "scanMs",
  "finalizeMs",
  "discoveredCount",
  "candidateCount",
  "inspectedCount",
  "readCount",
  "bytesRead",
  "unchangedCount",
  "processedCount",
  "skippedCount",
  "blockCount",
  "batchCount",
  "changedDeleteCount",
  "removedDeleteCount",
  "fileCount",
  "attemptCount",
  "deleteMs",
  "embeddingMs",
  "upsertMs",
  "eventCount",
  "deleteCount",
  "upsertFileCount",
  "pointCount",
  "successCount",
  "errorCount",
  "prepareMs",
  "flushMs",
  "textCount",
  "scope",
  "currentSearchMs",
  "baselineSearchMs",
  "deltaCallCount",
  "baselineCallCount",
  "resultCount",
  "files",
])

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function primitive(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
}

function fields(value: unknown): value is IndexingProfileRecord["fields"] {
  return object(value) && Object.values(value).every(primitive)
}

function outcome(value: unknown): value is IndexingProfileRecord["outcome"] {
  return value === "success" || value === "error" || value === "cancelled" || value === "disabled" || value === "waiting"
}

export function parseIndexingProfile(args: unknown[]): IndexingProfileRecord | undefined {
  if (args.length !== 1 || typeof args[0] !== "string") return

  try {
    const value: unknown = JSON.parse(args[0])
    if (!object(value)) return
    if (value.type !== "kilo-indexing-profile") return
    if (typeof value.event !== "string") return
    if (typeof value.durationMs !== "number" || !Number.isFinite(value.durationMs) || value.durationMs < 0) return
    if (!outcome(value.outcome)) return
    if (!fields(value.fields)) return
    return {
      type: value.type,
      event: value.event,
      durationMs: value.durationMs,
      outcome: value.outcome,
      fields: value.fields,
    }
  } catch {
    return
  }
}

export function indexingProfileWorkspaceID(directory: string): string {
  return createHash("sha256").update(path.resolve(directory)).digest("hex").slice(0, 16)
}

export function indexingProfileLogFields(
  directory: string,
  profile: IndexingProfileRecord,
): Record<string, string | number | boolean> {
  const fields: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(profile.fields)) {
    if (allowed.has(key)) fields[key] = value
  }

  return {
    ...fields,
    source: "worker",
    workspaceID: indexingProfileWorkspaceID(directory),
    event: profile.event,
    durationMs: profile.durationMs,
    outcome: profile.outcome,
  }
}
