import z from "zod"

export const EffortLevel = z.enum(["max", "xhigh", "high", "medium", "low", "default"]).default("default")
export type EffortLevel = z.infer<typeof EffortLevel>

export const TeamRole = z.object({
  displayName: z.string(),
  provider: z.string(),
  model: z.string(),
  effort: EffortLevel,
  tier: z.number().int().positive(),
  canDelegate: z.array(z.string()).default([]),
  maxConcurrent: z.number().int().positive().default(3),
  capabilities: z.array(z.string()).default([]),
})
export type TeamRole = z.infer<typeof TeamRole>

export const TeamRouting = z.object({
  strategy: z.enum(["hierarchical", "flat"]).default("hierarchical"),
  defaultRole: z.string(),
  escalationEnabled: z.boolean().default(true),
})
export type TeamRouting = z.infer<typeof TeamRouting>

export const TeamConfig = z.object({
  enabled: z.boolean().default(false),
  roles: z.record(z.string(), TeamRole),
  routing: TeamRouting,
})
export type TeamConfig = z.infer<typeof TeamConfig>
