import { z } from "zod"
import { CanonicalTeamConfig } from "./config"
import { TeamConfigVersion } from "./versioning"

export const TeamExportEnvelope = z
  .object({
    version: TeamConfigVersion,
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    config: CanonicalTeamConfig,
    exportedAt: z.string().datetime(),
    exportedBy: z.string().optional(),
  })
  .strict()
export type TeamExportEnvelope = z.infer<typeof TeamExportEnvelope>
