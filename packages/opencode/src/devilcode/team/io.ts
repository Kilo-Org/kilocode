import { promises as fs } from "fs"
import { CanonicalTeamConfig } from "./config"
import { TeamExportEnvelope } from "./export-envelope"
import { computeTeamChecksum, verifyTeamChecksum } from "./checksum"
import { migrateTeamConfig, CURRENT_TEAM_CONFIG_VERSION } from "./versioning"
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
    if (candidate.version !== CURRENT_TEAM_CONFIG_VERSION) {
      throw new TeamVersionMismatchError({
        found: String(candidate.version),
        required: CURRENT_TEAM_CONFIG_VERSION,
        filePath,
      })
    }
    const parseResult = TeamExportEnvelope.safeParse(raw)
    if (!parseResult.success) {
      throw new TeamSchemaValidationError({
        layer: "envelope",
        issues: parseResult.error.issues,
        filePath,
      })
    }
    const envelope = parseResult.data
    const migrated = await migrateTeamConfig(envelope.config)
    if (!verifyTeamChecksum(migrated, envelope.checksum)) {
      throw new TeamChecksumError({ filePath })
    }
    return migrated
  }

  return await migrateTeamConfig(raw)
}
