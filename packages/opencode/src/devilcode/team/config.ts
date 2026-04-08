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
}).refine(
  (cfg) => !cfg.enabled || cfg.routing.defaultRole in cfg.roles,
  { message: "routing.defaultRole must reference an existing role", path: ["routing", "defaultRole"] }
).refine(
  (cfg) => !cfg.enabled || Object.values(cfg.roles).every(role =>
    role.canDelegate.every(d => d in cfg.roles)
  ),
  { message: "canDelegate entries must reference existing roles", path: ["roles"] }
)
export type TeamConfig = z.infer<typeof TeamConfig>
