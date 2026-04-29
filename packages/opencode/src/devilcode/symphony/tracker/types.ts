import z from "zod"

export const BlockerRef = z.object({
  id: z.string(),
  identifier: z.string(),
  state: z.string(),
})
export type BlockerRef = z.infer<typeof BlockerRef>

export const TrackerIssue = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  priority: z.number().nullable(),
  state: z.string(),
  branchName: z.string().nullable(),
  url: z.string(),
  labels: z.array(z.string()),
  blockedBy: z.array(BlockerRef),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type TrackerIssue = z.infer<typeof TrackerIssue>
