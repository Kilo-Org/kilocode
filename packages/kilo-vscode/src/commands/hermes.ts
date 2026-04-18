import * as vscode from "vscode"
import {
  HERMES_ENV_FALLBACKS,
  type HermesClient,
  type HermesPipeline,
  type HermesStatusService,
  clearKey,
  keySource,
  saveKey,
} from "../services/hermes"

/**
 * Register the four Hermes-pipeline commands.
 *
 *   kilo-code.new.hermes.toggle         — flip enabled/disabled
 *   kilo-code.new.hermes.setApiKey      — store via SecretStorage
 *   kilo-code.new.hermes.clearApiKey    — clear SecretStorage entry
 *   kilo-code.new.hermes.testConnection — ping /health and show result
 */
export function registerHermesCommands(
  ctx: vscode.ExtensionContext,
  status: HermesStatusService,
  client: HermesClient,
  pipeline: HermesPipeline,
): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand("kilo-code.new.hermes.toggle", async () => {
      await status.toggle()
    }),

    vscode.commands.registerCommand("kilo-code.new.hermes.setApiKey", async () => {
      const input = await vscode.window.showInputBox({
        prompt: "Paste the Hermes / KiloCode / MiniMax API key",
        placeHolder: "sk-...",
        password: true,
        ignoreFocusOut: true,
      })
      if (input === undefined) return // user cancelled
      await saveKey(ctx, input)
      const src = await keySource(ctx)
      const msg =
        src === "secret"
          ? "Hermes API key stored in VS Code SecretStorage."
          : "Hermes API key cleared. Falling back to environment variables if set."
      void vscode.window.showInformationMessage(msg)
      await status.refresh()
    }),

    vscode.commands.registerCommand("kilo-code.new.hermes.clearApiKey", async () => {
      await clearKey(ctx)
      const src = await keySource(ctx)
      const msg =
        src === "env"
          ? `SecretStorage cleared. Using env var: ${firstEnvName()}.`
          : "SecretStorage cleared. No env fallback found — requests will be unauthenticated."
      void vscode.window.showInformationMessage(msg)
      await status.refresh()
    }),

    vscode.commands.registerCommand("kilo-code.new.hermes.testConnection", async () => {
      const cfg = status.getConfig()
      if (!cfg.enabled) {
        void vscode.window.showWarningMessage(
          "Hermes pipeline is disabled. Enable it first (Hermes: Toggle Pipeline).",
        )
        return
      }
      const res = await client.health(5000)
      const src = await keySource(ctx)
      const lines = [
        `Bridge URL: ${cfg.baseUrl}`,
        `Reachable:  ${res.bridge_reachable ? "yes" : "no"}`,
        `Status OK:  ${res.ok ? "yes" : "no"}`,
        `Latency:    ${res.latency_ms} ms`,
        `Key source: ${src}`,
        ...(res.version ? [`Version:    ${res.version}`] : []),
        ...(res.error ? [`Error:      ${res.error}`] : []),
      ]
      if (res.ok && res.bridge_reachable) {
        void vscode.window.showInformationMessage(`Hermes OK — ${res.latency_ms}ms`, {
          detail: lines.join("\n"),
          modal: false,
        })
        return
      }
      void vscode.window.showErrorMessage(`Hermes unreachable — see details`, {
        detail: lines.join("\n"),
        modal: false,
      })
    }),
  )

  // Register pipeline instance for future task-submission commands.
  ctx.subscriptions.push({ dispose: () => pipeline.dispose() })
}

function firstEnvName(): string {
  for (const name of HERMES_ENV_FALLBACKS) {
    if (process.env[name] && process.env[name]?.trim().length) return name
  }
  return "(none)"
}
