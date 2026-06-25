import * as vscode from "vscode"
import type { Config } from "@kilocode/sdk/v2/client"
import type { KiloConnectionService } from "../services/cli-backend/connection-service"
import {
  isOnboardingAgent,
  type WorkStyle,
  type WorkStyleConfig,
  type WorkStyleState,
} from "../shared/work-style-presets"
import { applyWorkStyle, type WorkStyleConfigPatch, type WorkStyleSettingSnapshot } from "./work-style-apply"

function inspect(config: vscode.WorkspaceConfiguration, key: string): WorkStyleSettingSnapshot {
  const info = config.inspect(key)
  return {
    global: info?.globalValue,
    customized:
      info?.globalValue !== undefined || info?.workspaceValue !== undefined || info?.workspaceFolderValue !== undefined,
  }
}

async function apply(connection: KiloConnectionService, dir: string, style: WorkStyle, agent: string) {
  const settings = vscode.workspace.getConfiguration("kilo-code.new")
  return applyWorkStyle(style, agent, {
    read: async () => {
      const client = await connection.getClientAsync(dir)
      const { data } = await client.config.get({ directory: dir }, { throwOnError: true })
      return (data ?? {}) as WorkStyleConfig
    },
    global: async () => {
      const client = await connection.getClientAsync(dir)
      const { data } = await client.global.config.get({ throwOnError: true })
      return (data ?? {}) as WorkStyleConfigPatch
    },
    inspect: (key) => inspect(settings, key),
    write: async (key, value) => {
      await settings.update(key, value, vscode.ConfigurationTarget.Global)
    },
    patch: async (patch) => {
      const client = await connection.getClientAsync(dir)
      await client.global.config.update({ config: patch as Config }, { throwOnError: true })
    },
  })
}

export async function handleWorkStyleApplyMessage(input: {
  message: { type?: string; style?: WorkStyleState; agent?: unknown }
  connection: KiloConnectionService
  directory: string
  post: (message: unknown) => void
  refresh?: () => Promise<void>
}): Promise<boolean> {
  if (input.message.type !== "applyWorkStyle") return false
  if (input.message.style !== "human-in-the-loop" && input.message.style !== "autonomous") {
    console.error("[Kilo New] Invalid style in applyWorkStyle message")
    input.post({ type: "workStyleApplyFailed", message: "Invalid work style", rollbackFailed: false })
    return true
  }
  if (!isOnboardingAgent(input.message.agent)) {
    console.error("[Kilo New] Invalid agent in applyWorkStyle message")
    input.post({ type: "workStyleApplyFailed", message: "Invalid default agent", rollbackFailed: false })
    return true
  }

  const result = await apply(input.connection, input.directory, input.message.style, input.message.agent)
  if (!result.ok) {
    input.post({
      type: "workStyleApplyFailed",
      message: result.error,
      rollbackFailed: result.rollback.length > 0,
    })
    return true
  }

  await input.refresh?.().catch((err: unknown) => {
    console.error("[Kilo New] Failed to refresh config after work style onboarding:", err)
  })
  input.post({ type: "workStyleApplied", style: result.style, agent: result.agent })
  return true
}
