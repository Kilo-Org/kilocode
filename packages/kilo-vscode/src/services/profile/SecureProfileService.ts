import * as vscode from "vscode"
import { KiloLogger } from "../KiloLogger"

/**
 * SecureProfileService — unified secret/profile manager
 *
 * Enforces strict split between secrets (encrypted) and non-secret profile data.
 *
 * Storage map:
 *   • context.secrets → API keys, SSH passwords, tokens, sensitive endpoints
 *   • context.globalState → provider choices, role matrix, voice prefs (cross-workspace)
 *   • context.workspaceState → project-specific settings, discovery cache
 *   • VS Code config → non-sensitive endpoints, labels, UI preferences
 *
 * Usage:
 *   const profile = new SecureProfileService(context)
 *   await profile.setApiKey("claude", "sk-ant-...")
 *   const key = await profile.getApiKey("claude")  // returns undefined if missing
 *   const masked = await profile.getMaskedApiKey("claude")  // returns "sk-a...****xyz1"
 */

// ─── Types ──────────────────────────────────────────────

export interface VoicePreference {
  voiceId: string
  favorite: boolean
  pitch?: number
  rate?: number
  lastUsed?: number
}

export interface VoicePreferences {
  preferredVoiceId?: string
  favorites: string[]
  perVoiceSettings: Record<string, VoicePreference>
}

export interface RoutingPrefs {
  mode: "auto" | "manual"
  privacyMode: "local_preferred" | "cloud_ok"
  costThreshold: number
  preferredProviders: Record<string, string>  // role → providerId
}

export interface MigrationReport {
  migratedKeys: string[]
  migratedProfiles: string[]
  skipped: string[]
  errors: string[]
}

// Keys under which the service stores state (avoid collision with other code)
const GLOBAL_KEYS = {
  voicePrefs: "kilocode.profile.voices",
  routingPrefs: "kilocode.profile.routing",
  workstationProfile: "kilocode.profile.workstation",
  providerChoices: "kilocode.profile.providerChoices",
  onboardingComplete: "kilocode.profile.onboardingComplete",
} as const

const WORKSPACE_KEYS = {
  discoveryCache: "kilocode.profile.discoveryCache",
  lastSSHImport: "kilocode.profile.lastSSHImport",
  sshProfiles: "kilocode.profile.sshProfiles",
} as const

const SECRET_PREFIXES = {
  apiKey: "kilocode.secret.apiKey.",
  sshPassword: "kilocode.secret.sshPassword.",
  token: "kilocode.secret.token.",
  endpoint: "kilocode.secret.endpoint.",
} as const

// ─── Service ────────────────────────────────────────────

export class SecureProfileService implements vscode.Disposable {
  private readonly log = KiloLogger.for("SecureProfileService")
  private readonly secrets: vscode.SecretStorage
  private readonly globalState: vscode.Memento
  private readonly workspaceState: vscode.Memento

  constructor(private readonly context: vscode.ExtensionContext) {
    this.secrets = context.secrets
    this.globalState = context.globalState
    this.workspaceState = context.workspaceState
    this.log.info("SecureProfileService initialized")
  }

  // ─── Secrets: API Keys ─────────────────────────────────

  async setApiKey(provider: string, key: string): Promise<void> {
    if (!provider || !key) throw new Error("provider and key required")
    await this.secrets.store(SECRET_PREFIXES.apiKey + provider, key)
    this.log.info("API key stored", { provider })
  }

  async getApiKey(provider: string): Promise<string | undefined> {
    return this.secrets.get(SECRET_PREFIXES.apiKey + provider)
  }

  async deleteApiKey(provider: string): Promise<void> {
    await this.secrets.delete(SECRET_PREFIXES.apiKey + provider)
    this.log.info("API key deleted", { provider })
  }

  async hasApiKey(provider: string): Promise<boolean> {
    const key = await this.getApiKey(provider)
    return !!key && key.length > 0
  }

  /** Mask an API key for display — never returns the real value. */
  async getMaskedApiKey(provider: string): Promise<string> {
    const key = await this.getApiKey(provider)
    if (!key) return ""
    if (key.length <= 8) return "****"
    return `${key.slice(0, 4)}…${key.slice(-4)}`
  }

  // ─── Secrets: SSH passwords ───────────────────────────

  async setSshPassword(profileName: string, password: string): Promise<void> {
    if (!profileName || !password) throw new Error("profileName and password required")
    await this.secrets.store(SECRET_PREFIXES.sshPassword + profileName, password)
    this.log.info("SSH password stored", { profileName })
  }

  async getSshPassword(profileName: string): Promise<string | undefined> {
    return this.secrets.get(SECRET_PREFIXES.sshPassword + profileName)
  }

  async deleteSshPassword(profileName: string): Promise<void> {
    await this.secrets.delete(SECRET_PREFIXES.sshPassword + profileName)
    this.log.info("SSH password deleted", { profileName })
  }

  // ─── Secrets: Tokens (Hermes, Shiba, Azure TTS, etc) ──

  async setToken(service: string, token: string): Promise<void> {
    if (!service || !token) throw new Error("service and token required")
    await this.secrets.store(SECRET_PREFIXES.token + service, token)
    this.log.info("Token stored", { service })
  }

  async getToken(service: string): Promise<string | undefined> {
    return this.secrets.get(SECRET_PREFIXES.token + service)
  }

