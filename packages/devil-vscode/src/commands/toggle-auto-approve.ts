import * as vscode from "vscode"
import type { KiloClient, Event } from "@kilocode/sdk/v2/client"
import type { KiloConnectionService } from "../services/cli-backend/connection-service"

/**
 * Callback that resolves the correct working directory for a session.
 * For worktree sessions this returns the worktree path; otherwise the workspace root.
 */
export type DirectoryResolver = (sessionId?: string) => string

/**
 * Returns every unique directory the extension tracks
 * (workspace root + all registered worktree paths).
 */
export type AllDirectories = () => string[]

/**
 * Runtime auto-accept toggle for permissions.
 *
 * Mirrors the desktop app pattern (packages/app/src/context/permission.tsx):
 * instead of writing to the config file, we intercept `permission.asked` SSE
 * events and auto-reply "once" to each. This avoids config-layer issues
 * (merged vs global, sparse defaults) and works even when the sidebar is closed.
 */
export function registerToggleAutoApprove(
  context: vscode.ExtensionContext,
  connectionService: KiloConnectionService,
  resolve: DirectoryResolver,
  directories: AllDirectories,
): void {
  let active = false
  // Bumped on disable to invalidate in-flight enable drains
  let generation = 0

  const unsubscribe = connectionService.onEvent((event: Event) => {
    if (!active) return
    if (event.type !== "permission.asked") return
    const client = tryGetClient(connectionService)
    if (!client) return
    const dir = resolve(event.properties.sessionID)
    client.permission.reply({ requestID: event.properties.id, directory: dir, reply: "once" }).catch((err) => {
      console.error("[Kilo New] toggleAutoApprove: failed to auto-reply:", err)
    })
  })

  context.subscriptions.push({ dispose: unsubscribe })

  context.subscriptions.push(
    vscode.commands.registerCommand("kilo-code.new.toggleAutoApprove", async () => {
      active = !active
      generation++
      const snapshot = generation

      if (active) {
        vscode.window.showInformationMessage("Auto-approve enabled")
        // Drain any already-pending permission requests across all tracked directories
        const client = tryGetClient(connectionService)
        if (client) {
          for (const dir of directories()) {
            if (generation !== snapshot) break
            try {
              const { data: pending } = await client.permission.list({ directory: dir }, { throwOnError: true })
              for (const req of pending) {
                if (generation !== snapshot) break
                await client.permission.reply({ requestID: req.id, directory: dir, reply: "once" }).catch((err) => {
                  console.error("[Kilo New] toggleAutoApprove: failed to drain pending:", err)
                })
              }
            } catch (err) {
              console.error("[Kilo New] toggleAutoApprove: failed to list pending permissions:", err)
            }
          }
        }
      } else {
        vscode.window.showInformationMessage("Auto-approve disabled")
      }
    }),
  )
}

function tryGetClient(connectionService: KiloConnectionService): KiloClient | undefined {
  try {
    return connectionService.getClient()
  } catch {
    return undefined
  }
}
