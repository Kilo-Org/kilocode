import * as vscode from "vscode"
import { integratedBrowserLinkDestination } from "../services/browser-automation/chrome-setting"
import { sessionLocation, type SessionLocation } from "./session-tabs"

type Post = (msg: unknown) => void

export function buildChatSettingsMessage() {
  const config = vscode.workspace.getConfiguration("kilo-code.new.chat")
  return {
    type: "chatSettingsLoaded" as const,
    settings: {
      shiftTabCyclesVariant: config.get<boolean>("shiftTabCyclesVariant", true),
      browserAutomation: vscode.workspace
        .getConfiguration("kilo-code.new.experimental")
        .get("browserAutomation", false),
      agentManagerBrowserOpenLinksIn: integratedBrowserLinkDestination(),
      workspaceTrusted: vscode.workspace.isTrusted,
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

export function currentSessionLocation(): SessionLocation {
  return sessionLocation(vscode.workspace.getConfiguration("kilo-code.new").get("sessionOpenLocation"))
}

export function buildSessionLocationMessage() {
  return {
    type: "sessionLocationLoaded" as const,
    location: currentSessionLocation(),
  }
}

export function watchChatConfig(post: Post): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("kilo-code.new.sessionOpenLocation")) {
      post(buildSessionLocationMessage())
    }
    if (
      event.affectsConfiguration("kilo-code.new.chat") ||
      event.affectsConfiguration("kilo-code.new.experimental.browserAutomation") ||
      event.affectsConfiguration("kilo-code.new.agentManager.browser.openLinksIn")
    ) {
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
