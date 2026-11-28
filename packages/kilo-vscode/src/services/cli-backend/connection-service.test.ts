import { describe, expect, mock, test } from "bun:test"
import * as vscode from "vscode"
import { KiloConnectionService } from "./connection-service"
import type { SSEPayload } from "./sdk-sse-adapter"

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

describe("KiloConnectionService visible sessions", () => {
  test("reports a session as visible while any surface displays it", () => {
    const service = new KiloConnectionService({} as any)

    expect(service.isVisible("ses-1")).toBe(false)

    service.registerVisible("sidebar", ["ses-1"])
    service.registerVisible("agent-manager", ["ses-2"])
    expect(service.isVisible("ses-1")).toBe(true)
    expect(service.isVisible("ses-2")).toBe(true)
    expect(service.isVisible("ses-3")).toBe(false)

    // A hidden panel registers an empty set, which is what makes this usable as
    // the notification suppression check.
    service.registerVisible("sidebar", [])
    expect(service.isVisible("ses-1")).toBe(false)
    expect(service.isVisible("ses-2")).toBe(true)

    service.unregisterVisible("agent-manager")
    expect(service.isVisible("ses-2")).toBe(false)
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

describe("KiloConnectionService explicit aborts", () => {
  const close = {
    id: "event-close",
    type: "session.turn.close",
    properties: { sessionID: "session", reason: "interrupted" },
  } as SSEPayload

  function setup() {
    const service = new KiloConnectionService({} as any)
    const raw: SSEPayload[] = []
    const first: SSEPayload[] = []
    const second: SSEPayload[] = []
    service.onEvent((event) => raw.push(event))
    service.onEventFiltered(
      () => true,
      (event) => first.push(event),
    )
    service.onEventFiltered(
      () => true,
      (event) => second.push(event),
    )
    return { service, raw, first, second }
  }

  test("suppresses a successful explicit abort for filtered subscribers", async () => {
    const state = setup()

    await state.service.runExplicitAbort("session", "/repo", async () => {
      ;(state.service as any).broadcast(close, "/repo")
    })

    expect(state.first).toEqual([])
    expect(state.second).toEqual([])
    expect(state.raw).toEqual([close])
  })

  test("replays a failed explicit abort for filtered subscribers", async () => {
    const state = setup()

    await expect(
      state.service.runExplicitAbort("session", "/repo", async () => {
        ;(state.service as any).broadcast(close, "/repo")
        throw new Error("abort failed")
      }),
    ).rejects.toThrow("abort failed")

    expect(state.first).toEqual([close])
    expect(state.second).toEqual([close])
    expect(state.raw).toEqual([close])
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

describe("KiloConnectionService server exit handling", () => {
  test("reports signal name when process is killed by signal", () => {
    const service = new KiloConnectionService({} as any)
    let stateErr: Error | undefined
    service.onStateChange((state, err) => {
      if (state === "error") stateErr = err
    })
    ;(service as any).handleServerExit(null, "SIGSEGV")
    expect(stateErr?.message).toBe("CLI background process exited with signal SIGSEGV. Retry to reconnect.")
  })

  test("reports exit code when process exits normally with code", () => {
    const service = new KiloConnectionService({} as any)
    let stateErr: Error | undefined
    service.onStateChange((state, err) => {
      if (state === "error") stateErr = err
    })
    ;(service as any).handleServerExit(1, null)
    expect(stateErr?.message).toBe("CLI background process exited with code 1. Retry to reconnect.")
  })
})

describe("KiloConnectionService health poll watchdog", () => {
  function makeService(connectResult: () => Promise<void> = async () => {}) {
    const service = new KiloConnectionService({} as any)
    const restart = mock(async () => ({ port: 9999, password: "p", process: {} }))
    ;(service as any).serverManager.restart = restart
    // Keep recovery away from the real SSE/SDK connect path; tests assert the restart decision itself.
    const connect = mock(connectResult)
    ;(service as any).connect = connect
    return { service, restart, connect }
  }

  function stubFetch(handler: (url: string) => Response) {
    const fetchMock = mock((input: RequestInfo | URL) =>
      Promise.resolve(handler(typeof input === "string" ? input : input.toString())),
    )
    const original = globalThis.fetch
    globalThis.fetch = fetchMock as typeof fetch
    return {
      fetchMock,
      restore: () => {
        globalThis.fetch = original
      },
    }
  }

  const failingShallow = () => new Response(null, { status: 500 })
  const healthy = (url: string) =>
    new Response(JSON.stringify({ healthy: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  const routeByProbe = (url: string) =>
    url.includes("/global/health/deep") ? new Response(null, { status: 503 }) : healthy(url)

  test("keeps counting shallow failures across SSE error states and restarts on the third", async () => {
    const { service, restart } = makeService()
    const http = stubFetch(failingShallow)
    try {
      const generation = (service as any).healthGeneration
      let schedules = 0
      const scheduleNext = () => {
        schedules++
      }
      for (let round = 1; round <= 3; round++) {
        await (service as any).runHealthPoll(generation, "http://x", "pw", scheduleNext)
        // The SSE adapter surfaces reconnect failures as an error state; the watchdog must not stop.
        ;(service as any).setState("error", new Error("sse reconnect failed"))
      }
      expect(restart).toHaveBeenCalledTimes(1)
      // Rounds 1 and 2 reschedule; round 3 enters recovery which bumps the generation, so it must not.
      expect(schedules).toBe(2)
      expect(http.fetchMock).toHaveBeenCalledTimes(3)
    } finally {
      http.restore()
    }
  })

  test("a stale generation never reschedules after the poll is stopped", async () => {
    const { service, restart } = makeService()
    const http = stubFetch(failingShallow)
    try {
      const staleGeneration = (service as any).healthGeneration
      ;(service as any).stopHealthPoll()
      let schedules = 0
      await (service as any).runHealthPoll(staleGeneration, "http://x", "pw", () => schedules++)
      expect(schedules).toBe(0)
      expect(restart).not.toHaveBeenCalled()
      expect(http.fetchMock).not.toHaveBeenCalled()
    } finally {
      http.restore()
    }
  })

  test("a disposed service does not run or reschedule poll rounds", async () => {
    const { service, restart } = makeService()
    const http = stubFetch(failingShallow)
    try {
      const generation = (service as any).healthGeneration
      service.dispose()
      let schedules = 0
      await (service as any).runHealthPoll(generation, "http://x", "pw", () => schedules++)
      expect(schedules).toBe(0)
      expect(restart).not.toHaveBeenCalled()
    } finally {
      http.restore()
    }
  })

  test("two consecutive deep failures trigger exactly one restart while shallow stays healthy", async () => {
    const { service, restart } = makeService()
    const http = stubFetch(routeByProbe)
    try {
      const generation = (service as any).healthGeneration
      let schedules = 0
      const scheduleNext = () => {
        schedules++
      }
      await (service as any).runHealthPoll(generation, "http://x", "pw", scheduleNext)
      expect(restart).not.toHaveBeenCalled()
      expect(schedules).toBe(1)
      await (service as any).runHealthPoll(generation, "http://x", "pw", scheduleNext)
      expect(restart).toHaveBeenCalledTimes(1)
      // Recovery invalidated the generation, so the second round must not leave a live schedule.
      expect(schedules).toBe(1)
    } finally {
      http.restore()
    }
  })

  test("healthy rounds clear the failure streaks and never restart", async () => {
    const { service, restart } = makeService()
    const http = stubFetch(healthy)
    try {
      const generation = (service as any).healthGeneration
      let schedules = 0
      for (let round = 0; round < 4; round++) {
        await (service as any).runHealthPoll(generation, "http://x", "pw", () => schedules++)
      }
      expect(restart).not.toHaveBeenCalled()
      expect(schedules).toBe(4)
      expect((service as any).shallowFailures).toBe(0)
      expect((service as any).deepHealthFailures).toBe(0)
    } finally {
      http.restore()
    }
  })

  test("one successful deep probe resets the deep failure streak", async () => {
    const { service, restart } = makeService()
    let deepFail = true
    const http = stubFetch((url) => {
      if (!url.includes("/global/health/deep")) return healthy(url)
      if (deepFail) return new Response(null, { status: 503 })
      return healthy(url)
    })
    try {
      const generation = (service as any).healthGeneration
      const noopSchedule = () => {}
      await (service as any).runHealthPoll(generation, "http://x", "pw", noopSchedule) // deep count 1
      expect((service as any).deepHealthFailures).toBe(1)
      deepFail = false
      await (service as any).runHealthPoll(generation, "http://x", "pw", noopSchedule) // reset
      expect((service as any).deepHealthFailures).toBe(0)
      deepFail = true
      await (service as any).runHealthPoll(generation, "http://x", "pw", noopSchedule) // count 1 again
      expect(restart).not.toHaveBeenCalled()
      expect((service as any).deepHealthFailures).toBe(1)
    } finally {
      http.restore()
    }
  })

  test("failed recovery surfaces an error state and leaves no pending poll timer", async () => {
    const { service } = makeService(() => Promise.reject(new Error("restart connect failed")))
    const http = stubFetch(failingShallow)
    try {
      let stateErr: Error | undefined
      service.onStateChange((state, err) => {
        if (state === "error") stateErr = err
      })
      const generation = (service as any).healthGeneration
      for (let round = 0; round < 3; round++) {
        await (service as any).runHealthPoll(generation, "http://x", "pw", () => {})
      }
      expect(stateErr?.message).toBe("restart connect failed")
      expect((service as any).healthPollTimer).toBeNull()
    } finally {
      http.restore()
    }
  })
})
