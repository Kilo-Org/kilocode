// The VS Code side of attention: the `kilo-code.v2.attention.*` settings, the workbench notification, the window
// focus and the sound and OS notification commands.
import path from "node:path"
import { Uri, window, workspace } from "vscode"
import type { AgentManagerConnection } from "../agent-manager/connection"
import { hostAutoApproves } from "../agent-manager/provider-auto-approve"
import { OS_NOTIFICATION_PLATFORMS, showOSNotification } from "./os"
import { createAttention, type AttentionSettings } from "./service"
import { playSound, resolveSoundID, soundDirectory } from "./sound"

export const ATTENTION_NAMESPACE = "kilo-code.v2.attention"

/** All four settings are off until the user turns them on. */
export function attentionSettings(): AttentionSettings {
  const config = workspace.getConfiguration(ATTENTION_NAMESPACE)
  return {
    enabled: config.get<boolean>("enabled", false),
    notifications: config.get<boolean>("notifications", false),
    os: config.get<boolean>("OSNotifications", false),
    sound: resolveSoundID(config.get<string>("sound", "default")),
  }
}

export function attentionHost(input: {
  connection: Pick<AgentManagerConnection, "onEvent" | "current">
  extensionPath: string
  visible: (sessionID: string) => boolean
  show: (sessionID: string, directory?: string) => unknown
}) {
  const sounds = soundDirectory(input.extensionPath)
  return createAttention({
    connection: input.connection,
    settings: attentionSettings,
    play: (kind, sound) => void playSound(kind, sound, sounds),
    os: OS_NOTIFICATION_PLATFORMS.includes(process.platform) ? showOSNotification : undefined,
    message: (kind, text, action) => {
      if (kind === "error") return window.showErrorMessage(text, action)
      if (kind === "permission") return window.showWarningMessage(text, action)
      return window.showInformationMessage(text, action)
    },
    focused: () => window.state.focused,
    visible: input.visible,
    approves: hostAutoApproves,
    workspace: (directory) => {
      if (!directory) return workspace.name
      return workspace.getWorkspaceFolder(Uri.file(directory))?.name ?? path.basename(directory)
    },
    show: input.show,
  })
}
