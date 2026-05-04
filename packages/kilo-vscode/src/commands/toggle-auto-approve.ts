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

export interface AutoApproveController {
  active(): boolean
  toggle(): Promise<boolean>
  onChange(listener: (active: boolean) => void): { dispose(): void }
}

const CONFIG = "kilo-code.new.autoApprove"
const KEY = "enabled"

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
): AutoApproveController {
  let active = readActive()
  // Bumped on disable to invalidate in-flight enable drains
  let generation = 0
  const listeners = new Set<(active: boolean) => void>()

  const notify = () => {
    for (const listener of listeners) listener(active)
  }

  const setActive = async (next: boolean) => {
    active = next
    generation++
    notify()
    await vscode.workspace.getConfiguration(CONFIG).update(KEY, active, target())
  }

  const toggle = async () => {
    await setActive(!active)
    const snapshot = generation

    if (!active) {
      vscode.window.showInformationMessage("Auto-approve disabled")
      return active
    }

    vscode.window.showInformationMessage("Auto-approve enabled")
    // Drain any already-pending permission requests across all tracked directories
    const client = tryGetClient(connectionService)
    if (!client) return active
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

    return active
  }

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
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(`${CONFIG}.${KEY}`)) return
      const next = readActive()
      if (next === active) return
      active = next
      generation++
      notify()
    }),
  )

  context.subscriptions.push(vscode.commands.registerCommand("kilo-code.new.toggleAutoApprove", toggle))

  return {
    active: () => active,
    toggle,
    onChange(listener) {
      listeners.add(listener)
      let disposed = false
      return {
        dispose() {
          if (disposed) return
          disposed = true
          listeners.delete(listener)
        },
      }
    },
  }
}

function readActive(): boolean {
  return vscode.workspace.getConfiguration(CONFIG).get(KEY, false)
}

function target(): vscode.ConfigurationTarget {
  const info = vscode.workspace.getConfiguration(CONFIG).inspect<boolean>(KEY)
  if (info?.workspaceFolderValue !== undefined) return vscode.ConfigurationTarget.WorkspaceFolder
  if (info?.workspaceValue !== undefined) return vscode.ConfigurationTarget.Workspace
  return vscode.ConfigurationTarget.Global
}

function tryGetClient(connectionService: KiloConnectionService): KiloClient | undefined {
  try {
    return connectionService.getClient()
  } catch {
    return undefined
  }
}
