/**
 * Legacy Devil CLI migration module
 *
 * Migrates authentication from the legacy Devil Code VS Code extension CLI
 * config path (~/.devilcode/cli/config.json) to the new auth.json format.
 */
import fs from "fs/promises"
import os from "os"
import path from "path"

export const LEGACY_CONFIG_PATH = path.join(os.homedir(), ".devilcode", "cli", "config.json")

interface LegacyProvider {
  id: string
  provider: string
  devilcodeToken?: string
  devilcodeModel?: string
  devilcodeOrganizationId?: string
}

interface LegacyConfig {
  providers?: LegacyProvider[]
}

interface LegacyDevilAuth {
  token: string
  organizationId?: string
}

// Auth info types matching opencode's Auth module
type ApiAuth = { type: "api"; key: string }
type OAuthAuth = { type: "oauth"; access: string; refresh: string; expires: number; accountId?: string }
type AuthInfo = ApiAuth | OAuthAuth

/**
 * Extract kilo auth from legacy config
 */
function extractDevilAuth(config: LegacyConfig): LegacyDevilAuth | undefined {
  if (!config.providers) return undefined

  const provider = config.providers.find((p) => p.provider === "devilcode")
  if (!provider?.devilcodeToken) return undefined

  return {
    token: provider.devilcodeToken,
    organizationId: provider.devilcodeOrganizationId,
  }
}

/**
 * Migrate Devil authentication from legacy CLI config path.
 *
 * Checks ~/.devilcode/cli/config.json for existing kilo credentials
 * and migrates them to the new auth.json format.
 *
 * @param hasDevilAuth - Callback to check if kilo auth already exists
 * @param saveDevilAuth - Callback to save the migrated auth
 * @returns true if migration was performed, false otherwise
 */
export async function migrateLegacyDevilAuth(
  hasDevilAuth: () => Promise<boolean>,
  saveDevilAuth: (auth: AuthInfo) => Promise<void>,
): Promise<boolean> {
  // Skip if kilo auth already configured
  if (await hasDevilAuth()) return false

  // Check if legacy config exists and parse it
  const content = await fs.readFile(LEGACY_CONFIG_PATH, "utf-8").catch(() => null)
  if (!content) return false

  let config: LegacyConfig | null = null
  try {
    config = JSON.parse(content) as LegacyConfig
  } catch {
    return false
  }

  // Extract kilo auth from legacy config
  const legacy = extractDevilAuth(config)
  if (!legacy) return false

  // Migrate to new format
  // Use OAuth format if organization ID present, otherwise API format
  if (legacy.organizationId) {
    await saveDevilAuth({
      type: "oauth",
      access: legacy.token,
      refresh: "",
      expires: 0,
      accountId: legacy.organizationId,
    })
  } else {
    await saveDevilAuth({
      type: "api",
      key: legacy.token,
    })
  }

  return true
}
