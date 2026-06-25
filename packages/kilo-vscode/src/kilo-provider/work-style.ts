import * as vscode from "vscode"
import { agentOnboarding } from "../features"
import type { KiloConnectionService } from "../services/cli-backend/connection-service"
import { getInitialWorkStyle, type WorkStyleState } from "../shared/work-style-presets"
import { isDataAgentAvailable, prepareDataAgentOnce, type PreflightResult } from "./data-agent-preflight"
import { handleWorkStyleApplyMessage } from "./work-style-apply-handler"

export const WORK_STYLE_SETTING_KEYS = ["showTaskTimeline"] as const

function getConfig() {
  return vscode.workspace.getConfiguration("kilo-code.new")
}

function configured(): WorkStyleState | undefined {
  return getConfig().inspect<WorkStyleState>("agentWorkStyle")?.globalValue
}

export function getWorkStylePayload(
  connection: KiloConnectionService,
  available = agentOnboarding() && isDataAgentAvailable(connection),
) {
  return {
    type: "workStyleLoaded" as const,
    style: getConfig().get<WorkStyleState>("agentWorkStyle", "unset"),
    dataAgentAvailable: available,
  }
}

export function isWorkStyleSetting(key: string): boolean {
  return WORK_STYLE_SETTING_KEYS.includes(key as (typeof WORK_STYLE_SETTING_KEYS)[number]) || key === "agentWorkStyle"
}

export function watchWorkStyleConfig(
  connection: KiloConnectionService,
  post: (message: unknown) => void,
  next?: vscode.Disposable,
) {
  const keys = ["agentWorkStyle", ...WORK_STYLE_SETTING_KEYS]
  const watcher = vscode.workspace.onDidChangeConfiguration((event) => {
    if (keys.some((key) => event.affectsConfiguration(`kilo-code.new.${key}`))) {
      post(getWorkStylePayload(connection))
    }
  })
  return next ? vscode.Disposable.from(watcher, next) : watcher
}

export async function setWorkStyle(style: WorkStyleState) {
  await getConfig().update("agentWorkStyle", style, vscode.ConfigurationTarget.Global)
}

async function hasSession(connection: KiloConnectionService, dir: string): Promise<boolean> {
  const client = await connection.getClientAsync(dir)
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

type Prepare = (connection: KiloConnectionService, dir: string) => Promise<PreflightResult>

async function initialize(connection: KiloConnectionService, dir: string, prepare: Prepare, enabled: boolean) {
  const style = configured()
  if (style !== undefined) {
    if (style !== "unset" || !enabled) return false
    return (await prepare(connection, dir)).available
  }

  const sessions = await hasSession(connection, dir)
  const latest = configured()
  if (latest !== undefined) {
    if (latest !== "unset" || !enabled) return false
    return (await prepare(connection, dir)).available
  }

  const initial = getInitialWorkStyle(sessions)
  if (initial === "skipped") {
    if (configured() === undefined) await setWorkStyle(initial)
    return false
  }

  if (!enabled) {
    if (configured() === undefined) await setWorkStyle(initial)
    return false
  }

  const result = await prepare(connection, dir)
  if (configured() !== undefined) return result.available
  await setWorkStyle(initial)
  return result.available
}

export async function handleWorkStyleMessage(input: {
  message: { type?: string; style?: WorkStyleState; agent?: unknown }
  connection: KiloConnectionService
  directory: string
  post: (message: unknown) => void
  refresh?: () => Promise<void>
  prepareDataAgent?: Prepare
}): Promise<boolean> {
  if (input.message.type === "requestWorkStyle") {
    const state = await initialize(
      input.connection,
      input.directory,
      input.prepareDataAgent ?? prepareDataAgentOnce,
      agentOnboarding(),
    ).then(
      (available) => ({ ok: true, available }),
      (err: unknown) => {
        console.error("[Kilo New] Failed to initialize work style:", err)
        return { ok: false, available: false }
      },
    )
    const payload = getWorkStylePayload(input.connection, state.available)
    input.post(state.ok ? payload : { ...payload, style: "skipped" })
    return true
  }
  if (await handleWorkStyleApplyMessage(input)) return true
  if (input.message.type !== "setWorkStyle") return false
  if (!input.message.style) {
    console.error("[Kilo New] Missing style in setWorkStyle message")
    return true
  }
  const current = getConfig().inspect<WorkStyleState>("agentWorkStyle")?.globalValue
  const skip = input.message.style === "skipped"
  const complete = current === "human-in-the-loop" || current === "autonomous"
  if (!(skip && complete)) await setWorkStyle(input.message.style)
  input.post(getWorkStylePayload(input.connection))
  return true
}
