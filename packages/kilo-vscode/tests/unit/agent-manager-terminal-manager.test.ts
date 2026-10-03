import { describe, expect, it } from "bun:test"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { TerminalManager } from "../../src/agent-manager/terminal-manager"

const params = { terminalId: "terminal-1", worktreeId: null, cwd: "/workspace", title: "Terminal 1" }

// The SDK boundary models resource allocation, including failed removals. All
// lifecycle decisions and bookkeeping run through the actual manager.
function fixture(
  hooks: {
    create?: (count: number) => Promise<{ error?: Error } | void>
    update?: () => Promise<{ error?: Error } | void>
    remove?: (id: string) => Promise<{ error?: unknown } | void>
  } = {},
) {
  const live = new Set<string>()
  const removed: string[] = []
  const logs: unknown[][] = []
  let count = 0
  const client = {
    pty: {
      create: async ({ title }: { title: string }) => {
        const id = `pty-${++count}`
        const result = await hooks.create?.(count)
        if (result?.error) return result
        live.add(id)
        return { data: { id, title } }
      },
      update: async () => (await hooks.update?.()) ?? { data: true },
      remove: async ({ ptyID }: { ptyID: string }) => {
        removed.push(ptyID)
        const result = await hooks.remove?.(ptyID)
        if (result?.error) return result
        if (!live.has(ptyID)) return { error: { _tag: "PtyNotFoundError", ptyID, message: "Already removed" } }
        live.delete(ptyID)
        return { data: true }
      },
    },
  } as unknown as KiloClient
  const manager = new TerminalManager({
    getClient: () => client,
    buildWsUrl: (id) => `ws://fixture/${id}`,
    log: (...args) => logs.push(args),
  })
  return { manager, live, removed, logs, count: () => count }
}