  async deleteToken(service: string): Promise<void> {
    await this.secrets.delete(SECRET_PREFIXES.token + service)
    this.log.info("Token deleted", { service })
  }

  // ─── Secrets: Sensitive endpoints ──────────────────────

  async setSensitiveEndpoint(name: string, url: string): Promise<void> {
    await this.secrets.store(SECRET_PREFIXES.endpoint + name, url)
  }

  async getSensitiveEndpoint(name: string): Promise<string | undefined> {
    return this.secrets.get(SECRET_PREFIXES.endpoint + name)
  }

  // ─── Non-secret: Provider choices (role → providerId) ─

  setProviderChoice(role: string, providerId: string): void {
    const current = this.getProviderChoices()
    current[role] = providerId
    void this.globalState.update(GLOBAL_KEYS.providerChoices, current)
    this.log.info("Provider choice updated", { role, providerId })
  }

  getProviderChoice(role: string): string | undefined {
    const choices = this.getProviderChoices()
    return choices[role]
  }

  getProviderChoices(): Record<string, string> {
    return this.globalState.get<Record<string, string>>(GLOBAL_KEYS.providerChoices, {})
  }

  // ─── Non-secret: Voice preferences ────────────────────

  setVoicePreferences(prefs: VoicePreferences): void {
    void this.globalState.update(GLOBAL_KEYS.voicePrefs, prefs)
  }

  getVoicePreferences(): VoicePreferences {
    return this.globalState.get<VoicePreferences>(GLOBAL_KEYS.voicePrefs, {
      favorites: [],
      perVoiceSettings: {},
    })
  }

  setVoiceFavorite(voiceId: string, favorite: boolean): void {
    const prefs = this.getVoicePreferences()
    if (favorite && !prefs.favorites.includes(voiceId)) {
      prefs.favorites.push(voiceId)
    } else if (!favorite) {
      prefs.favorites = prefs.favorites.filter((id) => id !== voiceId)
    }
    this.setVoicePreferences(prefs)
  }

  // ─── Non-secret: Routing preferences ──────────────────

  setRoutingPreferences(prefs: RoutingPrefs): void {
    void this.globalState.update(GLOBAL_KEYS.routingPrefs, prefs)
  }

  getRoutingPreferences(): RoutingPrefs {
    return this.globalState.get<RoutingPrefs>(GLOBAL_KEYS.routingPrefs, {
      mode: "auto",
      privacyMode: "cloud_ok",
      costThreshold: 10.0,
      preferredProviders: {},
    })
  }

  // ─── Non-secret: Workstation profile ──────────────────

  setWorkstationProfile(profile: unknown): void {
    void this.globalState.update(GLOBAL_KEYS.workstationProfile, profile)
  }

  getWorkstationProfile<T = unknown>(): T | undefined {
    return this.globalState.get<T>(GLOBAL_KEYS.workstationProfile)
  }

  // ─── Workspace state: Discovery cache ─────────────────

  setDiscoveryCache(result: unknown): void {
    void this.workspaceState.update(WORKSPACE_KEYS.discoveryCache, {
      result,
      cachedAt: Date.now(),
    })
  }

  getDiscoveryCache<T = unknown>(): { result: T; cachedAt: number } | undefined {
    return this.workspaceState.get(WORKSPACE_KEYS.discoveryCache)
  }

  // ─── Onboarding flag ──────────────────────────────────

  isOnboardingComplete(): boolean {
    return this.globalState.get<boolean>(GLOBAL_KEYS.onboardingComplete, false)
  }

  async markOnboardingComplete(): Promise<void> {
    await this.globalState.update(GLOBAL_KEYS.onboardingComplete, true)
    this.log.info("Onboarding marked complete")
  }

  async resetOnboarding(): Promise<void> {
    await this.globalState.update(GLOBAL_KEYS.onboardingComplete, false)
    this.log.info("Onboarding flag reset — wizard will open on next activation")
  }

  // ─── Migration ────────────────────────────────────────

  /**
   * Migrate secrets/profiles from legacy KV store (if any).
   * Safe to call multiple times — idempotent.
   */
  async migrateFromLegacy(): Promise<MigrationReport> {
    const report: MigrationReport = {
      migratedKeys: [],
      migratedProfiles: [],
      skipped: [],
      errors: [],
    }

    try {
      // Legacy keys that may exist from older versions
      const legacyApiKeyKeys = [
        "kilocode.claude.apiKey",
        "kilocode.minimax.apiKey",
        "kilocode.siliconflow.apiKey",
        "kilocode.openai.apiKey",
      ]

      for (const legacyKey of legacyApiKeyKeys) {
        try {
          const value = await this.secrets.get(legacyKey)
          if (value) {
            const provider = legacyKey.split(".")[1] ?? "unknown"
            const newKey = SECRET_PREFIXES.apiKey + provider
            const existing = await this.secrets.get(newKey)
            if (!existing) {
              await this.secrets.store(newKey, value)
              report.migratedKeys.push(provider)
              this.log.info("Migrated legacy API key", { provider })
            } else {
              report.skipped.push(provider)
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          report.errors.push(`${legacyKey}: ${msg}`)
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      report.errors.push(`migration: ${msg}`)
      this.log.error("Migration failed", err)
    }

    if (report.migratedKeys.length > 0) {
      this.log.info("Legacy migration completed", report)
    }
    return report
  }

  // ─── Dispose ──────────────────────────────────────────

  dispose(): void {
    // No resources to clean up — globalState/workspaceState are managed by VS Code
  }
}
