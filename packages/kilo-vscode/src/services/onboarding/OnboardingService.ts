/**
 * OnboardingService — orchestration around `OnboardingWizard`.
 *
 * Responsibilities:
 *   - Decide whether to show the wizard (`shouldShowWizard`).
 *   - Run the auto-detect → 5-question → connection-test pipeline.
 *   - Persist the result to `globalState` + `SecretStorage`.
 *   - Migrate legacy `daveai.hub.baseUrl` / `daveai.autoUpdate.*` keys
 *     into the new onboarding-driven schema.
 */
import * as vscode from "vscode"
import {
  OnboardingWizard,
  type DetectionResults,
  type OnboardingResult,
  type ConnectionTestResults,
} from "./OnboardingWizard"

const STATE_KEY = {
  onboarded: "daveai.onboarded",
  result: "daveai.onboarding.result",
  hubBaseUrl: "daveai.hub.baseUrl",
  updateMode: "daveai.autoUpdate.mode",
  updateChannel: "daveai.autoUpdate.channel",
  preferredModel: "daveai.routing.defaultModel",
  deploymentMode: "daveai.deploymentMode",
} as const

const LEGACY_CONFIG_SECTION = "daveai"

export class OnboardingService {
  private readonly wizard: OnboardingWizard

  constructor(private readonly context: vscode.ExtensionContext) {
    this.wizard = new OnboardingWizard(context)
  }

  /** True iff this device hasn't completed (or skipped) the wizard. */
  shouldShowWizard(): boolean {
    return this.context.globalState.get<boolean>(STATE_KEY.onboarded) !== true
  }

  /**
   * Full happy-path: detect → import secrets → ask 5 questions → persist
   * → test connections → return result. Returns null if the user cancels
   * any prompt — the wizard can be re-run later.
   */
  async runWizard(): Promise<OnboardingResult | null> {
    const detection = await this.wizard.runDetection()
    await this.wizard.importSecrets(detection)

    const result = await this.wizard.runWizard(detection)
    if (!result) return null

    await this.markComplete(result)

    // Fire-and-forget connection test (the user already moved on)
    void this.testConnections(result).then((tests) => {
      this.showConnectionResults(tests)
    })

    return result
  }

  /** Persist the wizard outcome to globalState (the source of truth). */
  async markComplete(result: OnboardingResult): Promise<void> {
    await Promise.all([
      this.context.globalState.update(STATE_KEY.onboarded, true),
      this.context.globalState.update(STATE_KEY.result, result),
      this.context.globalState.update(STATE_KEY.hubBaseUrl, result.hubBaseUrl),
      this.context.globalState.update(STATE_KEY.updateMode, result.updateMode),
      this.context.globalState.update(STATE_KEY.updateChannel, result.updateChannel),
      this.context.globalState.update(STATE_KEY.preferredModel, result.preferredModel),
      this.context.globalState.update(STATE_KEY.deploymentMode, result.mode),
    ])
  }

  /** Drop the onboarded flag so the next activate re-runs the wizard. */
  async resetOnboarding(): Promise<void> {
    await this.context.globalState.update(STATE_KEY.onboarded, false)
    await this.context.globalState.update(STATE_KEY.result, undefined)
  }

  /** Auto-detection pre-flight (exposed for tests + the "Re-run" UI). */
  async runDetection(): Promise<DetectionResults> {
    return this.wizard.runDetection()
  }

  /** Verify all URLs the wizard configured. */
  async testConnections(result: OnboardingResult): Promise<ConnectionTestResults> {
    return this.wizard.testConnections(result)
  }

  /** Read the persisted result (if any) — used by status bar / settings UI. */
  getPersistedResult(): OnboardingResult | null {
    return this.context.globalState.get<OnboardingResult>(STATE_KEY.result) ?? null
  }

  /**
   * Migrate from the legacy single-flat `vscode.workspace.getConfiguration`
   * world (where users set `daveai.hub.baseUrl` etc. by hand) into our new
   * globalState-backed schema. Idempotent — running twice is a no-op.
   */
  async migrateFromLegacy(): Promise<void> {
    if (this.context.globalState.get<boolean>("daveai.onboarding.migrated") === true) {
      return
    }

    const cfg = vscode.workspace.getConfiguration(LEGACY_CONFIG_SECTION)
    const legacyHubUrl = cfg.get<string>("hub.baseUrl")
    const legacyMode = cfg.get<string>("autoUpdate.mode")
    const legacyChannel = cfg.get<string>("autoUpdate.channel")

    if (legacyHubUrl) {
      await this.context.globalState.update(STATE_KEY.hubBaseUrl, legacyHubUrl)
    }
    if (legacyMode === "off" || legacyMode === "prompt" || legacyMode === "silent") {
      await this.context.globalState.update(STATE_KEY.updateMode, legacyMode)
    }
    if (legacyChannel === "stable" || legacyChannel === "canary" || legacyChannel === "dev") {
      await this.context.globalState.update(STATE_KEY.updateChannel, legacyChannel)
    }

    await this.context.globalState.update("daveai.onboarding.migrated", true)
  }

  // ─── UI ───────────────────────────────────────────────────

  private showConnectionResults(tests: ConnectionTestResults): void {
    if (tests.services.length === 0) {
      void vscode.window.showInformationMessage(
        "KiloCode is configured (standalone mode — no Hub services to test).",
      )
      return
    }

    if (tests.allOk) {
      void vscode.window.showInformationMessage(
        `KiloCode connected to all ${tests.services.length} services successfully.`,
      )
      return
    }

    const failed = tests.services.filter((s) => !s.ok)
    const message =
      `KiloCode is configured but ${failed.length} of ${tests.services.length} services ` +
      `aren't reachable yet: ${failed.map((s) => s.name).join(", ")}.`
    void vscode.window
      .showWarningMessage(message, "Re-run wizard", "Dismiss")
      .then(async (choice) => {
        if (choice === "Re-run wizard") {
          await this.resetOnboarding()
          await this.runWizard()
        }
      })
  }
}
