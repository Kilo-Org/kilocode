/**
 * legacy-migration - Core migration service.
 *
 * Reads legacy Kilo Code v5.x data from VS Code SecretStorage and the extension's
 * global storage directory, then writes it to the new CLI backend via the SDK.
 */

import * as vscode from "vscode"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import type {
  McpLocalConfig,
  McpRemoteConfig,
  AgentConfig,
  PermissionConfig,
  PermissionObjectConfig,
} from "@kilocode/sdk/v2/client"
import { PROVIDER_MAP, UNSUPPORTED_PROVIDERS, DEFAULT_MODE_SLUGS } from "./provider-mapping"
import type { ProviderMapping } from "./provider-mapping"
import { NATIVE_MODE_DEFAULTS } from "./native-mode-defaults"
import { getMigrationErrorMessage } from "./errors/migration-error"
import type {
  LegacyProviderProfiles,
  LegacyProviderSettings,
  LegacyMcpSettings,
  LegacyCustomMode,
  LegacyMcpServer,
  LegacySettings,
  LegacyAutocompleteSettings,
  LegacyPromptComponent,
  LegacyMigrationData,
  MigrationSelections,
  MigrationAutoApprovalSelections,
  MigrationProviderInfo,
  MigrationMcpServerInfo,
  MigrationCustomModeInfo,
} from "./legacy-types"
import type { MigrationResultItem } from "./migration-types"
import { createSessionID } from "./sessions/lib/ids"
import { migrate as migrateSession } from "./sessions/migrate"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SECRET_KEY = "roo_cline_config_api_config"
const CODEX_OAUTH_SECRET_KEY = "openai-codex-oauth-credentials"
const MIGRATION_STATUS_KEY = "kilo.legacyMigrationStatus"

type MigrationStatus = "completed" | "skipped"

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

export function getMigrationStatus(context: vscode.ExtensionContext): MigrationStatus | undefined {
  return context.globalState.get<MigrationStatus>(MIGRATION_STATUS_KEY)
}

