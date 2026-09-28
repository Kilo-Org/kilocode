import { describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { registerToggleApproveForMe, type ApproveForMeController } from "../../src/commands/toggle-approve-for-me"
import { createApproveForMeBridge } from "../../src/kilo-provider/approve-for-me"

type ConfigEvent = { affectsConfiguration(key: string): boolean }

function config(initial: { active?: boolean; visible?: boolean } = {}) {
  const handlers: Array<(event: ConfigEvent) => void> = []
  const updates: Array<{ key: string; value: unknown; target: unknown }> = []
  const messages: string[] = []
  const commands = new Map<string, (...args: unknown[]) => unknown>()
  const state = { active: initial.active ?? false, visible: initial.visible ?? false }
  const api = vscode as unknown as {
    workspace: {
      getConfiguration: (section?: string) => {
        get: <T>(key: string, fallback?: T) => T | boolean
        inspect: <T>(key: string) => Record<string, unknown> | undefined
        update: (key: string, value: unknown, target: unknown) => Promise<void>
      }
      onDidChangeConfiguration: (listener: (event: ConfigEvent) => void) => { dispose(): void }
    }
    window: { showInformationMessage: (message: string) => Promise<undefined> }
    commands: { registerCommand: (command: string, callback: (...args: unknown[]) => unknown) => { dispose(): void } }
  }

  api.workspace.getConfiguration = (section) => ({
    get: (_key, fallback) => (section?.endsWith("experimental") ? state.visible : state.active) ?? fallback,
    inspect: () => ({}),
    update: async (_key, value) => {
      updates.push({ key: _key, value, target: undefined })
      state.active = Boolean(value)
    },
  })
  api.workspace.onDidChangeConfiguration = (listener) => {
    handlers.push(listener)
    return {
      dispose() {
        const index = handlers.indexOf(listener)
        if (index >= 0) handlers.splice(index, 1)
      },
    }
  }
  api.window.showInformationMessage = async (message) => {
    messages.push(message)
    return undefined
  }
  api.commands.registerCommand = (command, callback) => {
    commands.set(command, callback)
    return { dispose: () => undefined }
  }

  return {
    updates,
    messages,
    commands,
    set active(value: boolean) {
      state.active = value
    },
    set visible(value: boolean) {
      state.visible = value
    },
    emit(key = "kilo-code.new.approveForMe.enabled") {
      for (const handler of handlers) handler({ affectsConfiguration: (name) => name === key })
    },
  }
}

function context() {
  return { subscriptions: [] as Array<{ dispose(): void }> } as vscode.ExtensionContext
}

describe("registerToggleApproveForMe", () => {
  it("ignores toggle attempts while the experimental flag is off, including from the Command Palette", async () => {
    const env = config()
    const ctrl = registerToggleApproveForMe(context())

    expect(ctrl.active()).toBe(false)
    expect(ctrl.visible()).toBe(false)

    expect(await ctrl.toggle()).toBe(false)

    expect(ctrl.active()).toBe(false)
    expect(env.updates).toEqual([])
    expect(env.messages).toEqual([])
  })

  it("toggles state and persists it once the experimental flag is on", async () => {
    const env = config({ visible: true })
    const ctrl = registerToggleApproveForMe(context())

    const changes: Array<{ active: boolean; visible: boolean }> = []
    ctrl.onChange((state) => changes.push(state))

    await ctrl.toggle()

    expect(ctrl.active()).toBe(true)
    expect(changes).toEqual([{ active: true, visible: true }])
    expect(env.updates).toEqual([{ key: "enabled", value: true, target: undefined }])
    expect(env.messages).toContain("Approve for me is enabled. This entry point does not change approval behavior yet.")
  })

  it("follows visibility flag changes independently of the toggle", () => {
    const env = config()
    const ctrl = registerToggleApproveForMe(context())
    const changes: Array<{ active: boolean; visible: boolean }> = []
    ctrl.onChange((state) => changes.push(state))

    env.visible = true
    env.emit("kilo-code.new.experimental.approveForMe")

    expect(ctrl.visible()).toBe(true)
    expect(ctrl.active()).toBe(false)
    expect(changes).toEqual([{ active: false, visible: true }])
  })
})

describe("createApproveForMeBridge", () => {
  it("syncs initial state, consumes toggle requests, and forwards unrelated messages", async () => {
    const posts: unknown[] = []
    const forwarded: unknown[] = []
    const listeners = new Set<(state: { active: boolean; visible: boolean }) => void>()
    const state = { active: false, visible: true }
    const ctrl: ApproveForMeController = {
      active: () => state.active,
      visible: () => state.visible,
      toggle: async () => {
        state.active = !state.active
        for (const listener of listeners) listener(state)
        return state.active
      },
      onChange(listener) {
        listeners.add(listener)
        return { dispose: () => listeners.delete(listener) }
      },
    }
    const bridge = createApproveForMeBridge(
      ctrl,
      (msg) => posts.push(msg),
      async (msg) => {
        forwarded.push(msg)
        return { type: "forwarded" }
      },
    )

    expect(await bridge.handle({ type: "webviewReady" })).toEqual({ type: "forwarded" })
    expect(await bridge.handle({ type: "requestApproveForMeState" })).toBeNull()
    expect(await bridge.handle({ type: "toggleApproveForMe" })).toBeNull()
    expect(await bridge.handle({ type: "other" })).toEqual({ type: "forwarded" })

    expect(posts).toEqual([
      { type: "approveForMeState", active: false, visible: true },
      { type: "approveForMeState", active: false, visible: true },
      { type: "approveForMeState", active: true, visible: true },
    ])
    expect(forwarded).toEqual([{ type: "webviewReady" }, { type: "other" }])

    bridge.dispose()
    state.active = false
    for (const listener of listeners) listener(state)
    expect(posts).toHaveLength(3)
  })
})
