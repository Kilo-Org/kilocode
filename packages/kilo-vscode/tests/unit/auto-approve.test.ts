import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import * as vscode from "vscode"
import { registerToggleAutoApprove, type AutoApproveController } from "../../src/commands/toggle-auto-approve"
import { createAutoApproveBridge } from "../../src/kilo-provider/auto-approve"
import type { Event, KiloClient } from "@kilocode/sdk/v2/client"
import type { KiloConnectionService } from "../../src/services/cli-backend/connection-service"

const ROOT = join(import.meta.dir, "..", "..")
const PACKAGE = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  contributes: { configuration: { properties: Record<string, { type: string; default?: unknown; scope?: string }> } }
}

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

type Layers = { globalValue?: boolean; workspaceValue?: boolean; workspaceFolderValue?: boolean }

function config(layers: Layers = {}) {
  const handlers: Array<(event: ConfigEvent) => void> = []
  const updates: Array<{ key: string; value: unknown; target: unknown }> = []
  const messages: string[] = []
  const commands = new Map<string, (...args: unknown[]) => unknown>()
  const state: Layers = { ...layers }
  const api = vscode as unknown as {
    workspace: {
      getConfiguration: (section?: string) => {
        get: (key: string, fallback?: unknown) => unknown
        inspect: (key: string) => Record<string, unknown> | undefined
        update: (key: string, value: unknown, target: unknown) => Promise<void>
      }
      onDidChangeConfiguration: (listener: (event: ConfigEvent) => void) => { dispose(): void }
    }
    window: { showInformationMessage: (message: string) => Promise<undefined> }
    commands: { registerCommand: (command: string, callback: (...args: unknown[]) => unknown) => { dispose(): void } }
  }

  const slot = (target: unknown) => {
    if (target === vscode.ConfigurationTarget.Workspace) return "workspaceValue"
    if (target === vscode.ConfigurationTarget.WorkspaceFolder) return "workspaceFolderValue"
    return "globalValue"
  }

  api.workspace.getConfiguration = () => ({
    get: (_key, fallback) => state.workspaceFolderValue ?? state.workspaceValue ?? state.globalValue ?? fallback,
    inspect: () => {
      const info: Record<string, unknown> = {}
      if (state.globalValue !== undefined) info.globalValue = state.globalValue
      if (state.workspaceValue !== undefined) info.workspaceValue = state.workspaceValue
      if (state.workspaceFolderValue !== undefined) info.workspaceFolderValue = state.workspaceFolderValue
      return info
    },
    update: async (key, value, target) => {
      updates.push({ key, value, target })
      state[slot(target)] = Boolean(value)
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
    layers: state,
    updates,
    messages,
    commands,
    emit(key = "kilo-code.new.autoApprove.enabled") {
      for (const handler of handlers) handler({ affectsConfiguration: (name) => name === key })
    },
  }
}

function context() {
  return { subscriptions: [] as Array<{ dispose(): void }> } as vscode.ExtensionContext
}

function connection(client: KiloClient | null, dirs = new Map<string, string>()) {
  const svc = {
    getClient: () => {
      if (!client) throw new Error("not connected")
      return client
    },
    getPermissionDirectory: (id: string) => dirs.get(id),
  } as unknown as KiloConnectionService

  return { svc }
}

function client(opts: {
  list?: (dir: string) => Promise<{ data: Permission[] }>
  reply?: (
    args: { requestID: string; directory: string; reply: "once" },
    options?: { throwOnError?: boolean },
  ) => Promise<unknown>
}) {
  return {
    permission: {
      list: async (args: { directory: string }) => opts.list?.(args.directory) ?? { data: [] },
      reply: async (
        args: { requestID: string; directory: string; reply: "once" },
        options?: { throwOnError?: boolean },
      ) => opts.reply?.(args, options),
    },
  } as unknown as KiloClient
}

function asked(id: string, sessionID = "ses_1") {
  return { type: "permission.asked", properties: { id, sessionID } } as Extract<Event, { type: "permission.asked" }>
}

describe("registerToggleAutoApprove", () => {
  it("restores the user setting, follows config changes, and writes toggles to the user setting", async () => {
    const env = config({ globalValue: true, workspaceValue: false })
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
    expect(await ctrl.approve(asked("perm_1"))).toBe(true)
    expect(replies).toEqual([{ requestID: "perm_1", directory: "/repo/ses_1", reply: "once" }])

    env.layers.globalValue = false
    env.emit()
    expect(ctrl.active()).toBe(false)
    expect(changes).toEqual([false])

    expect(await ctrl.approve(asked("perm_2"))).toBe(false)
    expect(replies).toHaveLength(1)

    await ctrl.toggle()
    expect(ctrl.active()).toBe(true)
    expect(changes).toEqual([false, true])
    expect(env.updates).toEqual([{ key: "enabled", value: true, target: vscode.ConfigurationTarget.Global }])
    expect(env.messages).toContain("Auto-approve enabled. Sandbox escalation prompts are excluded.")
  })

  it("reads the user layer only, with no user value", async () => {
    config({ workspaceValue: true })
    const replies: unknown[] = []
    const conn = connection(client({ reply: async (args) => replies.push(args) }))
    const ctrl = registerToggleAutoApprove(
      context(),
      conn.svc,
      () => "/workspace",
      () => ["/workspace"],
    )

    expect(ctrl.active()).toBe(false)
    expect(await ctrl.approve(asked("perm_1"))).toBe(false)
    expect(replies).toEqual([])
  })

  it("reads the user layer only, with a folder value present", async () => {
    config({ workspaceFolderValue: true })
    const replies: unknown[] = []
    const conn = connection(client({ reply: async (args) => replies.push(args) }))
    const ctrl = registerToggleAutoApprove(
      context(),
      conn.svc,
      () => "/workspace",
      () => ["/workspace"],
    )

    expect(ctrl.active()).toBe(false)
    expect(await ctrl.approve(asked("perm_1"))).toBe(false)
    expect(replies).toEqual([])
  })

  it("replies once when the user setting enables it", async () => {
    config({ globalValue: true })
    const replies: unknown[] = []
    const conn = connection(client({ reply: async (args) => replies.push(args) }))
    const ctrl = registerToggleAutoApprove(
      context(),
      conn.svc,
      () => "/workspace",
      () => ["/workspace"],
    )

    expect(ctrl.active()).toBe(true)
    expect(await ctrl.approve(asked("perm_1"))).toBe(true)
    expect(replies).toEqual([{ requestID: "perm_1", directory: "/workspace", reply: "once" }])
  })

  it("turns on through the user setting while another layer holds a value", async () => {
    const env = config({ workspaceValue: true, globalValue: false })
    const conn = connection(client({}))
    const ctrl = registerToggleAutoApprove(
      context(),
      conn.svc,
      () => "/workspace",
      () => ["/workspace"],
    )

    expect(ctrl.active()).toBe(false)
    await ctrl.toggle()
    expect(ctrl.active()).toBe(true)
    expect(env.updates).toEqual([{ key: "enabled", value: true, target: vscode.ConfigurationTarget.Global }])
  })

  it("keeps following the user layer after a configuration change", async () => {
    const env = config({ globalValue: false })
    const conn = connection(client({}))
    const ctrl = registerToggleAutoApprove(
      context(),
      conn.svc,
      () => "/workspace",
      () => ["/workspace"],
    )

    expect(ctrl.active()).toBe(false)
    env.layers.workspaceValue = true
    env.emit()
    expect(ctrl.active()).toBe(false)
  })

  it("uses the SSE directory for worktree permissions before session mappings are available", async () => {
    config({ globalValue: true })
    const replies: unknown[] = []
    const conn = connection(client({ reply: async (args) => replies.push(args) }))
    const ctrl = registerToggleAutoApprove(
      context(),
      conn.svc,
      () => "/workspace",
      () => ["/workspace"],
    )

    await ctrl.approve(asked("perm_worktree", "ses_worktree"), "/workspace/.kilo/worktrees/feature")
    await ctrl.approve(asked("perm_child", "ses_child"), "/workspace/.kilo/worktrees/feature")

    expect(replies).toEqual([
      { requestID: "perm_worktree", directory: "/workspace/.kilo/worktrees/feature", reply: "once" },
      { requestID: "perm_child", directory: "/workspace/.kilo/worktrees/feature", reply: "once" },
    ])
  })

  it("uses the shared permission directory before falling back to session mappings", async () => {
    config({ globalValue: true })
    const replies: unknown[] = []
    const conn = connection(
      client({ reply: async (args) => replies.push(args) }),
      new Map([["perm_shared", "/workspace/.kilo/worktrees/shared"]]),
    )
    const ctrl = registerToggleAutoApprove(
      context(),
      conn.svc,
      () => "/workspace",
      () => ["/workspace"],
    )

    await ctrl.approve(asked("perm_shared", "ses_child"))

    expect(replies).toEqual([
      { requestID: "perm_shared", directory: "/workspace/.kilo/worktrees/shared", reply: "once" },
    ])
  })

  it("returns unhandled when an automatic reply fails", async () => {
    config({ globalValue: true })
    const conn = connection(
      client({
        reply: async (_args, options) => {
          expect(options).toEqual({ throwOnError: true })
          throw new Error("offline")
        },
      }),
    )
    const ctrl = registerToggleAutoApprove(
      context(),
      conn.svc,
      () => "/workspace",
      () => ["/workspace"],
    )

    expect(await ctrl.approve(asked("perm_1"))).toBe(false)
  })

  it("cancels pending permission drains when disabled during an enable generation", async () => {
    config({ globalValue: false })
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

  it("cancels a pending automatic reply when auto-approve is turned off", async () => {
    const env = config({ globalValue: true })
    const first = defer<void>()
    const later: unknown[] = []
    let calls = 0
    const conn = connection(
      client({
        reply: async (args) => {
          calls++
          if (calls === 1) {
            first.resolve()
            throw new Error("fetch failed")
          }
          later.push(args)
        },
      }),
    )
    const ctrl = registerToggleAutoApprove(
      context(),
      conn.svc,
      () => "/workspace",
      () => ["/workspace"],
    )

    const pending = ctrl.approve(asked("perm_retry"))
    await first.promise
    env.layers.globalValue = false
    env.emit()

    expect(await pending).toBe(false)
    expect(calls).toBe(1)
    expect(later).toEqual([])
  })
})

describe("auto-approve setting contribution", () => {
  it("declares a user-scoped boolean that starts disabled", () => {
    expect(PACKAGE.contributes.configuration.properties["kilo-code.new.autoApprove.enabled"]).toEqual({
      type: "boolean",
      default: false,
      scope: "application",
      description: expect.any(String),
    })
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
      approve: async () => false,
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
