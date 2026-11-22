import * as vscode from "vscode"
import type { Event, KiloClient } from "@kilocode/sdk/v2/client"
import { replyOnce } from "../kilo-provider/handlers/permission-handler"
import { retry } from "../services/cli-backend/retry"
import type { KiloConnectionService } from "../services/cli-backend/connection-service"

/**
 * Callback that resolves the correct working directory for a session.
 * For worktree sessions this returns the worktree path; for a session in the workspace
 * root, the workspace path. It returns `undefined` when no directory is known, so the
 * caller refuses instead of guessing.
 */
export type DirectoryResolver = (sessionId?: string) => string | undefined

/**
 * Returns every unique directory the extension tracks
 * (workspace root + all registered worktree paths).
 */
export type AllDirectories = () => string[]
type Asked = Extract<Event, { type: "permission.asked" }>

export interface AutoApproveController {
  active(): boolean
  approve(event: Asked, directory?: string): Promise<boolean>
  toggle(): Promise<boolean>
  onChange(listener: (active: boolean) => void): { dispose(): void }
}

const CONFIG = "kilo-code.new.autoApprove"
const KEY = "enabled"

/**
 * Runtime auto-accept toggle for permissions.
 *
 * Instead of writing to the CLI config, the attention coordinator delegates
 * `permission.asked` events here and auto-replies "once". This avoids config-layer
 * issues (merged vs global, sparse defaults) and works even when the sidebar is closed.
 *
 * The setting is user scoped: the controller follows the user value, and the toggle is
 * written to the user setting. Enabling saves that setting first, so a save that fails
 * leaves auto-approve off and says so. Disabling takes effect in memory at once and
 * still reports a rejected write.
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

  // The config-change listener can apply the same value after our own write lands.
  const apply = (next: boolean) => {
    if (next === active) return
    active = next
    generation++
    notify()
  }

  // One state transition at a time: a click during the settings write must see the
  // state that write leaves, not the value it replaced.
  let transitions: Promise<unknown> = Promise.resolve()
  const transition = <T>(run: () => Promise<T>): Promise<T> => {
    const next = transitions.then(run, run)
    transitions = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  const save = async (next: boolean): Promise<boolean> => {
    try {
      await vscode.workspace.getConfiguration(CONFIG).update(KEY, next, vscode.ConfigurationTarget.Global)
      return true
    } catch (error) {
      console.error("[Kilo New] toggleAutoApprove: failed to save the setting:", error)
      vscode.window.showErrorMessage(
        next
          ? "Kilo Code could not save the auto-approve setting, so auto-approve stays off."
          : "Kilo Code could not save the auto-approve setting, so auto-approve is off until that setting is saved.",
      )
      return false
    }
  }

  const setActive = async (next: boolean): Promise<boolean> => {
    if (next) {
      if (await save(true)) {
        apply(true)
        return true
      }
      // The setting still says off. Tell every listener the state it now holds.
      active = false
      generation++
      notify()
      return false
    }
    apply(false)
    return save(false)
  }

  const drain = async (snapshot: number) => {
    // Drain any already-pending permission requests across all tracked directories
    const client = tryGetClient(connectionService)
    if (!client) return
    for (const dir of directories()) {
      if (generation !== snapshot) break
      try {
        const { data: pending } = await retry(() => client.permission.list({ directory: dir }, { throwOnError: true }))
        for (const req of pending) {
          if (generation !== snapshot) break
          if (req.metadata?.["sandboxEscalation"] === true) continue
          await replyOnce(client, req.id, dir, () => generation === snapshot)
        }
      } catch (err) {
        console.error("[Kilo New] toggleAutoApprove: failed to list pending permissions:", err)
      }
    }
  }

  const toggle = async () => {
    const turned = await transition(async () => {
      const next = !active
      const saved = await setActive(next)
      return { next, saved, snapshot: generation }
    })
    if (!turned.saved) return active
    if (turned.next) {
      vscode.window.showInformationMessage("Auto-approve enabled. Sandbox escalation prompts are excluded.")
      await drain(turned.snapshot)
    } else {
      vscode.window.showInformationMessage("Auto-approve disabled")
    }
    return active
  }

  const approve = async (event: Asked, directory?: string) => {
    if (!active) return false
    const snapshot = generation
    const client = tryGetClient(connectionService)
    if (!client) return false
    if (event.properties.metadata?.["sandboxEscalation"] === true) return false
    // Answer only where the request is known to live: the event's own directory, the
    // recorded route, or a session this extension holds a directory for. Without one,
    // the request stays with the attention path.
    const dir =
      directory ?? connectionService.getPermissionDirectory(event.properties.id) ?? resolve(event.properties.sessionID)
    if (!dir) return false
    return replyOnce(client, event.properties.id, dir, () => generation === snapshot)
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(`${CONFIG}.${KEY}`)) return
      apply(readActive())
    }),
  )

  context.subscriptions.push(vscode.commands.registerCommand("kilo-code.new.toggleAutoApprove", toggle))

  return {
    active: () => active,
    approve,
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
  return vscode.workspace.getConfiguration(CONFIG).inspect<boolean>(KEY)?.globalValue === true
}

function tryGetClient(connectionService: KiloConnectionService): KiloClient | undefined {
  try {
    return connectionService.getClient()
  } catch {
    return undefined
  }
}
