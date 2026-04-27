/**
 * UpdatePromptUI — owns the user-facing notification for the auto-update flow.
 *
 * Implements HUB_OTA_UPDATE_SPEC §4.2 step 5 ("show notification banner") and
 * §4.5 (forced-update modal when currentVersion < minimumVersion).
 *
 * Two entry points:
 *   - `showUpdateNotification(info)` returns the user's choice and applies any
 *     side-effects that touch the service's settings (Skip → addSkippedVersion;
 *     Always → setMode("silent")).
 *   - `showForcedUpdateModal(info)` is used when currentVersion < minimumVersion;
 *     no Skip option — only Install or "Open Release Notes".
 */
import * as vscode from "vscode"
import type { AutoUpdateService, UpdateInfo } from "./AutoUpdateService"

export type UpdatePromptChoice =
  | "install"
  | "skip"
  | "always"
  | "release-notes"
  | "dismiss"

export class UpdatePromptUI {
  constructor(private readonly service: AutoUpdateService) {}

  /**
   * Show the banner with [Install Now] [Skip This Version] [Always Auto-Update].
   * Persists "skip" / "always" choices to globalState before returning.
   */
  async showUpdateNotification(info: UpdateInfo): Promise<UpdatePromptChoice> {
    if (info.isForced) {
      return this.showForcedUpdateModal(info)
    }

    const message = `KiloCode v${info.newVersion} is available (current: v${info.currentVersion}).`
    const items = ["Install Now", "Skip This Version", "Always Auto-Update"]
    const picked = await vscode.window.showInformationMessage(message, ...items)

    switch (picked) {
      case "Install Now":
        await this.service.installUpdate(info)
        return "install"

      case "Skip This Version":
        await this.service.addSkippedVersion(info.newVersion)
        return "skip"

      case "Always Auto-Update":
        await this.service.setMode("silent")
        // The user opted in to silent — kick the install off now.
        await this.service.installUpdate(info)
        return "always"

      default:
        return "dismiss"
    }
  }

  /**
   * Modal forced-update prompt — used when currentVersion < minimumVersion.
   * No Skip button (per spec §4.5).
   */
  async showForcedUpdateModal(info: UpdateInfo): Promise<UpdatePromptChoice> {
    const detail =
      info.manifest.minimumVersion != null
        ? `Your version (v${info.currentVersion}) is below the minimum supported version (v${info.manifest.minimumVersion}).`
        : `An update is required to continue.`
    const buttons: string[] = ["Install Now"]
    if (info.releaseNotes) buttons.push("Open Release Notes")

    const picked = await vscode.window.showWarningMessage(
      `Update required — KiloCode v${info.newVersion}`,
      { modal: true, detail },
      ...buttons,
    )

    if (picked === "Install Now") {
      await this.service.installUpdate(info)
      return "install"
    }
    if (picked === "Open Release Notes" && info.releaseNotes) {
      void vscode.env.openExternal(vscode.Uri.parse(info.releaseNotes))
      // Re-prompt after opening notes.
      return this.showForcedUpdateModal(info)
    }
    return "dismiss"
  }
}
