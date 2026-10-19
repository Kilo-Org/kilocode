import { describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import type { Event, KiloClient } from "@kilocode/sdk/v2/client"
import { registerToggleAutoApprove } from "../../src/commands/toggle-auto-approve"
import type { KiloConnectionService } from "../../src/services/cli-backend/connection-service"

type Pending = { id: string; metadata?: Record<string, unknown> }

// The VS Code API surface the toggle uses, backed by an in-memory setting.
function settings(initial: boolean) {
  const state = { active: initial }
  const api = vscode as unknown as {
    workspace: {
      getConfiguration: () => unknown
      onDidChangeConfiguration: () => { dispose(): void }
    }
    window: { showInformationMessage: () => Promise<undefined> }
    commands: { registerCommand: () => { dispose(): void } }
  }
  api.workspace.getConfiguration = () => ({
    get: (_key: string, fallback?: boolean) => state.active ?? fallback,
    inspect: () => ({}),
    update: async (_key: string, value: unknown) => {
      state.active = Boolean(value)
    },
  })
  api.workspace.onDidChangeConfiguration = () => ({ dispose: () => undefined })
  api.window.showInformationMessage = async () => undefined
  api.commands.registerCommand = () => ({ dispose: () => undefined })
}

function controller(pending: Pending[] = []) {
  const replies: string[] = []
  const client = {
    permission: {
      list: async () => ({ data: pending }),
      reply: async (args: { requestID: string }) => {
        replies.push(args.requestID)
      },
    },
  } as unknown as KiloClient
  const service = {
    getClient: () => client,
    getPermissionDirectory: () => undefined,
  } as unknown as KiloConnectionService
  const ctrl = registerToggleAutoApprove(
    { subscriptions: [] } as unknown as vscode.ExtensionContext,
    service,
    () => "/repo",
    () => ["/repo"],
  )
  return { ctrl, replies }
}

function asked(id: string, metadata?: Record<string, unknown>) {
  return { type: "permission.asked", properties: { id, sessionID: "ses_1", metadata } } as Extract<
    Event,
    { type: "permission.asked" }
  >
}

describe("auto-approve and PreToolUse hook confirmations", () => {
  it("never answers a confirmation a hook asked for", async () => {
    settings(true)
    const { ctrl, replies } = controller()
    expect(await ctrl.approve(asked("perm_hook", { hookAsk: true, reason: "deploy script" }))).toBe(false)
    expect(await ctrl.approve(asked("perm_sandbox", { sandboxEscalation: true }))).toBe(false)
    expect(await ctrl.approve(asked("perm_plain", { hookAsk: false }))).toBe(true)
    expect(replies).toEqual(["perm_plain"])
  })

  it("skips hook confirmations when enabling drains pending prompts", async () => {
    settings(false)
    const { ctrl, replies } = controller([
      { id: "perm_hook", metadata: { hookAsk: true } },
      { id: "perm_edit" },
      { id: "perm_sandbox", metadata: { sandboxEscalation: true } },
    ])
    await ctrl.toggle()
    expect(ctrl.active()).toBe(true)
    expect(replies).toEqual(["perm_edit"])
  })
})
