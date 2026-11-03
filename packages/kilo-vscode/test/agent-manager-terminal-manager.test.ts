import { describe, expect, it } from "bun:test"
import type { AgentManagerConnection } from "../src/agent-manager/connection"
import type { OpenCodeClient } from "@opencode/client"
import { ptySocketUrl, TerminalManager } from "../src/agent-manager/terminal-manager"

const params = { terminalId: "terminal-1", worktreeId: null, cwd: "/workspace", title: "Terminal 1" }

const missing = (ptyID: string) => Object.assign(new Error("Already removed"), { _tag: "PtyNotFoundError", ptyID })

// The client boundary models resource allocation, including failed removals.
// All lifecycle decisions and bookkeeping run through the actual manager.
function fixture(
  hooks: {
    create?: (count: number) => Promise<void>
    update?: () => Promise<void>
    remove?: (id: string) => Promise<void>
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
        await hooks.create?.(count)
        live.add(id)
        return { location: { directory: "/workspace" }, data: { id, title } }
      },
      update: async () => {
        await hooks.update?.()
        return { location: { directory: "/workspace" }, data: {} }
      },
      remove: async ({ ptyID }: { ptyID: string }) => {
        removed.push(ptyID)
        await hooks.remove?.(ptyID)
        if (!live.has(ptyID)) throw missing(ptyID)
        live.delete(ptyID)
      },
      connect: {
        token: async ({ ptyID }: { ptyID: string }) => ({
          data: { ticket: `ticket-${ptyID}`, expires_in: 30 },
        }),
      },
    },
  }
  const connection = {
    client: async () => client as unknown as OpenCodeClient,
    current: () => client as unknown as OpenCodeClient,
    state: () => "connected",
    onState: () => () => undefined,
    onEvent: () => () => undefined,
    server: () => ({ url: "http://127.0.0.1:4096", authorization: "Basic test" }),
    view: () => undefined,
  } as unknown as AgentManagerConnection
  const manager = new TerminalManager({
    connection,
    log: (...args) => logs.push(args),
  })
  return { manager, live, removed, logs, count: () => count, connection }
}

