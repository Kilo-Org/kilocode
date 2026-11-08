import * as vscode from "vscode"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { t } from "../services/i18n"
import type { McpAuthResult } from "../services/mcp-auth"

/**
 * Shown when the CLI could not open a browser for an in-progress MCP OAuth
 * sign-in (`mcp.browser.open.failed`). Non-modal — the CLI is still waiting
 * on the OAuth callback — and offers to open the URL or copy it for use on
 * another machine (e.g. remote development over SSH).
 */
export function showAuthUrl(name: string, url: string): void {
  void vscode.window
    .showInformationMessage(
      t("mcp.auth.browserFailed", { name }),
      t("mcp.auth.browserFailed.open"),
      t("mcp.auth.browserFailed.copy"),
    )
    .then((choice) => {
      if (choice === t("mcp.auth.browserFailed.open")) {
        void vscode.env.openExternal(vscode.Uri.parse(url))
        return
      }
      if (choice === t("mcp.auth.browserFailed.copy")) {
        void vscode.env.clipboard.writeText(url)
      }
    })
}

/** Native sign-in outcome notification shown when the caller did not request a silent/inline result (see `SignInMcpMessage.notify`). */
export function notifySignInResult(name: string, result: McpAuthResult): void {
  if (result.status === "cancelled") return
  if (result.status === "connected") {
    void vscode.window.showInformationMessage(t("mcp.signIn.success", { name }))
    return
  }
  if (result.status === "timeout") {
    void vscode.window.showErrorMessage(t("mcp.signIn.timeout", { name }))
    return
  }
  if (result.status === "unsupported") {
    void vscode.window.showErrorMessage(t("mcp.signIn.unsupported", { name }))
    return
  }
  if (result.status === "not_found") {
    void vscode.window.showErrorMessage(t("mcp.signIn.notFound", { name }))
    return
  }
  const base = t("mcp.signIn.failed", { name })
  void vscode.window.showErrorMessage(result.error ? `${base} ${result.error}` : base)
}

/** Shown when `McpAuthService.reset` fails to clear stored credentials. */
export function notifyResetFailed(name: string): void {
  void vscode.window.showErrorMessage(t("mcp.auth.resetFailed", { name }))
}

export async function connectMcpServer(
  client: KiloClient,
  name: string,
  directory: string,
  refreshStatus: () => Promise<void>,
): Promise<void> {
  try {
    await client.mcp.connect({ name, directory })
    await refreshStatus()
  } catch (error) {
    console.error("[Kilo New] Failed to connect MCP:", name, error)
    await refreshStatus()
  }
}

export async function disconnectMcpServer(
  client: KiloClient,
  name: string,
  directory: string,
  refreshStatus: () => Promise<void>,
): Promise<void> {
  try {
    await client.mcp.disconnect({ name, directory })
    await refreshStatus()
  } catch (error) {
    console.error("[Kilo New] Failed to disconnect MCP:", name, error)
    await refreshStatus()
  }
}
