import * as vscode from "vscode"
import type { KiloConnectionService } from "../services/cli-backend/connection-service"
import { getInitialWorkStyle, type WorkStyleSettings, type WorkStyleState } from "../shared/work-style-presets"

export const WORK_STYLE_SETTING_KEYS = ["showTaskTimeline"] as const

function getConfig() {
  return vscode.workspace.getConfiguration("kilo-code.new")
}

function isWorkStyleConfigured(): boolean {
  return getConfig().inspect<WorkStyleState>("agentWorkStyle")?.globalValue !== undefined
}

export function getWorkStylePayload() {
  const config = getConfig()
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
  const keys = ["agentWorkStyle", ...WORK_STYLE_SETTING_KEYS]
  const watcher = vscode.workspace.onDidChangeConfiguration((event) => {
    if (keys.some((key) => event.affectsConfiguration(`kilo-code.new.${key}`))) post(getWorkStylePayload())
  })
  return next ? vscode.Disposable.from(watcher, next) : watcher
}

export async function setWorkStyle(style: WorkStyleState) {
  await getConfig().update("agentWorkStyle", style, vscode.ConfigurationTarget.Global)
}

async function hasAnySession(connection: KiloConnectionService): Promise<boolean> {
  const client = await connection.getClientAsync()
  const { data } = await client.experimental.session.list(
    {
      roots: true,
      limit: 1,
      archived: true,
    },
    { throwOnError: true },
  )
  return data.length > 0
}

async function initializeWorkStyle(connection: KiloConnectionService): Promise<void> {
  if (isWorkStyleConfigured()) return

  const hasSessions = await hasAnySession(connection)

  if (isWorkStyleConfigured()) return
  await setWorkStyle(getInitialWorkStyle(hasSessions))
}

export async function handleWorkStyleMessage(input: {
  message: { type?: string; style?: WorkStyleState }
  connection: KiloConnectionService
  post: (message: unknown) => void
}): Promise<boolean> {
  if (input.message.type === "requestWorkStyle") {
    const initialized = await initializeWorkStyle(input.connection)
      .then(() => true)
      .catch((err: unknown) => {
        console.error("[Kilo New] Failed to initialize work style:", err)
        return false
      })
    const payload = getWorkStylePayload()
    input.post(initialized ? payload : { ...payload, style: "skipped" })
    return true
  }
  if (input.message.type !== "setWorkStyle") return false
  if (!input.message.style) {
    console.error("[Kilo New] Missing style in setWorkStyle message")
    return true
  }
  await setWorkStyle(input.message.style)
  input.post(getWorkStylePayload())
  return true
}
