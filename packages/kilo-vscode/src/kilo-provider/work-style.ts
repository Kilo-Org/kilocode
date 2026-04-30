import * as vscode from "vscode"
import { buildSettingPath } from "../kilo-provider-utils"
import type { WorkStyleSettings, WorkStyleState } from "../shared/work-style-presets"

export const WORK_STYLE_KEY = "kilo.agentWorkStyle.onboardingShown"
export const WORK_STYLE_SETTING_KEYS = ["showTaskTimeline"] as const

export function getWorkStylePayload(context?: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration("kilo-code.new")
  const inspect = (key: (typeof WORK_STYLE_SETTING_KEYS)[number]) => config.inspect(key)
  const defaults = Object.fromEntries(
    WORK_STYLE_SETTING_KEYS.map((key) => {
      const info = inspect(key)
      const customized =
        info?.globalValue !== undefined || info?.workspaceValue !== undefined || info?.workspaceFolderValue !== undefined
      return [key, !customized]
    }),
  ) as Record<keyof WorkStyleSettings, boolean>

  return {
    type: "workStyleLoaded" as const,
    style: config.get<WorkStyleState>("agentWorkStyle", "unset"),
    onboardingShown: context?.globalState.get<boolean>(WORK_STYLE_KEY, false) ?? false,
    settings: {
      showTaskTimeline: config.get<boolean>("showTaskTimeline", true),
    },
    defaults,
  }
}

export function isWorkStyleSetting(key: string): boolean {
  return WORK_STYLE_SETTING_KEYS.includes(key as (typeof WORK_STYLE_SETTING_KEYS)[number]) || key === "agentWorkStyle"
}

export async function setWorkStyle(input: {
  context?: vscode.ExtensionContext
  style: WorkStyleState
  shown: boolean
  source: "onboarding" | "settings"
}) {
  await vscode.workspace
    .getConfiguration("kilo-code.new")
    .update("agentWorkStyle", input.style, vscode.ConfigurationTarget.Global)
  if (input.source === "onboarding" || input.shown) await input.context?.globalState.update(WORK_STYLE_KEY, input.shown)
}

export async function updateSetting(input: {
  context?: vscode.ExtensionContext
  key: string
  value: unknown
  post: (message: unknown) => void
}) {
  const { section, leaf } = buildSettingPath(input.key)
  const config = vscode.workspace.getConfiguration(`kilo-code.new${section ? `.${section}` : ""}`)
  await config.update(leaf, input.value, vscode.ConfigurationTarget.Global)
  if (isWorkStyleSetting(input.key)) input.post(getWorkStylePayload(input.context))
}

export async function handleWorkStyleMessage(input: {
  context?: vscode.ExtensionContext
  message: { type?: string; style?: WorkStyleState; shown?: boolean; source?: "onboarding" | "settings" }
  post: (message: unknown) => void
}): Promise<boolean> {
  if (input.message.type === "requestWorkStyle") {
    input.post(getWorkStylePayload(input.context))
    return true
  }
  if (input.message.type !== "setWorkStyle") return false
  await setWorkStyle({
    context: input.context,
    style: input.message.style ?? "custom",
    shown: input.message.shown ?? true,
    source: input.message.source ?? "settings",
  })
  input.post(getWorkStylePayload(input.context))
  return true
}
