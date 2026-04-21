import { z } from "zod"
import { CanonicalTeamConfig } from "./config"
import { migrateLegacyTeamConfig } from "./migration"
import { TeamSchemaValidationError } from "./errors"

export const CURRENT_TEAM_CONFIG_VERSION = "1.0.0"

export const TeamConfigVersion = z.literal("1.0.0")
export type TeamConfigVersion = z.infer<typeof TeamConfigVersion>

/** Legacy shape has NO positionId field on its roles; canonical shape REQUIRES it. */
export function isLegacyShape(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false
  const roles = (raw as { roles?: unknown }).roles
  if (!roles || typeof roles !== "object" || Array.isArray(roles)) return false
  const values = Object.values(roles as Record<string, unknown>)
  if (values.length === 0) return false
  // Canonical role REQUIRES positionId (see CanonicalTeamRole in config.ts).
  // If every role lacks positionId AND has a displayName, treat as legacy shape.
  return values.every((r) => {
    if (typeof r !== "object" || r === null) return false
    const role = r as Record<string, unknown>
    return role.positionId === undefined && typeof role.displayName === "string"
  })
}

export async function migrateTeamConfig(raw: unknown): Promise<CanonicalTeamConfig> {
  if (isLegacyShape(raw)) {
    const result = migrateLegacyTeamConfig(raw)
    if (result.ok) return result.value
    throw new TeamSchemaValidationError({
      layer: "config",
      issues: result.errors.map((e) => ({
        code: z.ZodIssueCode.custom,
        path: e.roleId ? [String(e.roleId)] : [],
        message: e.kind === "parse-failure" ? e.message : String(e.kind ?? "legacy migration failed"),
      })),
    })
  }
  const parsed = CanonicalTeamConfig.safeParse(raw)
  if (!parsed.success) {
    throw new TeamSchemaValidationError({ layer: "config", issues: parsed.error.issues })
  }
  return parsed.data
}
