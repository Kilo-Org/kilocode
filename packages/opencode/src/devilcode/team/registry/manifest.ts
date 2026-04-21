import { z } from "zod"
import { TeamExportEnvelope } from "../export-envelope"

export const TeamManifestMetadata = z
  .object({
    name: z.string().min(1),
    author: z.string().min(1),
    publisherId: z.string().uuid(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, "must be a semver string (e.g. 1.2.3)"),
    license: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    publishedAt: z.string().datetime(),
    homepage: z.string().url().optional(),
    repository: z.string().url().optional(),
  })
  .strict()
export type TeamManifestMetadata = z.infer<typeof TeamManifestMetadata>

export const TeamRegistryManifest = z
  .object({
    manifestVersion: z.literal("1.0"),
    envelope: TeamExportEnvelope,
    metadata: TeamManifestMetadata,
    signature: z.string().optional(),
  })
  .strict()
export type TeamRegistryManifest = z.infer<typeof TeamRegistryManifest>

export const RegistryIndex = z
  .object({
    version: z.literal("1.0"),
    updatedAt: z.string().datetime(),
    manifests: z.array(TeamRegistryManifest),
  })
  .strict()
export type RegistryIndex = z.infer<typeof RegistryIndex>
