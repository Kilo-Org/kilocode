import * as vscode from "vscode"
import type { WorkStyleSettings, WorkStyleState } from "../shared/work-style-presets"

export const WORK_STYLE_SETTING_KEYS = ["showTaskTimeline"] as const

export function getWorkStylePayload() {
  const config = vscode.workspace.getConfiguration("kilo-code.new")
  const inspect = (key: (typeof WORK_STYLE_SETTING_KEYS)[number]) => config.inspect(key)
  const defaults = Object.fromEntries(
    WORK_STYLE_SETTING_KEYS.map((key) => {
      const info = inspect(key)
      const customized =
        info?.globalValue !== undefined ||
        info?.workspaceValue !== undefined ||
        info?.workspaceFolderValue !== undefined
      return [key, !customized]
    }),
  ) as Record<keyof WorkStyleSettings, boolean>

  return {
    type: "workStyleLoaded" as const,
    style: config.get<WorkStyleState>("agentWorkStyle", "unset"),
    defaults,
  }
}

export function isWorkStyleSetting(key: string): boolean {
  return WORK_STYLE_SETTING_KEYS.includes(key as (typeof WORK_STYLE_SETTING_KEYS)[number]) || key === "agentWorkStyle"
}

export function watchWorkStyleConfig(post: (message: unknown) => void, next?: vscode.Disposable) {
  const watcher = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("kilo-code.new.agentWorkStyle")) post(getWorkStylePayload())
  })
  return next ? vscode.Disposable.from(watcher, next) : watcher
}

export async function setWorkStyle(style: WorkStyleState) {
  await vscode.workspace
    .getConfiguration("kilo-code.new")
    .update("agentWorkStyle", style, vscode.ConfigurationTarget.Global)
}

export async function handleWorkStyleMessage(input: {
  message: { type?: string; style?: WorkStyleState }
  post: (message: unknown) => void
}): Promise<boolean> {
  if (input.message.type === "requestWorkStyle") {
    input.post(getWorkStylePayload())
    return true
  }
  if (input.message.type !== "setWorkStyle") return false
  await setWorkStyle(input.message.style ?? "custom")
  input.post(getWorkStylePayload())
  return true
}
