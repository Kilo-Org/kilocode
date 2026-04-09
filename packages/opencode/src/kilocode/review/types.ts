import z from "zod"

export const DiffHunk = z.object({
  oldStart: z.number(),
  oldLines: z.number(),
  newStart: z.number(),
  newLines: z.number(),
  content: z.string(),
})
export type DiffHunk = z.infer<typeof DiffHunk>

export const DiffFile = z.object({
  path: z.string(),
  status: z.enum(["added", "modified", "deleted", "renamed"]),
  hunks: z.array(DiffHunk),
  oldPath: z.string().optional(), // For renamed files
})
export type DiffFile = z.infer<typeof DiffFile>

export const DiffResult = z.object({
  files: z.array(DiffFile),
  raw: z.string(), // Original diff output for reference
})
export type DiffResult = z.infer<typeof DiffResult>
