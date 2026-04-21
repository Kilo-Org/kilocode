import { z } from "zod"
import { CanonicalTeamConfig } from "./config"
import { migrateLegacyTeamConfig } from "./migration"
import { TeamSchemaValidationError } from "./errors"

// devilcode_change start — Phase 7: bump to 1.1.0, add migration registry
export const CURRENT_TEAM_CONFIG_VERSION = "1.1.0"

export const TeamConfigVersion = z.enum(["1.0.0", "1.1.0"])
export type TeamConfigVersion = z.infer<typeof TeamConfigVersion>

/**
 * Migration registry: maps a source version to a transform function that
 * returns the data stamped as the next version.
 *
 * "1.0.0" → "1.1.0" is an additive change (workflowOverride is optional),
 * so the migration is an identity pass-through.
 */
const VERSION_ORDER: TeamConfigVersion[] = ["1.0.0", "1.1.0"]

type MigrationFn = (raw: unknown) => unknown
const MIGRATIONS: Partial<Record<TeamConfigVersion, MigrationFn>> = {
  "1.0.0": (raw) => raw, // Identity — 1.0.0 → 1.1.0 is purely additive
}

function detectVersion(raw: unknown): TeamConfigVersion | null {
  if (typeof raw !== "object" || raw === null) return null
  const v = (raw as Record<string, unknown>)["version"]
  const parsed = TeamConfigVersion.safeParse(v)
  return parsed.success ? parsed.data : null
}

function nextVersion(version: TeamConfigVersion): TeamConfigVersion | null {
  const idx = VERSION_ORDER.indexOf(version)
  return idx >= 0 && idx < VERSION_ORDER.length - 1 ? VERSION_ORDER[idx + 1] : null
}
// devilcode_change end

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

  // devilcode_change start — Phase 7: version-chain migration
  const detectedVersion = detectVersion(raw)
  if (detectedVersion !== null && detectedVersion !== CURRENT_TEAM_CONFIG_VERSION) {
    let version: TeamConfigVersion = detectedVersion
    let data: unknown = raw
    while (version !== CURRENT_TEAM_CONFIG_VERSION) {
      const migrate = MIGRATIONS[version]
      if (!migrate) {
        throw new TeamSchemaValidationError({
          layer: "config",
          issues: [{ code: z.ZodIssueCode.custom, path: ["version"], message: `No migration path from version ${version}` }],
        })
      }
      data = migrate(data)
      const next = nextVersion(version)
      if (!next) break
      version = next
    }
    const parsed = CanonicalTeamConfig.safeParse(data)
    if (!parsed.success) {
      throw new TeamSchemaValidationError({ layer: "config", issues: parsed.error.issues })
    }
    return parsed.data
  }
  // devilcode_change end

  const parsed = CanonicalTeamConfig.safeParse(raw)
  if (!parsed.success) {
    throw new TeamSchemaValidationError({ layer: "config", issues: parsed.error.issues })
  }
  return parsed.data
}