describe("Agent Manager terminal replacement ownership", () => {
  it("closes detached ownership only in the requested directory when a terminal ID is reused", async () => {
    const ready = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let offline = true
    const test = fixture({
      create: async (count) => {
        if (count !== 2) return
        ready.resolve()
        await release.promise
      },
      remove: async (id) => {
        if (id === "pty-2" && offline) throw new Error("offline")
      },
    })
    await test.manager.create(params)
    const restarting = test.manager.restart(params.terminalId)
    await ready.promise
    expect(await test.manager.close(params.terminalId)).toBe(true)
    release.resolve()
    expect(await restarting).toBeUndefined()
    await test.manager.create({ ...params, cwd: "/other" })
    await expect(test.manager.closeDirectory(params.cwd)).rejects.toThrow("Failed to close terminals")
    expect([...test.live]).toEqual(["pty-2", "pty-3"])
    offline = false
    await test.manager.closeDirectory(params.cwd)
    expect([...test.live]).toEqual(["pty-3"])
    expect(test.manager.titles(null)).toEqual([params.title])
    await test.manager.closeDirectory("/other")
    expect([...test.live]).toEqual([])
    expect(test.manager.hasPendingCleanup()).toBe(false)
  })

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
        remove: async (id) => {
          if (id === "pty-2" && offline) throw new Error("offline")
        },
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
    it(`preserves the original after ${stage} failure and cleans up before retry`, async () => {
      let failing = true
      const fail = async () => {
        if (!failing) return
        throw new Error("setup failed")
      }
      const test = fixture({
        create:
          stage === "create"
            ? async (count) => {
                if (count > 1) await fail()
              }
            : undefined,
        update: stage === "resize" ? fail : undefined,
      })
      await test.manager.create(params)
      await expect(test.manager.restart(params.terminalId, 80, 24)).rejects.toThrow("setup failed")
      expect([...test.live]).toEqual(["pty-1"])
      expect(test.manager.titles(null)).toEqual([params.title])
      failing = false
      expect(await test.manager.restart(params.terminalId, 80, 24)).toBe(true)
      expect([...test.live]).toEqual(["pty-3"])
      expect(await test.manager.close(params.terminalId)).toBe(true)
      expect([...test.live]).toEqual([])
    })
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

  it("retains an old PTY when removal fails after restart", async () => {
    let offline = true
    const test = fixture({
      remove: async (id) => {
        if (id === "pty-1" && offline) throw new Error("offline")
      },
    })
    await test.manager.create(params)
    expect(await test.manager.restart(params.terminalId)).toBe(true)
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
    expect(await Promise.all([first, second])).toEqual([true, true])
    expect(test.count()).toBe(2)
    expect([...test.live]).toEqual(["pty-2"])
    expect(await test.manager.restart(params.terminalId)).toBe(true)
    expect(await test.manager.close(params.terminalId)).toBe(true)
    expect(test.removed).toEqual(["pty-1", "pty-2", "pty-3"])
    expect([...test.live]).toEqual([])
  })

  it("allows a restart after a failed close", async () => {
    let offline = true
    const test = fixture({
      remove: async () => {
        if (offline) throw new Error("offline")
      },
    })
    await test.manager.create(params)
    expect(await test.manager.close(params.terminalId)).toBe(false)
    offline = false
    expect(await test.manager.restart(params.terminalId)).toBe(true)
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
    expect(await test.manager.restart(params.terminalId)).toBe(true)
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
        throw new Error("offline")
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
    expect(await test.manager.restart(params.terminalId)).toBe(true)
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
        if (++calls > 1) throw new Error("transient failure")
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
    { title: "not-found for another PTY", error: () => missing("different") },
    { title: "bad request", error: () => Object.assign(new Error("Invalid request"), { name: "BadRequest" }) },
  ]) {
    it(`keeps ${failure.title} retryable`, async () => {
      let failing = true
      const test = fixture({
        remove: async () => {
          if (failing) throw failure.error()
        },
      })
      await test.manager.create(params)
      expect(await test.manager.close(params.terminalId)).toBe(false)
      expect([...test.live]).toEqual(["pty-1"])
      failing = false
      expect(await test.manager.close(params.terminalId)).toBe(true)
      expect([...test.live]).toEqual([])
    })
  }

  it("resolves the server PTY for the host socket relay", async () => {
    const test = fixture()
    const created = await test.manager.create(params)
    expect(created).toEqual({ terminalId: params.terminalId, worktreeId: null, title: params.title })
    expect(test.manager.ptyFor(params.terminalId)).toEqual({ ptyID: "pty-1", directory: "/workspace" })
    expect(test.manager.ptyFor("missing")).toBeUndefined()
    await test.manager.dispose()
    expect(test.manager.ptyFor(params.terminalId)).toBeUndefined()
  })

  it("binds the socket URL to the directory of its ticket", async () => {
    const url = new URL(
      await ptySocketUrl(
        {
          client: async () =>
            ({
              pty: { connect: { token: async () => ({ data: { ticket: "t", expires_in: 30 } }) } },
            }) as unknown as OpenCodeClient,
          server: () => ({ url: "http://127.0.0.1:4096" }),
        } as unknown as AgentManagerConnection,
        "/repo/.kilo/worktrees/a b",
        "pty-1",
      ),
    )
    expect(url.origin + url.pathname).toBe("ws://127.0.0.1:4096/api/pty/pty-1/connect")
    expect(url.searchParams.get("location[directory]")).toBe("/repo/.kilo/worktrees/a b")
    expect(url.searchParams.get("ticket")).toBe("t")
    expect(url.searchParams.get("cursor")).toBe("0")
  })

  it("refuses a ticket URL without a running server", async () => {
    await expect(
      ptySocketUrl(
        {
          client: async () =>
            ({
              pty: { connect: { token: async () => ({ data: { ticket: "t", expires_in: 30 } }) } },
            }) as unknown as OpenCodeClient,
          server: () => undefined,
        } as unknown as AgentManagerConnection,
        "/workspace",
        "pty-1",
      ),
    ).rejects.toThrow("Not connected to CLI backend")
  })
})