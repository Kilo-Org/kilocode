import * as vscode from "vscode"
import type { Config } from "@kilocode/sdk/v2/client"
import type { KiloConnectionService } from "../services/cli-backend/connection-service"
import type { WorkStyle, WorkStyleConfig, WorkStyleState } from "../shared/work-style-presets"
import { applyWorkStyle, type WorkStyleSettingSnapshot } from "./work-style-apply"

function inspect(config: vscode.WorkspaceConfiguration, key: string): WorkStyleSettingSnapshot {
  const info = config.inspect(key)
  return {
    global: info?.globalValue,
    customized:
      info?.globalValue !== undefined || info?.workspaceValue !== undefined || info?.workspaceFolderValue !== undefined,
  }
}

async function apply(connection: KiloConnectionService, directory: string, style: WorkStyle) {
  const settings = vscode.workspace.getConfiguration("kilo-code.new")
  return applyWorkStyle(style, {
    read: async () => {
      const client = await connection.getClientAsync(directory)
      const { data } = await client.config.get({ directory }, { throwOnError: true })
      return (data ?? {}) as WorkStyleConfig
    },
    inspect: (key) => inspect(settings, key),
    write: async (key, value) => {
      await settings.update(key, value, vscode.ConfigurationTarget.Global)
    },
    patch: async (config) => {
      const client = await connection.getClientAsync(directory)
      await client.global.config.update({ config: config as Config }, { throwOnError: true })
    },
  })
}

export async function handleWorkStyleApplyMessage(input: {
  message: { type?: string; style?: WorkStyleState }
  connection: KiloConnectionService
  directory: string
  post: (message: unknown) => void
}): Promise<boolean> {
  if (input.message.type !== "applyWorkStyle") return false
  if (input.message.style !== "human-in-the-loop" && input.message.style !== "autonomous") {
    console.error("[Kilo New] Invalid style in applyWorkStyle message")
    input.post({ type: "workStyleApplyFailed", message: "Invalid work style", rollbackFailed: false })
    return true
  }

  const result = await apply(input.connection, input.directory, input.message.style)
  input.post(
    result.ok
      ? { type: "workStyleApplied", style: input.message.style }
      : {
          type: "workStyleApplyFailed",
          message: result.error,
          rollbackFailed: result.rollback.length > 0,
        },
  )
  return true
}
