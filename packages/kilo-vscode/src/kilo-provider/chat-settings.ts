import * as vscode from "vscode"

type Post = (msg: unknown) => void

export function buildChatSettingsMessage() {
  const config = vscode.workspace.getConfiguration("kilo-code.new.chat")
  return {
    type: "chatSettingsLoaded" as const,
    settings: {
      shiftTabCyclesVariant: config.get<boolean>("shiftTabCyclesVariant", true),
    },
  }
}

export function buildTimelineSettingMessage() {
  const config = vscode.workspace.getConfiguration("kilo-code.new")
  return {
    type: "timelineSettingLoaded" as const,
    visible: config.get<boolean>("showTaskTimeline", true),
  }
}

export function watchChatConfig(post: Post): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("kilo-code.new.chat")) {
      post(buildChatSettingsMessage())
    }
    if (event.affectsConfiguration("kilo-code.new.showTaskTimeline")) {
      post(buildTimelineSettingMessage())
    }
  })
}

export function validChatSetting(key: string, value: unknown) {
  return key === "shiftTabCyclesVariant" && typeof value === "boolean"
}
