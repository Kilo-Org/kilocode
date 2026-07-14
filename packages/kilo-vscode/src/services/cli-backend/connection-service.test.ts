import { describe, expect, test } from "bun:test"
import * as vscode from "vscode"
import { KiloConnectionService } from "./connection-service"

function state(value: boolean) {
  return {
    get: <T>() => value as T,
    update: async () => undefined,
  }
}

describe("KiloConnectionService sandbox preference", () => {
  test("uses workspace state instead of extension-global state", () => {
    const service = new KiloConnectionService({
      workspaceState: state(false),
      globalState: state(true),
    } as any)

    expect(service.sandboxPreference.resolve(true)).toBe(false)
  })
})

describe("KiloConnectionService clients", () => {
  test("returns a connected client without a workspace folder", async () => {
    const service = new KiloConnectionService({} as any)
    const client = {}
    const workspace = vscode.workspace as { workspaceFolders?: readonly vscode.WorkspaceFolder[] }
    const folders = workspace.workspaceFolders

    ;(service as any).client = client
    ;(service as any).state = "connected"
    workspace.workspaceFolders = undefined

    try {
      expect(await service.getClientAsync()).toBe(client)
    } finally {
      workspace.workspaceFolders = folders
    }
  })
})

describe("KiloConnectionService viewed sessions", () => {
  test("keeps Agent Manager sessions when sidebar visibility changes during a flush", async () => {
    const service = new KiloConnectionService({} as any)
    const calls: Array<{ viewer: { id: string; active: boolean }; attached: string[]; visible: string[] }> = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let active = 0
    let max = 0

    ;(service as any).client = {
      session: {
        viewed: async (input: { viewer: { id: string; active: boolean }; attached: string[]; visible: string[] }) => {
          calls.push(input)
          active += 1
          max = Math.max(max, active)
          if (calls.length === 1) await gate
          active -= 1
        },
      },
    }

    service.registerVisible("agent-manager", ["am-1"])
    service.registerAttached("agent-manager", ["am-1", "am-2"])
    await Bun.sleep(175)
    expect(calls).toHaveLength(1)
    expect([...calls[0].visible].sort()).toEqual(["am-1"])
    expect([...calls[0].attached].sort()).toEqual(["am-1", "am-2"])

    service.registerVisible("sidebar", ["side-1"])
    await Bun.sleep(175)
    expect(calls).toHaveLength(1)

    release()
    await Bun.sleep(10)
    expect(max).toBe(1)
    expect([...calls[1].visible].sort()).toEqual(["am-1", "side-1"])
    expect([...calls[1].attached].sort()).toEqual(["am-1", "am-2", "side-1"])

    service.registerVisible("sidebar", [])
    await Bun.sleep(175)
    expect([...calls[2].visible].sort()).toEqual(["am-1"])
    expect([...calls[2].attached].sort()).toEqual(["am-1", "am-2"])
  })

  test("window focus gates viewer.active but not attachment", async () => {
    const window = vscode.window as unknown as {
      state: { focused: boolean }
      onDidChangeWindowState: (listener: (ws: { focused: boolean }) => void) => { dispose(): void }
    }
    const original = window.onDidChangeWindowState
    let listener: ((ws: { focused: boolean }) => void) | undefined
    window.onDidChangeWindowState = (cb) => {
      listener = cb
      return { dispose: () => {} }
    }

    try {
      const service = new KiloConnectionService({} as any)
      const calls: Array<{ viewer: { id: string; active: boolean }; attached: string[]; visible: string[] }> = []
      ;(service as any).client = {
        session: {
          viewed: async (input: (typeof calls)[number]) => {
            calls.push(input)
          },
        },
      }

      service.registerVisible("sidebar", ["ses-1"])
      service.registerAttached("sidebar", ["ses-1", "ses-2"])
      await Bun.sleep(175)
      expect(calls).toHaveLength(1)
      expect(calls[0].viewer.active).toBe(true)

      listener!({ focused: false })
      await Bun.sleep(175)
      expect(calls).toHaveLength(2)
      expect(calls[1].viewer.active).toBe(false)
      expect([...calls[1].visible].sort()).toEqual(["ses-1"])
      expect([...calls[1].attached].sort()).toEqual(["ses-1", "ses-2"])
    } finally {
      window.onDidChangeWindowState = original
    }
  })

  test("sends snapshots while remote control is disabled", async () => {
    const service = new KiloConnectionService({} as any)
    const calls: Array<{ viewer: { id: string; active: boolean }; attached: string[]; visible: string[] }> = []
    ;(service as any).client = {
      session: {
        viewed: async (input: (typeof calls)[number]) => {
          calls.push(input)
        },
      },
    }
    service.setRemoteService({
      getState: () => ({ enabled: false, connected: false }),
      onChange: () => () => {},
    } as any)

    service.registerVisible("sidebar", ["ses-1"])
    service.registerAttached("agent-manager", ["ses-2"])
    await Bun.sleep(175)

    expect(calls).toHaveLength(1)
    expect([...calls[0].visible].sort()).toEqual(["ses-1"])
    expect([...calls[0].attached].sort()).toEqual(["ses-1", "ses-2"])
  })
})

