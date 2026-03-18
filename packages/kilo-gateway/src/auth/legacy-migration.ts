/**
 * Legacy Kilo CLI migration module
 *
 * Migrates authentication from the legacy Kilo Code VS Code extension CLI
 * config path (~/.kilocode/cli/config.json) to the new auth.json format.
 */
import fs from "fs/promises"
import os from "os"
import path from "path"

export const LEGACY_CONFIG_PATH = path.join(os.homedir(), ".kilocode", "cli", "config.json")

interface LegacyProvider {
  id: string
  provider: string
  kilocodeToken?: string
  kilocodeModel?: string
  kilocodeOrganizationId?: string
}

interface LegacyConfigFile {
  providers?: LegacyProvider[]
  [key: string]: unknown
}

interface LegacyKiloAuth {
  token: string
  organizationId?: string
}

// Auth info types matching opencode's Auth module
type ApiAuth = { type: "api"; key: string }
type OAuthAuth = { type: "oauth"; access: string; refresh: string; expires: number; accountId?: string }
type AuthInfo = ApiAuth | OAuthAuth

async function readLegacyConfig(file: string): Promise<LegacyConfigFile | null> {
  const content = await fs.readFile(file, "utf-8").catch(() => null)
  if (!content) return null
  try {
    return JSON.parse(content) as LegacyConfigFile
  } catch {
    return null
  }
}

/**
 * Extract kilo auth from legacy config
 */
function extractKiloAuth(config: LegacyConfigFile): LegacyKiloAuth | undefined {
  if (!config.providers) return undefined

  const provider = config.providers.find((p) => p.provider === "kilocode")
  if (!provider?.kilocodeToken) return undefined

  return {
    token: provider.kilocodeToken,
    organizationId: provider.kilocodeOrganizationId,
  }
}

/**
 * Migrate Kilo authentication from legacy CLI config path.
 *
 * Checks ~/.kilocode/cli/config.json for existing kilo credentials
 * and migrates them to the new auth.json format.
 *
 * @param hasKiloAuth - Callback to check if kilo auth already exists
 * @param saveKiloAuth - Callback to save the migrated auth
 * @returns true if migration was performed, false otherwise
 */
export async function migrateLegacyKiloAuth(
  hasKiloAuth: () => Promise<boolean>,
  saveKiloAuth: (auth: AuthInfo) => Promise<void>,
): Promise<boolean> {
  // Skip if kilo auth already configured
  if (await hasKiloAuth()) return false

  const config = await readLegacyConfig(LEGACY_CONFIG_PATH)
  if (!config) return false

  // Extract kilo auth from legacy config
  const legacy = extractKiloAuth(config)
  if (!legacy) return false

  // Migrate to new format
  // Use OAuth format if organization ID present, otherwise API format
  if (legacy.organizationId) {
    await saveKiloAuth({
      type: "oauth",
      access: legacy.token,
      refresh: "",
      expires: 0,
      accountId: legacy.organizationId,
    })
  } else {
    await saveKiloAuth({
      type: "api",
      key: legacy.token,
    })
  }

  return true
}

/**
 * Clear kilo credentials from the legacy config without deleting the whole file.
 *
 * Removes kilocodeToken and kilocodeOrganizationId from providers with
 * provider === "kilocode", preserving any other config in the file.
 *
 * @param file - Config file path (defaults to LEGACY_CONFIG_PATH, override for testing)
 * @returns true if changes were made
 */
export async function clearLegacyKiloAuth(file?: string): Promise<boolean> {
  const target = file ?? LEGACY_CONFIG_PATH
  const config = await readLegacyConfig(target)
  if (!config?.providers) return false

  let changed = false
  for (const p of config.providers) {
    if (p.provider !== "kilocode") continue
    if (p.kilocodeToken !== undefined) {
      delete p.kilocodeToken
      changed = true
    }
    if (p.kilocodeOrganizationId !== undefined) {
      delete p.kilocodeOrganizationId
      changed = true
    }
  }

  if (changed) {
    await fs.writeFile(target, JSON.stringify(config, null, 2), "utf-8")
  }

  return changed
}
