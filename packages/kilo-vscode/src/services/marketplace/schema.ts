import { z } from "zod"

export const marketplaceItemTypeSchema = z.enum(["mode", "mcp", "skill"])

export const mcpParameterSchema = z.object({
  name: z.string().min(1),
  key: z.string().min(1),
  placeholder: z.string().optional(),
  optional: z.boolean().optional().default(false),
})

export const mcpInstallationMethodSchema = z.object({
  name: z.string().min(1),
  content: z.string().min(1),
  parameters: z.array(mcpParameterSchema).optional(),
  prerequisites: z.array(z.string()).optional(),
})

const baseMarketplaceItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  managedByOrganization: z.boolean().optional(),
  author: z.string().optional(),
  authorUrl: z.string().url().optional(),
  tags: z.array(z.string()).optional(),
  prerequisites: z.array(z.string()).optional(),
})

export const modeMarketplaceItemSchema = baseMarketplaceItemSchema.extend({
  type: z.literal("mode"),
  content: z.string().min(1),
})

export const mcpMarketplaceItemSchema = baseMarketplaceItemSchema.extend({
  type: z.literal("mcp"),
  url: z.string().url(),
  content: z.union([z.string().min(1), z.array(mcpInstallationMethodSchema)]),
  parameters: z.array(mcpParameterSchema).optional(),
})

export const skillMarketplaceItemSchema = baseMarketplaceItemSchema.extend({
  type: z.literal("skill"),
  category: z.string(),
  githubUrl: z.string().url(),
  content: z.string().min(1),
  displayName: z.string(),
  displayCategory: z.string(),
})

export const marketplaceItemSchema = z.discriminatedUnion("type", [
  modeMarketplaceItemSchema,
  mcpMarketplaceItemSchema,
  skillMarketplaceItemSchema,
])

export const installMarketplaceItemOptionsSchema = z.object({
  target: z.enum(["global", "project"]).optional().default("project"),
  selectedIndex: z.number().int().min(0).optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
})

export const modeMarketplaceCatalogSchema = z.object({
  items: z.array(modeMarketplaceItemSchema.omit({ type: true })),
})

export const mcpMarketplaceCatalogSchema = z.object({
  items: z.array(mcpMarketplaceItemSchema.omit({ type: true })),
})

export const rawSkillSchema = z.object({
  id: z.string().min(1),
  description: z.string(),
  category: z.string(),
  githubUrl: z.string().url(),
  content: z.string().min(1),
})

export const skillsMarketplaceCatalogSchema = z.object({
  items: z.array(rawSkillSchema),
})

export const marketplaceOrganizationPolicySchema = z.object({
  hideMarketplaceMcps: z.boolean().optional(),
  hiddenMcps: z.array(z.string()).optional(),
  mcps: z.array(mcpMarketplaceItemSchema.omit({ type: true })).optional(),
})

export type MarketplaceItemSchema = z.infer<typeof marketplaceItemSchema>
export type InstallMarketplaceItemOptionsSchema = z.infer<typeof installMarketplaceItemOptionsSchema>
