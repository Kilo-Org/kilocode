import * as vscode from "vscode"

/**
 * Entry-point controller for the experimental "Approve for me" composer
 * toggle (issue #7684). This iteration only tracks on/off state and
 * visibility; it does not yet change approval behavior.
 *
 * "Approve for me" and auto-approve are alternatives: at most one is on. The
 * exclusion is enforced here through the two settings, so it also holds for the
 * Command Palette and for edits made directly in settings.json. The newest
 * change wins. At startup, when both are on, approve-for-me wins because it is
 * the stricter mode. Nothing is enforced while the experimental flag is off.
 */
export interface ApproveForMeController {
  active(): boolean
  visible(): boolean
  toggle(): Promise<boolean>
  onChange(listener: (state: { active: boolean; visible: boolean }) => void): { dispose(): void }
}

const FLAG = "kilo-code.new.experimental"
const FLAG_KEY = "approveForMe"
const CONFIG = "kilo-code.new.approveForMe"
const AUTO = "kilo-code.new.autoApprove"
const KEY = "enabled"

export function registerToggleApproveForMe(context: vscode.ExtensionContext): ApproveForMeController {
  let active = readActive()
  let visible = readVisible()
  let auto = read(AUTO)
  const listeners = new Set<(state: { active: boolean; visible: boolean }) => void>()

  const notify = () => {
    for (const listener of listeners) listener({ active, visible })
  }

  const write = (section: string, value: boolean) =>
    Promise.resolve(vscode.workspace.getConfiguration(section).update(KEY, value, target(section))).catch((err) =>
      console.error(`[Kilo New] approve-for-me: failed to update ${section}.${KEY}:`, err),
    )

  // Startup conflict: approve-for-me wins over auto-approve.
  if (visible && active && auto) void write(AUTO, false)

  const toggle = async () => {
    if (!visible) return active
    const swap = !active && read(AUTO)
    if (swap) await write(AUTO, false)
    active = !active
    notify()
    await write(CONFIG, active)
    if (active) {
      vscode.window.showInformationMessage(
        swap
          ? "Approve for me is enabled and auto-approve is off. This entry point does not change approval behavior yet."
          : "Approve for me is enabled. This entry point does not change approval behavior yet.",
      )
    }
    return active
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(() => {
      const nextActive = readActive()
      const nextVisible = readVisible()
      const nextAuto = read(AUTO)
      const conflict = nextVisible && nextActive && nextAuto
      // Auto-approve just turned on, so it wins and approve-for-me yields.
      const yielded = conflict && !auto
      auto = nextAuto
      if (conflict) void write(yielded ? CONFIG : AUTO, false)
      const next = yielded ? false : nextActive
      if (next === active && nextVisible === visible) return
      active = next
      visible = nextVisible
      notify()
    }),
  )

  context.subscriptions.push(vscode.commands.registerCommand("kilo-code.new.toggleApproveForMe", toggle))

  return {
    active: () => active,
    visible: () => visible,
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

function read(section: string): boolean {
  return vscode.workspace.getConfiguration(section).get(KEY, false)
}

function readActive(): boolean {
  return read(CONFIG)
}

function readVisible(): boolean {
  return vscode.workspace.getConfiguration(FLAG).get(FLAG_KEY, false)
}

function target(section: string): vscode.ConfigurationTarget {
  const info = vscode.workspace.getConfiguration(section).inspect<boolean>(KEY)
  if (info?.workspaceFolderValue !== undefined) return vscode.ConfigurationTarget.WorkspaceFolder
  if (info?.workspaceValue !== undefined) return vscode.ConfigurationTarget.Workspace
  return vscode.ConfigurationTarget.Global
}
