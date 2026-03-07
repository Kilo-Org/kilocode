import type { FileDiff } from "@kilocode/sdk/v2/client"

export interface GeneratedSummary {
  files: number
  additions: number
  deletions: number
  entries: Array<{ file: string; status: string; additions: number; deletions: number }>
}

export interface ParsedDiffResponse {
  diffs: FileDiff[]
  generated: GeneratedSummary
}

const EMPTY_GENERATED: GeneratedSummary = { files: 0, additions: 0, deletions: 0, entries: [] }

/**
 * Handle both old (FileDiff[]) and new ({ diffs, generated }) response shapes
 * for backward compat during SDK regen transition.
 */
export function parseDiffResponse(raw: unknown): ParsedDiffResponse {
  if (Array.isArray(raw)) return { diffs: raw, generated: EMPTY_GENERATED }
  return raw as ParsedDiffResponse
}

/** Extract just the diffs array from an ambiguous response shape. */
export function extractDiffs(raw: unknown): FileDiff[] {
  if (Array.isArray(raw)) return raw
  return (raw as ParsedDiffResponse).diffs ?? []
}
