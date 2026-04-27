/**
 * `services/auto-update` — public re-exports + registration helper.
 *
 * Wire from `extension.ts` like so:
 *
 *   import { registerAutoUpdate } from "./services/auto-update"
 *   export function activate(ctx: vscode.ExtensionContext) {
 *     registerAutoUpdate(ctx)
 *   }
 *
 * Other modules that want to read settings or trigger a manual check can
 * grab the live instance via `getAutoUpdateService()`.
 */
import * as vscode from "vscode"
import {
  AutoUpdateService,
  type Manifest,
  type UpdateChannel,
  type UpdateInfo,
  type UpdateMode,
  type SignedDownload,
  compareSemver,
} from "./AutoUpdateService"
import { UpdatePromptUI, type UpdatePromptChoice } from "./UpdatePromptUI"

export {
  AutoUpdateService,
  UpdatePromptUI,
  compareSemver,
}
export type {
  Manifest,
  UpdateChannel,
  UpdateInfo,
  UpdateMode,
  UpdatePromptChoice,
  SignedDownload,
}

let _instance: AutoUpdateService | undefined

/**
 * Wire the auto-update service to the extension lifecycle. Idempotent:
 * subsequent calls return the same instance.
 *
 * Reads VS Code config:
 *   - `daveai.hub.baseUrl`     (default "http://localhost:8082")
 *   - `daveai.hub.adminToken`  (optional Bearer for write endpoints)
 *   - `daveai.autoUpdate.pollSeconds` (default 3600)
 */
export function registerAutoUpdate(
  context: vscode.ExtensionContext,
): AutoUpdateService {
  if (_instance) return _instance

  const cfg = vscode.workspace.getConfiguration("daveai")
  const baseUrl =
    cfg.get<string>("hub.baseUrl") ?? "http://localhost:8082"
  const token = cfg.get<string>("hub.adminToken") || undefined
  const pollSeconds = Math.max(60, cfg.get<number>("autoUpdate.pollSeconds") ?? 3600)

  const svc = new AutoUpdateService(context, baseUrl, token, pollSeconds * 1000)
  const ui = new UpdatePromptUI(svc)

  // Wire UI to the event — only show a prompt when mode is "prompt".
  // ("silent" mode installs inside the service; "off" never fires the
  // event-driven prompt either, but does fire the event so other
  // modules — e.g. a settings panel — can react.)
  context.subscriptions.push(
    svc.onUpdateAvailable((info) => {
      const mode = svc.getMode()
      if (mode === "prompt") {
        void ui.showUpdateNotification(info)
      } else if (info.isForced) {
        // Forced updates always prompt, regardless of mode.
        void ui.showForcedUpdateModal(info)
      }
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand("daveai.autoUpdate.checkNow", () =>
      svc.checkNow(),
    ),
    vscode.commands.registerCommand("daveai.autoUpdate.setChannel", async () => {
      const picked = await vscode.window.showQuickPick(
        ["stable", "canary", "dev"] as UpdateChannel[],
        { title: "Auto-update channel" },
      )
      if (picked) await svc.setChannel(picked as UpdateChannel)
    }),
    vscode.commands.registerCommand("daveai.autoUpdate.setMode", async () => {
      const picked = await vscode.window.showQuickPick(
        ["off", "prompt", "silent"] as UpdateMode[],
        { title: "Auto-update mode" },
      )
      if (picked) await svc.setMode(picked as UpdateMode)
    }),
  )

  context.subscriptions.push(svc)
  svc.start()
  _instance = svc
  return svc
}

/** Accessor for other modules. Returns undefined before `registerAutoUpdate`. */
export function getAutoUpdateService(): AutoUpdateService | undefined {
  return _instance
}

/** Test-only — drops the singleton so tests can re-register cleanly. */
export function _resetAutoUpdateForTests(): void {
  _instance = undefined
}