describe("KiloConnectionService drainPendingPrompts", () => {
  test("ignores stale NotFoundError replies while draining permissions", async () => {
    const service = new KiloConnectionService({} as any)
    const client = {
      project: {
        list: async () => ({ data: [] }),
      },
      permission: {
        list: async () => ({ data: [{ id: "per_test" }] }),
        reply: async () => ({ error: { name: "NotFoundError", data: { message: "missing" } } }),
      },
      question: {
        list: async () => ({ data: [] }),
      },
      suggestion: {
        list: async () => ({ data: [] }),
      },
      network: {
        list: async () => ({ data: [] }),
      },
    }

    ;(service as any).client = client
    ;(service as any).directoryProviders.add(() => ["/tmp/workspace"])

    await expect(service.drainPendingPrompts()).resolves.toBeUndefined()
  })

  test("drains four directories concurrently and suggestions once", async () => {
    const service = new KiloConnectionService({} as any)
    const dirs = ["/tmp/a", "/tmp/b", "/tmp/c", "/tmp/d", "/tmp/e"]
    const gates = new Map(dirs.map((dir) => [dir, Promise.withResolvers<void>()]))
    const fifth = Promise.withResolvers<void>()
    const calls: string[] = []
    let cleared = 0
    const client = {
      permission: {
        list: async ({ directory }: { directory: string }) => {
          calls.push(`permission:${directory}`)
          if (directory === dirs[4]) fifth.resolve()
          await gates.get(directory)!.promise
          return { data: [] }
        },
      },
      question: {
        list: async ({ directory }: { directory: string }) => {
          calls.push(`question:${directory}`)
          return { data: [] }
        },
      },
      suggestion: {
        list: async ({ directory }: { directory: string }) => {
          calls.push(`suggestion:${directory}`)
          return { data: [] }
        },
      },
      network: {
        list: async ({ directory }: { directory: string }) => {
          calls.push(`network:${directory}`)
          return { data: [] }
        },
      },
    }

    ;(service as any).client = client
    ;(service as any).directoryProviders.add(() => dirs)
    service.onClearPendingPrompts(() => cleared++)

    const pending = service.drainPendingPrompts()
    expect(calls).toEqual(dirs.slice(0, 4).map((dir) => `permission:${dir}`))

    gates.get(dirs[0])!.resolve()
    await fifth.promise
    expect(calls.filter((call) => call.startsWith("permission:"))).toEqual(dirs.map((dir) => `permission:${dir}`))

    for (const gate of gates.values()) gate.resolve()
    await pending

    expect(calls.filter((call) => call.startsWith("suggestion:"))).toEqual([`suggestion:${dirs[0]}`])
    const suggestion = calls.findIndex((call) => call.startsWith("suggestion:"))
    expect(calls.filter((call) => call.startsWith("question:")).every((call) => calls.indexOf(call) < suggestion)).toBe(
      true,
    )
    expect(calls.filter((call) => call.startsWith("network:")).every((call) => calls.indexOf(call) > suggestion)).toBe(
      true,
    )
    expect(cleared).toBe(1)
  })

  test("waits for active drains and skips queued directories after a failure", async () => {
    const service = new KiloConnectionService({} as any)
    const dirs = ["/tmp/a", "/tmp/b", "/tmp/c", "/tmp/d", "/tmp/e"]
    const release = Promise.withResolvers<void>()
    const calls: string[] = []
    let cleared = 0
    const client = {
      permission: {
        list: async ({ directory }: { directory: string }) => {
          calls.push(directory)
          if (directory === dirs[0]) await release.promise
          if (directory === dirs[1]) return { error: "failed" }
          return { data: [] }
        },
      },
      question: { list: async () => ({ data: [] }) },
      suggestion: { list: async () => ({ data: [] }) },
      network: { list: async () => ({ data: [] }) },
    }

    ;(service as any).client = client
    ;(service as any).directoryProviders.add(() => dirs)
    service.onClearPendingPrompts(() => cleared++)

    const pending = service.drainPendingPrompts()
    expect(calls).toEqual(dirs.slice(0, 4))
    expect(
      await Promise.race([
        pending.then(
          () => "settled",
          () => "settled",
        ),
        Promise.resolve("pending"),
      ]),
    ).toBe("pending")
    expect(calls).not.toContain(dirs[4])

    release.resolve()
    await expect(pending).rejects.toThrow(`Failed to list permissions for ${dirs[1]}`)
    expect(calls).not.toContain(dirs[4])
    expect(cleared).toBe(0)
  })
})
