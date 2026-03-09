import type { FileDiff } from "@kilocode/sdk/v2/client"
import { z } from "zod"

export interface GeneratedSummary {
  files: number
  additions: number
  deletions: number
  entries: Array<{ file: string; folder: string; status: string; additions: number; deletions: number }>
}

export interface ParsedDiffResponse {
  diffs: FileDiff[]
  generated: GeneratedSummary
}

const EMPTY_GENERATED: GeneratedSummary = { files: 0, additions: 0, deletions: 0, entries: [] }

const GeneratedSummarySchema = z.object({
  files: z.number(),
  additions: z.number(),
  deletions: z.number(),
  entries: z.array(
    z.object({
      file: z.string(),
      folder: z.string(),
      status: z.string(),
      additions: z.number(),
      deletions: z.number(),
    }),
  ),
})

const DiffResponseSchema = z.object({
  diffs: z.array(z.any()),
  generated: GeneratedSummarySchema,
})

/**
 * Handle both old (FileDiff[]) and new ({ diffs, generated }) response shapes
 * for backward compat during SDK regen transition.
 */
export function parseDiffResponse(raw: unknown): ParsedDiffResponse {
  if (Array.isArray(raw)) return { diffs: raw, generated: EMPTY_GENERATED }
  const result = DiffResponseSchema.safeParse(raw)
  if (result.success) return result.data as ParsedDiffResponse
  return { diffs: [], generated: EMPTY_GENERATED }
}

/** Extract just the diffs array from an ambiguous response shape. */
export function extractDiffs(raw: unknown): FileDiff[] {
  if (Array.isArray(raw)) return raw
  const result = DiffResponseSchema.safeParse(raw)
  if (result.success) return result.data.diffs as FileDiff[]
  return []
}