export async function setMigrationStatus(context: vscode.ExtensionContext, status: MigrationStatus): Promise<void> {
  await context.globalState.update(MIGRATION_STATUS_KEY, status)
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Reads legacy data from SecretStorage and global storage files.
 * Returns a structured summary for display in the migration wizard.
 */
export async function detectLegacyData(context: vscode.ExtensionContext): Promise<LegacyMigrationData> {
  const profiles = await readLegacyProviderProfiles(context)
  const mcpSettings = await readLegacyMcpSettings(context)
  const customModes = await readLegacyCustomModes(context)
  const prompts = readLegacyCustomModePrompts(context)
  const settings = readLegacySettings(context)
  const sessions = await readSessionsInGlobalStorage(context)

  const oauthProviders = new Set<string>()
  const codexRaw = await context.secrets.get(CODEX_OAUTH_SECRET_KEY)
  if (codexRaw) oauthProviders.add("openai-codex")

  const providers = buildProviderList(profiles, oauthProviders)
  const mcpServers = buildMcpServerList(mcpSettings)
  const modes = buildCustomModeList(customModes, prompts)
  const defaultModel = resolveDefaultModel(profiles, oauthProviders)

  const hasSettings =
    settings.autoApprovalEnabled !== undefined ||
    (settings.allowedCommands?.length ?? 0) > 0 ||
    (settings.deniedCommands?.length ?? 0) > 0 ||
    settings.alwaysAllowReadOnly !== undefined ||
    settings.alwaysAllowReadOnlyOutsideWorkspace !== undefined ||
    settings.alwaysAllowWrite !== undefined ||
    settings.alwaysAllowExecute !== undefined ||
    settings.alwaysAllowMcp !== undefined ||
    settings.alwaysAllowModeSwitch !== undefined ||
    settings.alwaysAllowSubtasks !== undefined ||
    Boolean(settings.language) ||
    Boolean(settings.autocomplete)

  const hasData =
    providers.length > 0 || mcpServers.length > 0 || modes.length > 0 || hasSettings || sessions.length > 0

  return {
    providers,
    mcpServers,
    customModes: modes,
    sessions: sessions.length > 0 ? sessions : undefined,
    defaultModel,
    settings: hasSettings ? settings : undefined,
    hasData,
  }
}

async function readSessionsInGlobalStorage(context: vscode.ExtensionContext) {
  const items = context.globalState.get<{ id: string }[]>("taskHistory", [])
  const base = vscode.Uri.joinPath(context.globalStorageUri, "tasks")
  const ids: string[] = []
  for (const item of items) {
    const file = vscode.Uri.joinPath(base, item.id, "api_conversation_history.json")
    const exists = await vscode.workspace.fs.stat(file).then(
      () => true,
      () => false,
    )
    if (exists) ids.push(item.id)
  }
  return ids
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

export type ProgressCallback = (
  item: string,
  status: "migrating" | "success" | "warning" | "error",
  message?: string,
) => void

/**
 * Executes migration for the selected items.
 * Calls onProgress for each item with real-time status updates.
 * Pass `cachedSettings` (from a prior detectLegacyData call) to avoid re-reading
 * globalState. Provider profiles, MCP servers, and custom modes are always re-read
 * from SecretStorage/disk to ensure the data is current at migration time.
 */
export async function migrate(
  context: vscode.ExtensionContext,
  client: KiloClient,
  selections: MigrationSelections,
  onProgress: ProgressCallback,
  cachedSettings?: LegacySettings,
): Promise<MigrationResultItem[]> {
  const profiles = await readLegacyProviderProfiles(context)
  const mcpSettings = await readLegacyMcpSettings(context)
  const customModes = await readLegacyCustomModes(context)
  const prompts = readLegacyCustomModePrompts(context)
  const legacySettings = cachedSettings ?? readLegacySettings(context)

  const results: MigrationResultItem[] = []

  // Migrate provider API keys
  for (const profileName of selections.providers) {
    const settings = profiles?.apiConfigs[profileName]
    if (!settings) {
      results.push({ item: profileName, category: "provider", status: "error", message: "Profile not found" })
      continue
    }
    onProgress(profileName, "migrating")
    const result = await migrateProvider(context, profileName, settings, client)
    results.push(result)
    onProgress(profileName, result.status, result.message)
  }

  // Migrate MCP servers
  if (selections.mcpServers.length > 0 && mcpSettings) {
    const mcpConfig: Record<string, McpLocalConfig | McpRemoteConfig> = {}
    for (const name of selections.mcpServers) {
      const server = mcpSettings.mcpServers[name]
      if (!server) {
        results.push({ item: name, category: "mcpServer", status: "error", message: "Server not found" })
        continue
      }
      onProgress(name, "migrating")
      const converted = convertMcpServer(server)
      if (converted) {
        mcpConfig[name] = converted
        results.push({ item: name, category: "mcpServer", status: "success" })
        onProgress(name, "success")
      } else {
        results.push({
          item: name,
          category: "mcpServer",
          status: "warning",
          message: "Could not convert server config",
        })
        onProgress(name, "warning", "Could not convert server config")
      }
    }
    if (Object.keys(mcpConfig).length > 0) {
      await client.global.config.update({ config: { mcp: mcpConfig } })
    }
  }

  // Migrate custom modes as agents
  if (selections.customModes.length > 0) {
    const agentConfig: Record<string, AgentConfig> = {}
    // Build a lookup of detected modes by slug so we can resolve nativeSlug
    const detected = buildCustomModeList(customModes, prompts)
    for (const slug of selections.customModes) {
      const info = detected.find((m) => m.slug === slug)
      if (!info) {
        results.push({ item: slug, category: "customMode", status: "error", message: "Mode not found" })
        continue
      }

      if (info.nativeSlug) {
        // Modified native mode — merge YAML custom mode + customModePrompts
        const merged = buildMergedNativeMode(
          customModes?.find((m) => m.slug === info.nativeSlug),
          prompts?.[info.nativeSlug],
          info.nativeSlug,
        )
        if (merged) {
          onProgress(info.name, "migrating")
          const agent = convertCustomMode(merged)
          // Set explicit name so the UI shows "(Custom)" instead of title-casing the slug
          agent.name = info.name
          agentConfig[slug] = agent
          results.push({ item: info.name, category: "customMode", status: "success" })
          onProgress(info.name, "success")
        } else {
          results.push({
            item: info.name,
            category: "customMode",
            status: "error",
            message: "Failed to build merged mode",
          })
        }
      } else {
        // Regular custom mode (existing behavior)
        const mode = customModes?.find((m) => m.slug === slug)
        if (!mode) {
          results.push({ item: slug, category: "customMode", status: "error", message: "Mode not found" })
          continue
        }
        onProgress(mode.name, "migrating")
        agentConfig[slug] = convertCustomMode(mode)
        results.push({ item: mode.name, category: "customMode", status: "success" })
        onProgress(mode.name, "success")
      }
    }
    if (Object.keys(agentConfig).length > 0) {
      await client.global.config.update({ config: { agent: agentConfig } })
    }
  }

  if (selections.sessions?.length) {
    for (const id of selections.sessions) {
      onProgress(id, "migrating")
      const result = await migrateSession(id, context, client)
      const reason = result.ok ? "Session migrated" : result.message
      results.push({
        item: id,
        category: "session",
        status: result.ok ? "success" : "error",
        message: reason,
      })
      onProgress(id, result.ok ? "success" : "error", reason)
    }
  }

  // Migrate default model
  if (selections.defaultModel && profiles) {
    const activeName = profiles.currentApiConfigName
    const active = profiles.apiConfigs[activeName]
    if (active) {
      onProgress("Default model", "migrating")
      const result = await migrateDefaultModel(active, client)
      results.push(result)
      onProgress("Default model", result.status, result.message)
    }
  }

  // Migrate auto-approval settings (granular, each selected item is independent)
  const apSel = selections.settings.autoApproval
  if (
    apSel.commandRules ||
    apSel.readPermission ||
    apSel.writePermission ||
    apSel.executePermission ||
    apSel.mcpPermission ||
    apSel.taskPermission
  ) {
    const apItems = await migrateAutoApproval(legacySettings, apSel, client, onProgress)
    results.push(...apItems)
  }

  // Migrate language setting
  if (selections.settings.language && legacySettings.language) {
    onProgress("Language preference", "migrating")
    const result = await migrateLanguage(legacySettings.language)
    results.push(result)
    onProgress("Language preference", result.status, result.message)
  }

  // Migrate autocomplete settings
  if (selections.settings.autocomplete && legacySettings.autocomplete) {
    onProgress("Autocomplete settings", "migrating")
    const result = await migrateAutocomplete(legacySettings.autocomplete)
    results.push(result)
    onProgress("Autocomplete settings", result.status, result.message)
  }

  return results
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Removes legacy data from SecretStorage, globalState, and VS Code settings.
 */
export async function clearLegacyData(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(SECRET_KEY)
  await context.secrets.delete(CODEX_OAUTH_SECRET_KEY)

  const legacyStateKeys = [
    "kilo-code.allowedCommands",
    "kilo-code.deniedCommands",
    "kilo-code.autoApprovalEnabled",
    "kilo-code.fuzzyMatchThreshold",
    "kilo-code.diffEnabled",
    "kilo-code.language",
    "kilo-code.customModes",
    "kilo-code.firstInstallCompleted",
    "kilo-code.telemetrySetting",
    "ghostServiceSettings",
    // Fine-grained auto-approval keys (no prefix in legacy globalState)
    "alwaysAllowReadOnly",
    "alwaysAllowReadOnlyOutsideWorkspace",
    "alwaysAllowWrite",
    "alwaysAllowWriteOutsideWorkspace",
    "alwaysAllowWriteProtected",
    "alwaysAllowDelete",
    "alwaysAllowExecute",
    "alwaysAllowBrowser",
    "alwaysAllowMcp",
    "alwaysAllowModeSwitch",
    "alwaysAllowSubtasks",
    "alwaysAllowFollowupQuestions",
    "followupAutoApproveTimeoutMs",
  ]
  for (const key of legacyStateKeys) {
    await context.globalState.update(key, undefined)
  }

  // Clear legacy VS Code settings registered under the "kilo-code" configuration scope.
  // These are set via the old extension's contributes.configuration and persist in the
  // user's settings.json even after the extension is uninstalled.
  const legacyVscodeSettings = [
    "allowedCommands",
    "deniedCommands",
    "commandExecutionTimeout",
    "commandTimeoutAllowlist",
    "preventCompletionWithOpenTodos",
    "vsCodeLmModelSelector",
    "customStoragePath",
    "enableCodeActions",
    "autoImportSettingsPath",
    "maximumIndexedFilesForFileSearch",
    "useAgentRules",
    "apiRequestTimeout",
    "newTaskRequireTodos",
    "enableSettingsSync",
    "toolProtocol",
    "debug",
  ]
  const cfg = vscode.workspace.getConfiguration("kilo-code")
  for (const key of legacyVscodeSettings) {
    await cfg.update(key, undefined, vscode.ConfigurationTarget.Global)
  }
}

// ---------------------------------------------------------------------------
// Internal — provider migration
// ---------------------------------------------------------------------------

async function migrateProvider(
  context: vscode.ExtensionContext,
  profileName: string,
  settings: LegacyProviderSettings,
  client: KiloClient,
): Promise<MigrationResultItem> {
  const provider = settings.apiProvider
  if (!provider) {
    return { item: profileName, category: "provider", status: "error", message: "No provider type found" }
  }

  if (UNSUPPORTED_PROVIDERS.has(provider)) {
    return {
      item: profileName,
      category: "provider",
      status: "warning",
      message: `Provider "${provider}" is not supported in the new version`,
    }
  }

  const mapping = PROVIDER_MAP[provider]
  if (!mapping) {
    return {
      item: profileName,
      category: "provider",
      status: "warning",
      message: `Unknown provider "${provider}"`,
    }
  }

  // OAuth providers store credentials in a separate VS Code secret
  if (mapping.oauthSecretKey) {
    const creds = await readOAuthCredentials(context, mapping.oauthSecretKey)
    if (!creds) {
      return { item: profileName, category: "provider", status: "warning", message: "No OAuth credentials found" }
    }
    await client.auth.set({ providerID: mapping.id, auth: { type: "oauth" as const, ...creds } })
    return { item: profileName, category: "provider", status: "success" }
  }

  // Providers that use env/ADC-based auth (e.g. Vertex AI) — skip auth.set, only migrate config options
  if (mapping.skipAuth) {
    await migrateConfigFields(mapping, settings, client)
    // Warn users who had inline service account credentials — the CLI uses ADC only
    const hadCredentials = Boolean(settings.vertexJsonCredentials ?? settings.vertexKeyFile)
    return {
      item: profileName,
      category: "provider",
      status: hadCredentials ? "warning" : "success",
      message: hadCredentials
        ? "Project and location migrated. The new CLI uses Application Default Credentials — set GOOGLE_APPLICATION_CREDENTIALS or run 'gcloud auth application-default login'"
        : undefined,
    }
  }

  const apiKey = settings[mapping.key] as string | undefined
  if (!apiKey) {
    return { item: profileName, category: "provider", status: "warning", message: "No API key found in profile" }
  }

  // The profile endpoint requires type:"oauth". The legacy extension stored the same Kilo
  // API token — write it in the OAuth format the new extension expects (matching device-auth:
  // access + refresh + 1-year expiry).
  if (mapping.id === "kilo") {
    const org = mapping.organizationIdField ? (settings[mapping.organizationIdField] as string | undefined) : undefined
    await client.auth.set({
      providerID: "kilo",
      auth: {
        type: "oauth" as const,
        access: apiKey,
        refresh: apiKey,
        expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
        accountId: org,
      },
    })
    return { item: profileName, category: "provider", status: "success" }
  }

  // For providers that support an organization ID (e.g. Kilo Gateway), migrate using OAuth
  // auth so the CLI can read accountId for org-scoped API requests.
  const organizationId = mapping.organizationIdField
    ? (settings[mapping.organizationIdField] as string | undefined)
    : undefined

  const auth = organizationId
    ? { type: "oauth" as const, access: apiKey, refresh: "", expires: 0, accountId: organizationId }
    : { type: "api" as const, key: apiKey }

  await client.auth.set({ providerID: mapping.id, auth })

  // If a custom base URL is configured, also persist it to the backend config
  if (mapping.urlField) {
    const url = settings[mapping.urlField] as string | undefined
    if (url) {
      await client.global.config.update({
        config: { provider: { [mapping.id]: { options: { apiKey, baseURL: url } } } },
      })
    }
  }

  await migrateConfigFields(mapping, settings, client)

  return { item: profileName, category: "provider", status: "success" }
}

async function migrateConfigFields(
  mapping: ProviderMapping,
  settings: LegacyProviderSettings,
  client: KiloClient,
): Promise<void> {
  if (!mapping.configFields?.length) return
  const opts: Record<string, string> = {}
  for (const { from, option } of mapping.configFields) {
    const val = settings[from] as string | undefined
    if (val) opts[option] = val
  }
  if (Object.keys(opts).length > 0) {
    await client.global.config.update({
      config: { provider: { [mapping.id]: { options: opts } } },
    })
  }
}

async function migrateDefaultModel(settings: LegacyProviderSettings, client: KiloClient): Promise<MigrationResultItem> {
  const provider = settings.apiProvider
  if (!provider) {
    return { item: "Default model", category: "defaultModel", status: "error", message: "No provider type found" }
  }

  const mapping = PROVIDER_MAP[provider]
  if (!mapping) {
    return {
      item: "Default model",
      category: "defaultModel",
      status: "warning",
      message: `Provider "${provider}" is not supported in the new version`,
    }
  }

  const modelField = mapping.modelField ?? "apiModelId"
  const modelId = settings[modelField] as string | undefined
  if (!modelId) {
    return { item: "Default model", category: "defaultModel", status: "warning", message: "No model ID found" }
  }

  await client.global.config.update({ config: { model: `${mapping.id}/${modelId}` } })
  return { item: "Default model", category: "defaultModel", status: "success" }
}

// ---------------------------------------------------------------------------
// Internal — settings migration (auto-approval, language)
// ---------------------------------------------------------------------------

async function migrateAutoApproval(
  settings: LegacySettings,
  sel: MigrationAutoApprovalSelections,
  client: KiloClient,
  onProgress: ProgressCallback,
): Promise<MigrationResultItem[]> {
  const {
    autoApprovalEnabled,
    allowedCommands,
    deniedCommands,
    alwaysAllowReadOnly,
    alwaysAllowReadOnlyOutsideWorkspace,
    alwaysAllowWrite,
    alwaysAllowExecute,
    alwaysAllowMcp,
    alwaysAllowModeSwitch,
    alwaysAllowSubtasks,
  } = settings

  // The master toggle acts as a global fallback for unspecified tools.
  const fallback: "allow" | "ask" = autoApprovalEnabled === true ? "allow" : "ask"

  const results: MigrationResultItem[] = []
  // We collect all permission updates and apply them in one call at the end.
  const permission: PermissionConfig = {}
  // Track if global "allow" was already written so we skip the per-tool object update
  // that would otherwise overwrite it with a narrower permission set.
  let globalAllowApplied = false

  // Command rules: master toggle + allowedCommands + deniedCommands
  if (sel.commandRules) {
    const label = "Command rules"
    onProgress(label, "migrating")
    const hasCommandLists = Boolean(allowedCommands?.length || deniedCommands?.length)
    if (autoApprovalEnabled === true && !hasCommandLists) {
      // Global allow with no specific command rules — apply immediately using the scalar form.
      // PermissionConfig is "allow" | "ask" | "deny" | { read?: ..., ... }, so a global allow
      // must be the scalar string, not an object with a "*" key.
      await client.global.config.update({ config: { permission: "allow" } })
      globalAllowApplied = true
    } else if (hasCommandLists) {
      const bashRules: PermissionObjectConfig = {}
      // The legacy system matched commands as longest prefix (e.g. "npm run" matched "npm run dev").
      // The new CLI uses Wildcard.match with full command text anchored to ^ and $, so "npm run"
      // would only match the literal string "npm run". Appending " *" approximates prefix semantics:
      // Wildcard.match treats trailing " *" as "( .*)?", matching with or without arguments.
      for (const cmd of allowedCommands ?? []) {
        bashRules[cmd.trimEnd() + " *"] = "allow"
      }
      for (const cmd of deniedCommands ?? []) {
        bashRules[cmd.trimEnd() + " *"] = "deny"
      }
      // alwaysAllowExecute=false must override the master toggle
      bashRules["*"] = alwaysAllowExecute === true ? "allow" : alwaysAllowExecute === false ? "ask" : fallback
      permission.bash = bashRules
    }
    results.push({ item: label, category: "settings", status: "success" })
    onProgress(label, "success")
  }

  // Read permissions
  if (sel.readPermission) {
    const label = "Read permission"
    onProgress(label, "migrating")
    if (alwaysAllowReadOnly === true) {
      permission.read = "allow"
      permission.glob = "allow"
      permission.grep = "allow"
      permission.list = "allow"
    } else if (alwaysAllowReadOnly === false) {
      permission.read = "ask"
    }
    if (alwaysAllowReadOnlyOutsideWorkspace === true) {
      permission.external_directory = "allow"
    } else if (alwaysAllowReadOnlyOutsideWorkspace === false) {
      permission.external_directory = "ask"
    }
    results.push({ item: label, category: "settings", status: "success" })
    onProgress(label, "success")
  }

  // Write permissions
  if (sel.writePermission) {
    const label = "Write permission"
    onProgress(label, "migrating")
    if (alwaysAllowWrite === true) {
      permission.edit = "allow"
    } else if (alwaysAllowWrite === false) {
      permission.edit = "ask"
    }
    results.push({ item: label, category: "settings", status: "success" })
    onProgress(label, "success")
  }

  // Execute permissions (bash only — command lists handled above in commandRules)
  if (sel.executePermission && !sel.commandRules) {
    const label = "Execute permission"
    onProgress(label, "migrating")
    if (alwaysAllowExecute === true) {
      permission.bash = "allow"
    } else if (alwaysAllowExecute === false) {
      permission.bash = "ask"
    }
    results.push({ item: label, category: "settings", status: "success" })
    onProgress(label, "success")
  } else if (sel.executePermission) {
    // executePermission selected together with commandRules — bash rules already built above,
    // just record the result item
    results.push({ item: "Execute permission", category: "settings", status: "success" })
  }

  // MCP / skill permissions
  if (sel.mcpPermission) {
    const label = "MCP permission"
    onProgress(label, "migrating")
    if (alwaysAllowMcp === true) {
      permission.skill = "allow"
    } else if (alwaysAllowMcp === false) {
      permission.skill = "ask"
    }
    results.push({ item: label, category: "settings", status: "success" })
    onProgress(label, "success")
  }

  // Task / subtask permissions
  if (sel.taskPermission) {
    const label = "Task permission"
    onProgress(label, "migrating")
    if (alwaysAllowModeSwitch === true || alwaysAllowSubtasks === true) {
      permission.task = "allow"
    } else if (alwaysAllowModeSwitch === false && alwaysAllowSubtasks === false) {
      permission.task = "ask"
    }
    results.push({ item: label, category: "settings", status: "success" })
    onProgress(label, "success")
  }

  // Only write the per-tool object form if global allow wasn't already applied —
  // writing an object after "allow" would narrow permissions to only the listed tools.
  if (!globalAllowApplied && Object.keys(permission).length > 0) {
    await client.global.config.update({ config: { permission } })
  }

  return results
}

async function migrateAutocomplete(settings: LegacyAutocompleteSettings): Promise<MigrationResultItem> {
  try {
    const config = vscode.workspace.getConfiguration("kilo-code.new.autocomplete")
    if (settings.enableAutoTrigger !== undefined) {
      await config.update("enableAutoTrigger", settings.enableAutoTrigger, vscode.ConfigurationTarget.Global)
    }
    if (settings.enableSmartInlineTaskKeybinding !== undefined) {
      await config.update(
        "enableSmartInlineTaskKeybinding",
        settings.enableSmartInlineTaskKeybinding,
        vscode.ConfigurationTarget.Global,
      )
    }
    if (settings.enableChatAutocomplete !== undefined) {
      await config.update("enableChatAutocomplete", settings.enableChatAutocomplete, vscode.ConfigurationTarget.Global)
    }
    return { item: "Autocomplete settings", category: "settings", status: "success" }
  } catch (err) {
    return {
      item: "Autocomplete settings",
      category: "settings",
      status: "error",
      message: getMigrationErrorMessage(err),
    }
  }
}

// Maps legacy locale codes to their new-extension equivalents.
// Legacy used IETF BCP-47 tags (zh-CN, pt-BR) while the new extension uses short codes.
// Entries absent from this map have no equivalent in the new extension.
const LEGACY_LOCALE_MAP: Record<string, string> = {
  // Direct matches
  en: "en",
  de: "de",
  es: "es",
  fr: "fr",
  ja: "ja",
  ko: "ko",
  pl: "pl",
  ru: "ru",
  ar: "ar",
  th: "th",
  da: "da",
  no: "no",
  bs: "bs",
  // Format changes
  "zh-CN": "zh",
  "zh-TW": "zht",
  "pt-BR": "br",
}

async function migrateLanguage(language: string): Promise<MigrationResultItem> {
  const mapped = LEGACY_LOCALE_MAP[language]
  if (!mapped) {
    return {
      item: "Language preference",
      category: "settings",
      status: "warning",
      message: `Language "${language}" is not supported in the new version`,
    }
  }
  try {
    const config = vscode.workspace.getConfiguration("kilo-code.new")
    await config.update("language", mapped, vscode.ConfigurationTarget.Global)
    return { item: "Language preference", category: "settings", status: "success" }
  } catch (err) {
    return {
      item: "Language preference",
      category: "settings",
      status: "error",
      message: getMigrationErrorMessage(err),
    }
  }
}

// ---------------------------------------------------------------------------
// Internal — MCP conversion (legacy → McpServerConfig)
// ---------------------------------------------------------------------------

function convertMcpServer(server: LegacyMcpServer): McpLocalConfig | McpRemoteConfig | null {
  const enabled = server.disabled ? { enabled: false as const } : {}
  // Legacy stores timeout in seconds, the new config expects milliseconds
  const timeout = server.timeout !== undefined ? server.timeout * 1000 : undefined
  if (server.type === "sse" || server.type === "streamable-http") {
    if (!server.url) return null
    return {
      type: "remote",
      url: server.url,
      headers: server.headers,
      ...(timeout !== undefined && { timeout }),
      ...enabled,
    }
  }
  // Default: stdio
  if (!server.command) return null
  const command = server.args ? [server.command, ...server.args] : [server.command]
  return {
    type: "local",
    command,
    environment: server.env,
    ...(timeout !== undefined && { timeout }),
    ...enabled,
  }
}

// ---------------------------------------------------------------------------
// Internal — custom mode conversion (legacy → AgentConfig)
// ---------------------------------------------------------------------------

// Group name → CLI permission key (mirrors ModesMigrator.convertPermissions in the CLI)
const GROUP_TO_PERMISSION: Record<string, string> = {
  read: "read",
  edit: "edit",
  browser: "bash",
  command: "bash",
  mcp: "skill",
}
const ALL_MODE_PERMISSIONS = ["read", "edit", "bash", "skill"]

function convertCustomModePermissions(groups: LegacyCustomMode["groups"]): PermissionConfig {
  const permission: Record<string, unknown> = {}
  const allowed = new Set<string>()

  for (const group of groups) {
    const groupName = typeof group === "string" ? group : group[0]
    const groupConfig = typeof group === "string" ? undefined : group[1]
    const permKey = GROUP_TO_PERMISSION[groupName] ?? groupName
    allowed.add(permKey)

    const newValue = groupConfig?.fileRegex ? { [groupConfig.fileRegex]: "allow", "*": "deny" } : "allow"

    // Multiple legacy groups can map to the same permission key (browser + command → bash).
    // Merge rules so neither overwrites the other:
    //   - if either side is "allow", the key is fully allowed
    //   - if both sides are objects, merge their pattern maps
    const existing = permission[permKey]
    if (existing === undefined) {
      permission[permKey] = newValue
    } else if (existing === "allow" || newValue === "allow") {
      permission[permKey] = "allow"
    } else if (typeof existing === "object" && typeof newValue === "object") {
      permission[permKey] = { ...existing, ...newValue }
    } else {
      permission[permKey] = newValue
    }
  }

  // Explicitly deny permissions not in the groups (CLI defaults to "ask" for missing ones)
  for (const perm of ALL_MODE_PERMISSIONS) {
    if (!allowed.has(perm)) {
      permission[perm] = "deny"
    }
  }

  return permission as PermissionConfig
}

function convertCustomMode(mode: LegacyCustomMode): AgentConfig {
  const parts = [mode.roleDefinition]
  if (mode.customInstructions?.trim()) {
    parts.push(
      [
        "USER'S CUSTOM INSTRUCTIONS",
        "",
        "The following additional instructions are provided by the user, and should be followed to the best of your ability.",
        "",
        `Mode-specific Instructions:\n${mode.customInstructions.trim()}`,
      ].join("\n"),
    )
  }
  return {
    mode: "primary",
    description: mode.description ?? mode.whenToUse ?? mode.roleDefinition?.slice(0, 120),
    prompt: parts.filter(Boolean).join("\n\n"),
    permission: convertCustomModePermissions(mode.groups),
  }
}

// ---------------------------------------------------------------------------
// Internal — OAuth credential helpers
// ---------------------------------------------------------------------------

/**
 * Reads OAuth credentials stored in a separate VS Code secret (e.g. openai-codex-oauth-credentials).
 * Returns the fields needed by the CLI's Auth.Oauth type, or null if absent/malformed.
 */
async function readOAuthCredentials(
  context: vscode.ExtensionContext,
  secretKey: string,
): Promise<{ access: string; refresh: string; expires: number; accountId?: string } | null> {
  const raw = await context.secrets.get(secretKey)
  if (!raw) return null
  const parsed = (() => {
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return null
    }
  })()
  if (!parsed) return null
  const access = parsed.access_token as string | undefined
  const refresh = parsed.refresh_token as string | undefined
  const expires = parsed.expires as number | undefined
  if (!access || !refresh || expires === undefined) return null
  return { access, refresh, expires, accountId: parsed.accountId as string | undefined }
}

// ---------------------------------------------------------------------------
// Internal — reading legacy data from storage
// ---------------------------------------------------------------------------

async function readLegacyProviderProfiles(context: vscode.ExtensionContext): Promise<LegacyProviderProfiles | null> {
  const raw = await context.secrets.get(SECRET_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed.apiConfigs || typeof parsed.apiConfigs !== "object") return null
    return parsed as unknown as LegacyProviderProfiles
  } catch {
    return null
  }
}

async function readLegacyMcpSettings(context: vscode.ExtensionContext): Promise<LegacyMcpSettings | null> {
  const filePath = vscode.Uri.joinPath(context.globalStorageUri, "settings", "mcp_settings.json")
  const bytes = await vscode.workspace.fs.readFile(filePath).then(
    (b) => b,
    () => null,
  )
  if (!bytes) return null
  try {
    const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as Record<string, unknown>
    if (!parsed.mcpServers || typeof parsed.mcpServers !== "object") return null
    return parsed as unknown as LegacyMcpSettings
  } catch {
    return null
  }
}

async function readLegacyCustomModes(context: vscode.ExtensionContext): Promise<LegacyCustomMode[] | null> {
  const filePath = vscode.Uri.joinPath(context.globalStorageUri, "settings", "custom_modes.yaml")
  const bytes = await vscode.workspace.fs.readFile(filePath).then(
    (b) => b,
    () => null,
  )
  if (!bytes) return null
  const text = Buffer.from(bytes).toString("utf8")
  return parseCustomModesYaml(text)
}

function readLegacyCustomModePrompts(context: vscode.ExtensionContext): Record<string, LegacyPromptComponent> | null {
  return context.globalState.get<Record<string, LegacyPromptComponent>>("customModePrompts") ?? null
}

function readLegacySettings(context: vscode.ExtensionContext): LegacySettings {
  const raw = context.globalState.get<Record<string, unknown>>("ghostServiceSettings")
  const autocomplete: LegacyAutocompleteSettings | undefined =
    raw && typeof raw === "object"
      ? {
          enableAutoTrigger: raw.enableAutoTrigger as boolean | undefined,
          enableSmartInlineTaskKeybinding: raw.enableSmartInlineTaskKeybinding as boolean | undefined,
          enableChatAutocomplete: raw.enableChatAutocomplete as boolean | undefined,
        }
      : undefined

  return {
    autoApprovalEnabled: context.globalState.get<boolean>("kilo-code.autoApprovalEnabled"),
    allowedCommands: context.globalState.get<string[]>("kilo-code.allowedCommands"),
    deniedCommands: context.globalState.get<string[]>("kilo-code.deniedCommands"),
    // Fine-grained auto-approval — stored without prefix in legacy globalState
    alwaysAllowReadOnly: context.globalState.get<boolean>("alwaysAllowReadOnly"),
    alwaysAllowReadOnlyOutsideWorkspace: context.globalState.get<boolean>("alwaysAllowReadOnlyOutsideWorkspace"),
    alwaysAllowWrite: context.globalState.get<boolean>("alwaysAllowWrite"),
    alwaysAllowExecute: context.globalState.get<boolean>("alwaysAllowExecute"),
    alwaysAllowMcp: context.globalState.get<boolean>("alwaysAllowMcp"),
    alwaysAllowModeSwitch: context.globalState.get<boolean>("alwaysAllowModeSwitch"),
    alwaysAllowSubtasks: context.globalState.get<boolean>("alwaysAllowSubtasks"),
    language: context.globalState.get<string>("kilo-code.language"),
    autocomplete: hasAutocompleteData(autocomplete) ? autocomplete : undefined,
  }
}

function hasAutocompleteData(s: LegacyAutocompleteSettings | undefined): s is LegacyAutocompleteSettings {
  if (!s) return false
  return (
    s.enableAutoTrigger !== undefined ||
    s.enableSmartInlineTaskKeybinding !== undefined ||
    s.enableChatAutocomplete !== undefined
  )
}

/**
 * Minimal YAML parser for the custom_modes.yaml format.
 * Tries JSON first (some legacy versions stored JSON), then parses the simple
 * YAML structure manually to avoid a runtime dependency on a YAML library.
 */
// Strip surrounding single or double quotes from a YAML scalar value
function stripYamlQuotes(value: string): string {
  return value.replace(/^(['"])(.*)\1$/, "$2")
}

function parseCustomModesYaml(text: string): LegacyCustomMode[] | null {
  // Try JSON first
  const jsonResult = (() => {
    try {
      const parsed = JSON.parse(text) as { customModes?: LegacyCustomMode[] }
      return parsed.customModes ?? null
    } catch {
      return null
    }
  })()
  if (jsonResult) return jsonResult

  // Parse the simple YAML shape:
  //   customModes:
  //     - slug: xxx
  //       name: xxx
  //       roleDefinition: |
  //         ...
  //       groups:
  //         - read
  const modes: LegacyCustomMode[] = []
  const lines = text.split("\n")
  let inModes = false
  let current: Partial<LegacyCustomMode> | null = null
  // Track which block scalar field is currently being collected
  let blockField: "roleDefinition" | "customInstructions" | null = null
  let inGroups = false
  let blockLines: string[] = []

  const flush = () => {
    if (current?.slug && current?.name) {
      if (blockField && blockLines.length > 0) {
        current[blockField] = blockLines.join("\n").trim()
      }
      modes.push({ groups: [], ...current } as LegacyCustomMode)
    }
    current = null
    blockField = null
    inGroups = false
    blockLines = []
  }

  for (const rawLine of lines) {
    if (!inModes) {
      if (rawLine.trim() === "customModes:") inModes = true
      continue
    }

    if (/^  - slug: /.test(rawLine)) {
      flush()
      current = { slug: stripYamlQuotes(rawLine.replace(/^  - slug: /, "").trim()), groups: [] }
      continue
    }

    if (!current) continue

    if (/^    name: /.test(rawLine)) {
      current.name = stripYamlQuotes(rawLine.replace(/^    name: /, "").trim())
      continue
    }

    // Block scalar fields (roleDefinition, customInstructions) with | or >
    const blockMatch = rawLine.match(/^    (roleDefinition|customInstructions): [|>]/)
    if (blockMatch) {
      // Flush any previously open block
      if (blockField && blockLines.length > 0) {
        current[blockField] = blockLines.join("\n").trim()
      }
      blockField = blockMatch[1] as "roleDefinition" | "customInstructions"
      inGroups = false
      blockLines = []
      continue
    }

    // Single-line scalar fields
    if (/^    roleDefinition: /.test(rawLine) && !blockField) {
      current.roleDefinition = stripYamlQuotes(rawLine.replace(/^    roleDefinition: /, "").trim())
      continue
    }

    if (/^    customInstructions: /.test(rawLine) && !blockField) {
      current.customInstructions = stripYamlQuotes(rawLine.replace(/^    customInstructions: /, "").trim())
      continue
    }

    if (/^    whenToUse: /.test(rawLine) && !blockField) {
      current.whenToUse = stripYamlQuotes(rawLine.replace(/^    whenToUse: /, "").trim())
      continue
    }

    if (/^    description: /.test(rawLine) && !blockField) {
      current.description = stripYamlQuotes(rawLine.replace(/^    description: /, "").trim())
      continue
    }

    // Continuation lines of an open block scalar
    if (blockField) {
      if (/^      /.test(rawLine)) {
        blockLines.push(rawLine.replace(/^      /, ""))
        continue
      }
      // Block ended — flush and fall through to process this line
      current[blockField] = blockLines.join("\n").trim()
      blockField = null
      blockLines = []
    }

    if (/^    groups:/.test(rawLine)) {
      inGroups = true
      current.groups = []
      continue
    }

    if (inGroups && /^      - /.test(rawLine)) {
      const group = stripYamlQuotes(rawLine.replace(/^      - /, "").trim())
      current.groups = [...(current.groups ?? []), group]
      continue
    }

    if (inGroups && !/^      /.test(rawLine)) {
      inGroups = false
    }
  }

  flush()
  return modes.length > 0 ? modes : null
}

// ---------------------------------------------------------------------------
// Internal — building display lists for the wizard
// ---------------------------------------------------------------------------

function buildProviderList(
  profiles: LegacyProviderProfiles | null,
  oauthProviders: Set<string>,
): MigrationProviderInfo[] {
  if (!profiles?.apiConfigs) return []

  return Object.entries(profiles.apiConfigs).map(([profileName, settings]) => {
    const provider = settings.apiProvider ?? "unknown"
    const mapping = PROVIDER_MAP[provider]
    const unsupported = UNSUPPORTED_PROVIDERS.has(provider)

    const modelField = mapping?.modelField ?? "apiModelId"
    const model = settings[modelField] as string | undefined

    const hasApiKey = mapping?.oauthSecretKey
      ? oauthProviders.has(provider)
      : mapping?.skipAuth
        ? (mapping.configFields?.some((f) => Boolean(settings[f.from])) ?? false)
        : mapping
          ? Boolean(settings[mapping.key])
          : false

    return {
      profileName,
      provider,
      model,
      hasApiKey,
      supported: Boolean(mapping) && !unsupported,
      newProviderName: mapping?.name,
    }
  })
}

function buildMcpServerList(settings: LegacyMcpSettings | null): MigrationMcpServerInfo[] {
  if (!settings?.mcpServers) return []
  return Object.entries(settings.mcpServers).map(([name, server]) => ({
    name,
    type: server.type ?? "stdio",
    disabled: server.disabled,
  }))
}

/** @internal — exported for testing only */
export function buildCustomModeList(
  modes: LegacyCustomMode[] | null,
  prompts: Record<string, LegacyPromptComponent> | null,
): MigrationCustomModeInfo[] {
  const result: MigrationCustomModeInfo[] = []

  // Non-native custom modes (existing behavior)
  if (modes) {
    for (const m of modes) {
      if (!DEFAULT_MODE_SLUGS.has(m.slug)) {
        result.push({ name: m.name, slug: m.slug })
      }
    }
  }

  // Modified native modes — detect user modifications and offer migration under a new slug
  for (const slug of DEFAULT_MODE_SLUGS) {
    const defaults = NATIVE_MODE_DEFAULTS[slug]
    if (!defaults) continue // "build" has no legacy defaults

    const yaml = modes?.find((m) => m.slug === slug)
    const prompt = prompts?.[slug]

    if (!isNativeModeModified(yaml, prompt, defaults)) continue

    const name = yaml?.name ?? defaults.name
    result.push({ name: `${name} (Custom)`, slug: `${slug}-custom`, nativeSlug: slug })
  }

  return result
}

/**
 * Checks whether a native mode has been meaningfully modified from its defaults.
 * A full YAML override always counts as modified. For customModePrompts, we compare
 * each field against the known default and only count it if it actually differs.
 * @internal — exported for testing only
 */
export function isNativeModeModified(
  yaml: LegacyCustomMode | undefined,
  prompt: LegacyPromptComponent | undefined,
  defaults: { roleDefinition: string; customInstructions?: string; whenToUse?: string; description?: string },
): boolean {
  if (yaml) return true
  if (!prompt) return false

  if (prompt.roleDefinition && prompt.roleDefinition !== defaults.roleDefinition) return true
  if (prompt.customInstructions && prompt.customInstructions !== (defaults.customInstructions ?? "")) return true
  if (prompt.whenToUse && prompt.whenToUse !== (defaults.whenToUse ?? "")) return true
  if (prompt.description && prompt.description !== (defaults.description ?? "")) return true

  return false
}

/**
 * Builds a merged LegacyCustomMode for a modified native mode by combining the YAML
 * custom mode (if any) with customModePrompts overrides. When only prompts exist, the
 * native defaults provide the base structure (name, groups).
 * @internal — exported for testing only
 */
export function buildMergedNativeMode(
  yaml: LegacyCustomMode | undefined,
  prompt: LegacyPromptComponent | undefined,
  slug: string,
): LegacyCustomMode | null {
  const defaults = NATIVE_MODE_DEFAULTS[slug]
  if (!defaults) return null

  const base: LegacyCustomMode = yaml
    ? { ...yaml }
    : {
        slug,
        name: defaults.name,
        roleDefinition: defaults.roleDefinition,
        customInstructions: defaults.customInstructions,
        whenToUse: defaults.whenToUse,
        description: defaults.description,
        groups: [...defaults.groups],
      }

  // Overlay customModePrompts on top (matching legacy runtime behavior)
  if (prompt) {
    if (prompt.roleDefinition) base.roleDefinition = prompt.roleDefinition
    if (prompt.customInstructions) base.customInstructions = prompt.customInstructions
    if (prompt.whenToUse) base.whenToUse = prompt.whenToUse
    if (prompt.description) base.description = prompt.description
  }

  return base
}

function resolveDefaultModel(
  profiles: LegacyProviderProfiles | null,
  oauthProviders: Set<string>,
): { provider: string; model: string } | undefined {
  if (!profiles?.currentApiConfigName) return undefined
  const active = profiles.apiConfigs[profiles.currentApiConfigName]
  if (!active?.apiProvider) return undefined
  const mapping = PROVIDER_MAP[active.apiProvider]
  if (!mapping) return undefined
  // If the active profile requires OAuth credentials (e.g. openai-codex) but they are
  // unavailable, do not offer default-model migration — it would write a broken reference.
  if (mapping.oauthSecretKey && !oauthProviders.has(active.apiProvider)) return undefined
  const modelField = mapping.modelField ?? "apiModelId"
  const model = active[modelField] as string | undefined
  if (!model) return undefined
  return { provider: mapping.name, model }
}
