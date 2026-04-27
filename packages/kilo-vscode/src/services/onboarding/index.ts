/**
 * `services/onboarding` — public re-exports + extension-lifecycle wiring.
 *
 * Wire from `extension.ts`:
 *
 *   import { registerOnboarding } from "./services/onboarding"
 *   export function activate(ctx: vscode.ExtensionContext) {
 *     registerOnboarding(ctx)
 *     // ...other services
 *   }
 *
 * The wizard auto-fires 2 s after activate if this device hasn't been
 * onboarded yet. The user can also re-run it from the command palette
 * via `kilocode.runOnboardingWizard`.
 */
import * as vscode from "vscode"
import { OnboardingService } from "./OnboardingService"
import {
  OnboardingWizard,
  type DetectionResults,
  type OnboardingResult,
  type ConnectionTestResults,
  type DeploymentMode,
  type UpdateChannel,
  type UpdateMode,
  type PreferredModel,
} from "./OnboardingWizard"

export { OnboardingService, OnboardingWizard }
export type {
  DetectionResults,
  OnboardingResult,
  ConnectionTestResults,
  DeploymentMode,
  UpdateChannel,
  UpdateMode,
  PreferredModel,
}

const FIRST_RUN_DELAY_MS = 2_000

let _instance: OnboardingService | undefined
let _firstRunTimer: NodeJS.Timeout | null = null

export function registerOnboarding(
  context: vscode.ExtensionContext,
): OnboardingService {
  if (_instance) return _instance

  const svc = new OnboardingService(context)
  _instance = svc

  // Migrate any legacy settings before deciding whether to show the wizard
  void svc.migrateFromLegacy()

  context.subscriptions.push(
    vscode.commands.registerCommand("kilocode.runOnboardingWizard", async () => {
      await svc.resetOnboarding()
      await svc.runWizard()
    }),
    vscode.commands.registerCommand("kilocode.testHubConnection", async () => {
      const result = svc.getPersistedResult()
      if (!result) {
        void vscode.window.showInformationMessage(
          "Run the onboarding wizard first (Command Palette → 'Run Onboarding Wizard').",
        )
        return
      }
      const tests = await svc.testConnections(result)
      const summary = tests.services
        .map((s) => `${s.ok ? "OK" : "FAIL"} ${s.name}`)
        .join(" | ")
      void vscode.window.showInformationMessage(`Hub connection test: ${summary}`)
    }),
    {
      dispose: () => {
        if (_firstRunTimer) {
          clearTimeout(_firstRunTimer)
          _firstRunTimer = null
        }
      },
    },
  )

  if (svc.shouldShowWizard()) {
    _firstRunTimer = setTimeout(() => {
      _firstRunTimer = null
      void svc.runWizard()
    }, FIRST_RUN_DELAY_MS)
  }

  return svc
}

/** Accessor for other modules (settings UI's "Re-run wizard" button etc.). */
export function getOnboardingService(): OnboardingService | undefined {
  return _instance
}

/** Test-only — drops the singleton so tests can re-register cleanly. */
export function _resetOnboardingForTests(): void {
  if (_firstRunTimer) {
    clearTimeout(_firstRunTimer)
    _firstRunTimer = null
  }
  _instance = undefined
}
