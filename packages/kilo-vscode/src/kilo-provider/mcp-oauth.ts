import * as vscode from "vscode"
import type { KiloClient, McpStatus } from "@kilocode/sdk/v2/client"
import { getErrorMessage } from "../kilo-provider-utils"

let lastMcpBrowserOpen: { url: string; at: number } | null = null

/** Dedupe when several webviews receive the same `mcp.browser.open.failed` SSE. */
export function openMcpOAuthUrlOnce(url: string): void {
  const now = Date.now()
  if (lastMcpBrowserOpen && lastMcpBrowserOpen.url === url && now - lastMcpBrowserOpen.at < 4000) return
  lastMcpBrowserOpen = { url, at: now }
  void vscode.env.openExternal(vscode.Uri.parse(url)).then(
    (opened) => {
      if (opened) return
      void vscode.window.showErrorMessage(
        "MCP sign-in failed to open the browser. Check the Kilo logs for the authentication URL.",
      )
    },
    (error) => {
      console.error("[Kilo New] Failed to open MCP OAuth URL:", error)
      void vscode.window.showErrorMessage(
        "MCP sign-in failed to open the browser. Check the Kilo logs for the authentication URL.",
      )
    },
  )
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

export async function authenticateMcpServer(
  client: KiloClient,
  name: string,
  directory: string,
  refreshStatus: () => Promise<void>,
): Promise<void> {
  try {
    const { data, error } = await client.mcp.auth.authenticate({ name, directory })
    if (error) {
      vscode.window.showErrorMessage(`MCP sign-in failed: ${getErrorMessage(error)}`)
      return
    }
    const status = data as McpStatus | undefined
    if (status?.status === "failed") {
      vscode.window.showErrorMessage(status.error || "MCP OAuth failed")
    } else if (status?.status === "needs_client_registration") {
      vscode.window.showErrorMessage(status.error || "MCP server requires client registration in config")
    }
  } catch (error) {
    console.error("[Kilo New] Failed to authenticate MCP:", name, error)
    vscode.window.showErrorMessage(getErrorMessage(error) || "MCP sign-in failed")
  } finally {
    await refreshStatus()
  }
}
