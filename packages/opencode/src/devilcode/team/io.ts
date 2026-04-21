import { promises as fs } from "fs"
import { CanonicalTeamConfig } from "./config"
import { TeamExportEnvelope } from "./export-envelope"
import { computeTeamChecksum, verifyTeamChecksum } from "./checksum"
// devilcode_change start — Phase 7: import TeamConfigVersion for known-version check
import { migrateTeamConfig, CURRENT_TEAM_CONFIG_VERSION, TeamConfigVersion } from "./versioning"
// devilcode_change end
import { TeamImportError, TeamVersionMismatchError, TeamChecksumError, TeamSchemaValidationError } from "./errors"

export async function exportTeamToFile(
  filePath: string,
  config: CanonicalTeamConfig,
  options?: { exportedBy?: string },
): Promise<TeamExportEnvelope> {
  const validated = CanonicalTeamConfig.parse(config)
  const envelope: TeamExportEnvelope = {
    version: CURRENT_TEAM_CONFIG_VERSION,
    checksum: computeTeamChecksum(validated),
    config: validated,
    exportedAt: new Date().toISOString(),
    exportedBy: options?.exportedBy,
  }
  await fs.writeFile(filePath, JSON.stringify(envelope, null, 2) + "\n", "utf-8")
  return envelope
}

export async function importTeamFromFile(filePath: string): Promise<CanonicalTeamConfig> {
  let text: string
  try {
    text = await fs.readFile(filePath, "utf-8")
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException
    if (e?.code === "ENOENT") {
      throw new TeamImportError({ kind: "file-not-found", filePath, cause: err })
    }
    throw err
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err: unknown) {
    throw new TeamImportError({ kind: "json-parse-failed", filePath, cause: err })
  }

  const looksLikeEnvelope =
    typeof raw === "object" && raw !== null && "version" in raw && "checksum" in raw && "config" in raw

  if (looksLikeEnvelope) {
    const candidate = raw as { version: unknown; checksum: unknown; config: unknown }
    // devilcode_change start — Phase 7: accept known older versions via migration; reject truly unknown versions
    const versionCheck = TeamConfigVersion.safeParse(candidate.version)
    if (!versionCheck.success) {
      throw new TeamVersionMismatchError({
        found: String(candidate.version),
        required: CURRENT_TEAM_CONFIG_VERSION,
        filePath,
      })
    }
    // devilcode_change end
    const parseResult = TeamExportEnvelope.safeParse(raw)
    if (!parseResult.success) {
      throw new TeamSchemaValidationError({
        layer: "envelope",
        issues: parseResult.error.issues,
        filePath,
      })
    }
    const envelope = parseResult.data
    // devilcode_change start — Phase 7 fix F8: verify checksum on raw envelope.config (pre-migration)
    // to avoid spurious failures when migration or Zod defaults alter the object shape.
    if (!verifyTeamChecksum(envelope.config as CanonicalTeamConfig, envelope.checksum)) {
      throw new TeamChecksumError({ filePath })
    }
    // devilcode_change end
    const migrated = await migrateTeamConfig(envelope.config)
    return migrated
  }

  return await migrateTeamConfig(raw)
}