describe("Agent Manager terminal replacement ownership", () => {
  for (const action of ["close", "dispose"] as const) {
    for (const stage of ["create", "resize"] as const) {
      it(`reaps a replacement when ${action} starts during ${stage}`, async () => {
        const ready = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()
        const pause = async () => {
          ready.resolve()
          await release.promise
        }
        const test = fixture({
          create:
            stage === "create"
              ? async (count) => {
                  if (count === 2) await pause()
                }
              : undefined,
          update: stage === "resize" ? pause : undefined,
        })
        await test.manager.create(params)
        const restarting = test.manager.restart(params.terminalId, 80, 24)
        await ready.promise
        const closing = action === "close" ? test.manager.close(params.terminalId) : test.manager.dispose()
        // Closing intent must prevent another restart even while removal waits.
        const ignored = test.manager.restart(params.terminalId)
        // A hung create/resize must not keep the panel's teardown waiting.
        await closing
        release.resolve()
        expect(await ignored).toBeUndefined()
        expect(await restarting).toBeUndefined()
        await closing
        expect([...test.live]).toEqual([])
        expect(test.manager.titles(null)).toEqual([])
        expect(test.count()).toBe(2)
        await test.manager.dispose()
        expect([...test.live]).toEqual([])
      })
    }

    it(`does not replace the entry while ${action}'s removal is pending`, async () => {
      const creating = Promise.withResolvers<void>()
      const created = Promise.withResolvers<void>()
      const removing = Promise.withResolvers<void>()
      const removed = Promise.withResolvers<void>()
      const test = fixture({
        create: async (count) => {
          if (count !== 2) return
          creating.resolve()
          await created.promise
        },
        remove: async (id) => {
          if (id !== "pty-1") return
          removing.resolve()
          await removed.promise
        },
      })
      await test.manager.create(params)
      const restarting = test.manager.restart(params.terminalId)
      await creating.promise
      const closing = action === "close" ? test.manager.close(params.terminalId) : test.manager.dispose()
      created.resolve()
      await removing.promise
      removed.resolve()
      expect(await restarting).toBeUndefined()
      await closing
      expect([...test.live]).toEqual([])
      expect(test.manager.titles(null)).toEqual([])
    })

    it(`keeps failed replacement cleanup retryable after ${action}`, async () => {
      const ready = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      let offline = true
      const test = fixture({
        create: async (count) => {
          if (count !== 2) return
          ready.resolve()
          await release.promise
        },
        remove: async (id) => (id === "pty-2" && offline ? { error: new Error("offline") } : undefined),
      })
      await test.manager.create(params)
      const restarting = test.manager.restart(params.terminalId)
      await ready.promise
      const closing = action === "close" ? test.manager.close(params.terminalId) : test.manager.dispose()
      if (action === "close") expect(await closing).toBe(true)
      else await closing
      release.resolve()
      expect(await restarting).toBeUndefined()
      expect([...test.live]).toEqual(["pty-2"])
      expect(test.manager.titles(null)).toEqual([])
      expect(await test.manager.close(params.terminalId)).toBe(false)
      offline = false
      await test.manager.dispose()
      expect([...test.live]).toEqual([])
      expect(test.manager.titles(null)).toEqual([])
    })

    it(`completes ${action} when the pending replacement creation rejects`, async () => {
      const ready = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const test = fixture({
        create: async (count) => {
          if (count !== 2) return
          ready.resolve()
          await release.promise
          throw new Error("create failed")
        },
      })
      await test.manager.create(params)
      const restarting = test.manager.restart(params.terminalId)
      const rejected = restarting.catch((err: unknown) => err)
      await ready.promise
      const closing = action === "close" ? test.manager.close(params.terminalId) : test.manager.dispose()
      await closing
      release.resolve()
      expect(await rejected).toEqual(new Error("create failed"))
      expect([...test.live]).toEqual([])
      expect(test.manager.titles(null)).toEqual([])
    })
  }

  for (const stage of ["create", "resize"] as const) {
    for (const mode of ["throw", "error"] as const) {
      it(`preserves the original after ${stage} ${mode} and cleans up before retry`, async () => {
        let failing = true
        const fail = async () => {
          if (!failing) return
          if (mode === "throw") throw new Error("setup failed")
          return { error: new Error("setup failed") }
        }
        const test = fixture({
          create: stage === "create" ? async (count) => (count > 1 ? fail() : undefined) : undefined,
          update: stage === "resize" ? fail : undefined,
        })
        await test.manager.create(params)
        await expect(test.manager.restart(params.terminalId, 80, 24)).rejects.toThrow("setup failed")
        expect([...test.live]).toEqual(["pty-1"])
        expect(test.manager.titles(null)).toEqual([params.title])
        failing = false
        expect(await test.manager.restart(params.terminalId, 80, 24)).toBe("ws://fixture/pty-3")
        expect([...test.live]).toEqual(["pty-3"])
        expect(await test.manager.close(params.terminalId)).toBe(true)
        expect([...test.live]).toEqual([])
      })
    }
  }

  it("retains a replacement whose cleanup throws after setup fails", async () => {
    let offline = true
    const test = fixture({
      update: async () => {
        throw new Error("resize failed")
      },
      remove: async (id) => {
        if (id === "pty-2" && offline) throw new Error("offline")
      },
    })
    await test.manager.create(params)
    await expect(test.manager.restart(params.terminalId, 80, 24)).rejects.toThrow("resize failed")
    expect([...test.live]).toEqual(["pty-1", "pty-2"])
    expect(await test.manager.close(params.terminalId)).toBe(false)
    expect([...test.live]).toEqual(["pty-2"])
    offline = false
    expect(await test.manager.close(params.terminalId)).toBe(true)
    expect([...test.live]).toEqual([])
  })

  it("retains an old PTY when removal returns an SDK error after restart", async () => {
    let offline = true
    const test = fixture({
      remove: async (id) => (id === "pty-1" && offline ? { error: new Error("offline") } : undefined),
    })
    await test.manager.create(params)
    expect(await test.manager.restart(params.terminalId)).toBe("ws://fixture/pty-2")
    expect([...test.live]).toEqual(["pty-1", "pty-2"])
    expect(test.logs.flat().join(" ")).toContain("offline")
    offline = false
    expect(await test.manager.close(params.terminalId)).toBe(true)
    expect([...test.live]).toEqual([])
  })

  it("deduplicates concurrent restarts and allows subsequent restarts", async () => {
    const ready = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const test = fixture({
      create: async (count) => {
        if (count !== 2) return
        ready.resolve()
        await release.promise
      },
    })
    await test.manager.create(params)
    const first = test.manager.restart(params.terminalId, 80, 24)
    await ready.promise
    const second = test.manager.restart(params.terminalId, 80, 24)
    release.resolve()
    expect(await Promise.all([first, second])).toEqual(["ws://fixture/pty-2", "ws://fixture/pty-2"])
    expect(test.count()).toBe(2)
    expect([...test.live]).toEqual(["pty-2"])
    expect(await test.manager.restart(params.terminalId)).toBe("ws://fixture/pty-3")
    expect(await test.manager.close(params.terminalId)).toBe(true)
    expect(test.removed).toEqual(["pty-1", "pty-2", "pty-3"])
    expect([...test.live]).toEqual([])
  })

  it("allows a restart after a failed close", async () => {
    let offline = true
    const test = fixture({ remove: async () => (offline ? { error: new Error("offline") } : undefined) })
    await test.manager.create(params)
    expect(await test.manager.close(params.terminalId)).toBe(false)
    offline = false
    expect(await test.manager.restart(params.terminalId)).toBe("ws://fixture/pty-2")
    await test.manager.dispose()
    expect([...test.live]).toEqual([])
  })

  it("closes a committed replacement while old PTY removal is still pending", async () => {
    const ready = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const test = fixture({
      remove: async (id) => {
        if (id !== "pty-1") return
        ready.resolve()
        await release.promise
      },
    })
    await test.manager.create(params)
    const restarting = test.manager.restart(params.terminalId)
    await ready.promise
    const closing = test.manager.close(params.terminalId)
    const disposing = test.manager.dispose()
    expect(await test.manager.restart(params.terminalId)).toBeUndefined()
    release.resolve()
    expect(await restarting).toBeUndefined()
    expect(await closing).toBe(true)
    await disposing
    expect(test.removed.filter((id) => id === "pty-2")).toHaveLength(1)
    expect([...test.live]).toEqual([])
  })

  it("isolates a new entry reusing a closing terminal's ID from its pending restart", async () => {
    const ready = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const test = fixture({
      create: async (count) => {
        if (count !== 2) return
        ready.resolve()
        await release.promise
      },
    })
    await test.manager.create(params)
    const restarting = test.manager.restart(params.terminalId)
    await ready.promise
    const closing = test.manager.close(params.terminalId)
    await test.manager.create(params)
    expect(await test.manager.restart(params.terminalId)).toBe("ws://fixture/pty-4")
    release.resolve()
    expect(await restarting).toBeUndefined()
    expect(await closing).toBe(true)
    expect([...test.live]).toEqual(["pty-4"])
    expect(test.manager.titles(null)).toEqual([params.title])
    await test.manager.dispose()
    expect([...test.live]).toEqual([])
  })

  it("does not return a removed replacement after close partially fails during restart cleanup", async () => {
    const ready = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let calls = 0
    let offline = true
    const test = fixture({
      remove: async (id) => {
        if (id !== "pty-1" || !offline) return
        if (++calls === 1) {
          ready.resolve()
          await release.promise
        }
        return { error: new Error("offline") }
      },
    })
    await test.manager.create(params)
    const restarting = test.manager.restart(params.terminalId)
    await ready.promise
    expect(await test.manager.close(params.terminalId)).toBe(false)
    expect([...test.live]).toEqual(["pty-1"])
    release.resolve()
    expect(await restarting).toBeUndefined()
    offline = false
    expect(await test.manager.close(params.terminalId)).toBe(true)
    expect([...test.live]).toEqual([])
  })

  it("accepts a matching not-found response when retrying a lost removal response", async () => {
    let failing = true
    const test = fixture({
      remove: async (id) => {
        if (id !== "pty-1" || !failing) return
        failing = false
        test.live.delete(id)
        throw new Error("response lost")
      },
    })
    await test.manager.create(params)
    expect(await test.manager.restart(params.terminalId)).toBe("ws://fixture/pty-2")
    expect(await test.manager.close(params.terminalId)).toBe(true)
    expect(test.manager.titles(null)).toEqual([])
    expect([...test.live]).toEqual([])
  })

  it("retires an empty entry when restart cleanup succeeds after a partial close failure", async () => {
    const ready = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let calls = 0
    const test = fixture({
      remove: async (id) => {
        if (id !== "pty-1") return
        if (++calls > 1) return { error: new Error("transient failure") }
        ready.resolve()
        await release.promise
      },
    })
    await test.manager.create(params)
    const restarting = test.manager.restart(params.terminalId)
    await ready.promise
    expect(await test.manager.close(params.terminalId)).toBe(false)
    release.resolve()
    expect(await restarting).toBeUndefined()
    expect([...test.live]).toEqual([])
    expect(test.manager.titles(null)).toEqual([])
    expect(await test.manager.close(params.terminalId)).toBe(true)
    expect(test.manager.titles(null)).toEqual([])
  })

  for (const failure of [
    {
      title: "not-found for another PTY",
      error: { _tag: "PtyNotFoundError", ptyID: "different", message: "Not this PTY" },
    },
    { title: "bad request", error: { name: "BadRequest", data: { message: "Invalid request" } } },
    { title: "untyped 404", error: { status: 404, message: "Not found" } },
  ]) {
    it(`keeps ${failure.title} retryable`, async () => {
      let failing = true
      const test = fixture({ remove: async () => (failing ? { error: failure.error } : undefined) })
      await test.manager.create(params)
      expect(await test.manager.close(params.terminalId)).toBe(false)
      expect([...test.live]).toEqual(["pty-1"])
      failing = false
      expect(await test.manager.close(params.terminalId)).toBe(true)
      expect([...test.live]).toEqual([])
    })
  }
})
