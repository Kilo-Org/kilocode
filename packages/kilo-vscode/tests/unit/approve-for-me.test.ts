import { afterEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { registerToggleApproveForMe, type ApproveForMeController } from "../../src/commands/toggle-approve-for-me"
import { createApproveForMeBridge } from "../../src/kilo-provider/approve-for-me"

// config() below mutates the process-wide vscode mock (shared across every test
// file). Restore it after each test so a later file doesn't observe this one's stubs.
const original = {
  getConfiguration: vscode.workspace.getConfiguration,
  onDidChangeConfiguration: vscode.workspace.onDidChangeConfiguration,
  showInformationMessage: vscode.window.showInformationMessage,
  registerCommand: vscode.commands.registerCommand,
}
afterEach(() => {
  Object.assign(vscode.workspace, original)
  vscode.window.showInformationMessage = original.showInformationMessage
  vscode.commands.registerCommand = original.registerCommand
})

type Flags = { active: boolean; visible: boolean; auto: boolean }
type Update = { section: string; key: string; value: unknown; target: unknown }

// Fake settings store. Like VS Code, update() stores the value and then fires the
// configuration-change listeners.
function config(initial: Partial<Flags> = {}) {
  const handlers: Array<() => void> = []
  const updates: Update[] = []
  const messages: string[] = []
  const state: Flags = { active: false, visible: false, auto: false, ...initial }
  // What inspect() reports per setting, to test which scope a write targets.
  const scopes: Partial<Record<keyof Flags, Record<string, unknown>>> = {}
  const api = vscode as unknown as {
    workspace: {
      getConfiguration: (section?: string) => {
        get: <T>(key: string, fallback?: T) => T | boolean
        inspect: <T>(key: string) => Record<string, unknown> | undefined
        update: (key: string, value: unknown, target: unknown) => Promise<void>
      }
      onDidChangeConfiguration: (listener: () => void) => { dispose(): void }
    }
    window: { showInformationMessage: (message: string) => Promise<undefined> }
    commands: { registerCommand: (command: string, callback: (...args: unknown[]) => unknown) => { dispose(): void } }
  }
  const slot = (section = ""): keyof Flags =>
    section.endsWith("experimental") ? "visible" : section.endsWith("autoApprove") ? "auto" : "active"
  const emit = () => {
    for (const handler of [...handlers]) handler()
  }

  api.workspace.getConfiguration = (section) => ({
    get: (_key, fallback) => state[slot(section)] ?? fallback,
    inspect: () => scopes[slot(section)] ?? {},
    update: async (key, value, target) => {
      updates.push({ section: section ?? "", key, value, target })
      state[slot(section)] = Boolean(value)
      emit()
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
  api.commands.registerCommand = () => ({ dispose: () => undefined })

  return {
    state,
    scopes,
    updates,
    messages,
    // Simulates the user editing a setting directly (settings UI or settings.json).
    edit(flags: Partial<Flags>) {
      Object.assign(state, flags)
      emit()
    },
  }
}

function context() {
  return { subscriptions: [] as Array<{ dispose(): void }> } as vscode.ExtensionContext
}

const ME = "kilo-code.new.approveForMe"
const AUTO = "kilo-code.new.autoApprove"
const GLOBAL = vscode.ConfigurationTarget.Global

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
    expect(env.updates).toEqual([{ section: ME, key: "enabled", value: true, target: GLOBAL }])
    expect(env.messages).toContain("Approve for me is enabled. This entry point does not change approval behavior yet.")
  })

  it("follows visibility flag changes independently of the toggle", () => {
    const env = config()
    const ctrl = registerToggleApproveForMe(context())
    const changes: Array<{ active: boolean; visible: boolean }> = []
    ctrl.onChange((state) => changes.push(state))

    env.edit({ visible: true })

    expect(ctrl.visible()).toBe(true)
    expect(ctrl.active()).toBe(false)
    expect(changes).toEqual([{ active: false, visible: true }])
  })
})

describe("exclusion with auto-approve", () => {
  it("turns auto-approve off before turning approve-for-me on", async () => {
    const env = config({ visible: true, auto: true })
    const ctrl = registerToggleApproveForMe(context())

    expect(await ctrl.toggle()).toBe(true)

    expect(env.updates).toEqual([
      { section: AUTO, key: "enabled", value: false, target: GLOBAL },
      { section: ME, key: "enabled", value: true, target: GLOBAL },
    ])
    expect(env.state).toMatchObject({ active: true, auto: false })
    expect(env.messages).toEqual([
      "Approve for me is enabled and auto-approve is off. This entry point does not change approval behavior yet.",
    ])
  })

  it("yields when auto-approve is turned on afterwards", async () => {
    const env = config({ visible: true })
    const ctrl = registerToggleApproveForMe(context())
    await ctrl.toggle()
    const changes: boolean[] = []
    ctrl.onChange((state) => changes.push(state.active))
    env.updates.length = 0

    env.edit({ auto: true })

    expect(ctrl.active()).toBe(false)
    expect(env.state).toMatchObject({ active: false, auto: true })
    expect(env.updates).toEqual([{ section: ME, key: "enabled", value: false, target: GLOBAL }])
    expect(changes).toEqual([false])
  })

  it("turns auto-approve off when approve-for-me is switched on by editing settings", () => {
    const env = config({ visible: true, auto: true })
    const ctrl = registerToggleApproveForMe(context())
    env.updates.length = 0

    env.edit({ active: true })

    expect(ctrl.active()).toBe(true)
    expect(env.state).toMatchObject({ active: true, auto: false })
    expect(env.updates).toEqual([{ section: AUTO, key: "enabled", value: false, target: GLOBAL }])
  })

  it("always writes the user settings, even when a workspace value is reported", async () => {
    const env = config({ visible: true, auto: true })
    env.scopes.auto = { workspaceValue: true, workspaceFolderValue: true }
    const ctrl = registerToggleApproveForMe(context())

    await ctrl.toggle()

    expect(env.updates.map((update) => update.target)).toEqual([GLOBAL, GLOBAL])
  })

  it("lets approve-for-me win when both are on at startup", () => {
    const env = config({ visible: true, active: true, auto: true })
    const ctrl = registerToggleApproveForMe(context())

    expect(ctrl.active()).toBe(true)
    expect(env.state).toMatchObject({ active: true, auto: false })
    expect(env.updates).toEqual([{ section: AUTO, key: "enabled", value: false, target: GLOBAL }])
  })

  it("leaves auto-approve alone while the experimental flag is off", async () => {
    const env = config({ active: true, auto: true })
    const ctrl = registerToggleApproveForMe(context())

    env.edit({ auto: false })
    env.edit({ auto: true })
    await ctrl.toggle()

    expect(env.state).toMatchObject({ active: true, auto: true })
    expect(env.updates).toEqual([])
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
