import * as vscode from "vscode"

/**
 * Entry-point controller for the experimental "Approve for me" composer
 * toggle (issue #7684). This iteration only tracks on/off state and
 * visibility; it does not yet change approval behavior. See the Gatekeeper
 * implementation plan for the follow-up iterations that add the heuristic
 * and LLM review stages.
 */
export interface ApproveForMeController {
  active(): boolean
  visible(): boolean
  toggle(): Promise<boolean>
  onChange(listener: (state: { active: boolean; visible: boolean }) => void): { dispose(): void }
}

const VISIBILITY_CONFIG = "kilo-code.new.experimental"
const VISIBILITY_KEY = "approveForMe"
const CONFIG = "kilo-code.new.approveForMe"
const KEY = "enabled"

export function registerToggleApproveForMe(context: vscode.ExtensionContext): ApproveForMeController {
  let active = readActive()
  let visible = readVisible()
  const listeners = new Set<(state: { active: boolean; visible: boolean }) => void>()

  const notify = () => {
    for (const listener of listeners) listener({ active, visible })
  }

  const toggle = async () => {
    if (!visible) return active
    active = !active
    notify()
    await vscode.workspace.getConfiguration(CONFIG).update(KEY, active, target())
    if (active) {
      vscode.window.showInformationMessage(
        "Approve for me is enabled. This entry point does not change approval behavior yet.",
      )
    }
    return active
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(() => {
      const nextActive = readActive()
      const nextVisible = readVisible()
      if (nextActive === active && nextVisible === visible) return
      active = nextActive
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

function readActive(): boolean {
  return vscode.workspace.getConfiguration(CONFIG).get(KEY, false)
}

function readVisible(): boolean {
  return vscode.workspace.getConfiguration(VISIBILITY_CONFIG).get(VISIBILITY_KEY, false)
}

function target(): vscode.ConfigurationTarget {
  const info = vscode.workspace.getConfiguration(CONFIG).inspect<boolean>(KEY)
  if (info?.workspaceFolderValue !== undefined) return vscode.ConfigurationTarget.WorkspaceFolder
  if (info?.workspaceValue !== undefined) return vscode.ConfigurationTarget.Workspace
  return vscode.ConfigurationTarget.Global
}
