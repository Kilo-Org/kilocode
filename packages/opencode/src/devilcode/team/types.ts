import z from "zod"

export const TaskResultStatus = z.enum(["completed", "escalated", "blocked", "failed"])
export type TaskResultStatus = z.infer<typeof TaskResultStatus>

export const Escalation = z.object({
  reason: z.string(),
  suggestedRole: z.string().optional(),
  context: z.string(),
})
export type Escalation = z.infer<typeof Escalation>

export const TaskResult = z.object({
  status: TaskResultStatus,
  output: z.string(),
  filesModified: z.array(z.string()).default([]),
  escalation: Escalation.optional(),
})
export type TaskResult = z.infer<typeof TaskResult>
