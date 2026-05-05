import { describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { registerToggleAutoApprove, type AutoApproveController } from "../../src/commands/toggle-auto-approve"
import { createAutoApproveBridge } from "../../src/kilo-provider/auto-approve"
import type { Event, KiloClient } from "@kilocode/sdk/v2/client"
import type { KiloConnectionService } from "../../src/services/cli-backend/connection-service"

type ConfigEvent = { affectsConfiguration(key: string): boolean }
type Permission = { id: string }

function defer<T>() {
  const state = {} as { resolve: (value: T) => void; reject: (err: unknown) => void }
  const promise = new Promise<T>((resolve, reject) => {
    state.resolve = resolve
    state.reject = reject
  })
  return { promise, resolve: state.resolve, reject: state.reject }
}

function config(initial: boolean, info: Record<string, unknown> = {}) {
  const handlers: Array<(event: ConfigEvent) => void> = []
  const updates: Array<{ key: string; value: unknown; target: unknown }> = []
  const messages: string[] = []
  const commands = new Map<string, (...args: unknown[]) => unknown>()
  const state = { active: initial }
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

  api.workspace.getConfiguration = () => ({
    get: (_key, fallback) => state.active ?? fallback,
    inspect: () => info,
    update: async (key, value, target) => {
      updates.push({ key, value, target })
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
    emit(key = "kilo-code.new.autoApprove.enabled") {
      for (const handler of handlers) handler({ affectsConfiguration: (name) => name === key })
    },
  }
}

function context() {
  return { subscriptions: [] as Array<{ dispose(): void }> } as vscode.ExtensionContext
}

function connection(client: KiloClient | null) {
  const listeners: Array<(event: Event) => void> = []
  const svc = {
    getClient: () => {
      if (!client) throw new Error("not connected")
      return client
    },
    onEvent: (listener: (event: Event) => void) => {
      listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    },
  } as unknown as KiloConnectionService

  return {
    svc,
    emit(event: Event) {
      for (const listener of listeners) listener(event)
    },
  }
}

function client(opts: {
  list?: (dir: string) => Promise<{ data: Permission[] }>
  reply?: (args: { requestID: string; directory: string; reply: "once" }) => Promise<unknown>
}) {
  return {
    permission: {
      list: async (args: { directory: string }) => opts.list?.(args.directory) ?? { data: [] },
      reply: async (args: { requestID: string; directory: string; reply: "once" }) => opts.reply?.(args),
    },
  } as unknown as KiloClient
}

function asked(id: string, sessionID = "ses_1") {
  return { type: "permission.asked", properties: { id, sessionID } } as Event
}

describe("registerToggleAutoApprove", () => {
  it("restores persisted state, follows config changes, and persists toggles to the closest configured scope", async () => {
    const env = config(true, { workspaceValue: false })
    const replies: unknown[] = []
    const conn = connection(client({ reply: async (args) => replies.push(args) }))
    const ctrl = registerToggleAutoApprove(
      context(),
      conn.svc,
      (session) => `/repo/${session}`,
      () => ["/repo"],
    )
    const changes: boolean[] = []
    ctrl.onChange((active) => changes.push(active))

    expect(ctrl.active()).toBe(true)
    conn.emit(asked("perm_1"))
    expect(replies).toEqual([{ requestID: "perm_1", directory: "/repo/ses_1", reply: "once" }])

    env.active = false
    env.emit()
    expect(ctrl.active()).toBe(false)
    expect(changes).toEqual([false])

    conn.emit(asked("perm_2"))
    expect(replies).toHaveLength(1)

    await ctrl.toggle()
    expect(ctrl.active()).toBe(true)
    expect(changes).toEqual([false, true])
    expect(env.updates).toEqual([{ key: "enabled", value: true, target: vscode.ConfigurationTarget.Workspace }])
    expect(env.messages).toContain("Auto-approve enabled")
  })

  it("cancels pending permission drains when disabled during an enable generation", async () => {
    config(false)
    const gate = defer<{ data: Permission[] }>()
    const started = defer<void>()
    const dirs: string[] = []
    const replies: unknown[] = []
    const conn = connection(
      client({
        list: async (dir) => {
          dirs.push(dir)
          if (dir === "/one") {
            started.resolve()
            return gate.promise
          }
          return { data: [{ id: "perm_other" }] }
        },
        reply: async (args) => replies.push(args),
      }),
    )
    const ctrl = registerToggleAutoApprove(
      context(),
      conn.svc,
      () => "/repo",
      () => ["/one", "/two"],
    )

    const enable = ctrl.toggle()
    await started.promise
    const disable = ctrl.toggle()
    gate.resolve({ data: [{ id: "perm_1" }] })
    await Promise.all([enable, disable])

    expect(ctrl.active()).toBe(false)
    expect(dirs).toEqual(["/one"])
    expect(replies).toEqual([])
  })
})

describe("createAutoApproveBridge", () => {
  it("syncs initial state, consumes toggle requests, forwards unrelated messages, and disposes listeners", async () => {
    const posts: unknown[] = []
    const forwarded: unknown[] = []
    const listeners = new Set<(active: boolean) => void>()
    const state = { active: false }
    const ctrl: AutoApproveController = {
      active: () => state.active,
      toggle: async () => {
        state.active = !state.active
        for (const listener of listeners) listener(state.active)
        return state.active
      },
      onChange(listener) {
        listeners.add(listener)
        return { dispose: () => listeners.delete(listener) }
      },
    }
    const bridge = createAutoApproveBridge(
      ctrl,
      (msg) => posts.push(msg),
      async (msg) => {
        forwarded.push(msg)
        return { type: "forwarded" }
      },
    )

    expect(await bridge.handle({ type: "webviewReady" })).toEqual({ type: "forwarded" })
    expect(await bridge.handle({ type: "requestAutoApproveState" })).toBeNull()
    expect(await bridge.handle({ type: "toggleAutoApprove" })).toBeNull()
    expect(await bridge.handle({ type: "other" })).toEqual({ type: "forwarded" })

    expect(posts).toEqual([
      { type: "autoApproveState", active: false },
      { type: "autoApproveState", active: false },
      { type: "autoApproveState", active: true },
    ])
    expect(forwarded).toEqual([{ type: "webviewReady" }, { type: "other" }])

    bridge.dispose()
    state.active = false
    for (const listener of listeners) listener(state.active)
    expect(posts).toHaveLength(3)
  })
})
