import { describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { KiloClient, SessionStatus } from "@kilocode/sdk/v2/client"
import type { ConnectionState } from "../../src/services/cli-backend/connection-service"
import type { SSEPayload } from "../../src/services/cli-backend/sdk-sse-adapter"
import { CaffeinationService, type CaffeinationDriver } from "../../src/services/caffeination"
import { confirmCaffeination } from "../../src/services/caffeination/confirm"

const root = "/workspace"
const tree = "/workspace/worktree"

type Status = { type: SessionStatus["type"]; working?: boolean }
type Snapshot = Record<string, Status>

type Reply<T> = { data?: T; error?: unknown }

class Driver implements CaffeinationDriver {
  constructor(
    public readonly available = true,
    public readonly reason?: string,
  ) {}

  starts = 0
  stops = 0
  held = false
  exit: ((error?: Error) => void) | undefined
  open = () => Promise.resolve()
  close = () => Promise.resolve()

  start(_pid: number, exit: (error?: Error) => void): Promise<void> {
    this.starts++
    this.held = true
    this.exit = exit
    return this.open()
  }

  async stop(): Promise<void> {
    this.stops++
    await this.close()
    this.held = false
    this.exit = undefined
  }

  die(error?: Error): void {
    this.held = false
    const exit = this.exit
    this.exit = undefined
    exit?.(error)
  }
}

class Connection {
  state: ConnectionState = "connected"
  dirs = [root]
  data: Record<string, Snapshot> = {}
  calls: string[] = []
  events = new Set<(event: SSEPayload, directory?: string) => void>()
  states = new Set<(state: ConnectionState) => void>()
  statuses: (dir: string) => Promise<Reply<Snapshot>> = async (dir) => ({ data: this.data[dir] ?? {} })

  onEvent(listener: (event: SSEPayload, directory?: string) => void) {
    this.events.add(listener)
    return () => this.events.delete(listener)
  }

  onStateChange(listener: (state: ConnectionState) => void) {
    this.states.add(listener)
    return () => this.states.delete(listener)
  }

  getConnectionState() {
    return this.state
  }

  getKnownDirectories() {
    return this.dirs
  }

  getClient() {
    return {
      session: {
        status: ({ directory }: { directory: string }) => {
          this.calls.push(directory)
          return this.statuses(directory)
        },
      },
    } as unknown as KiloClient
  }

  emit(event: SSEPayload, directory?: string) {
    for (const listener of this.events) listener(event, directory)
  }

  change(state: ConnectionState) {
    this.state = state
    for (const listener of this.states) listener(state)
  }
}

function snapshot(statuses: Record<string, SessionStatus["type"] | Status> = {}): Snapshot {
  return Object.fromEntries(
    Object.entries(statuses).map(([id, status]) => [id, typeof status === "string" ? { type: status } : status]),
  )
}

function status(
  sessionID: string,
  type: SessionStatus["type"],
  working?: boolean,
  event: "session.status" | "session.working" = "session.status",
): SSEPayload {
  return {
    id: crypto.randomUUID(),
    type: event,
    properties: { sessionID, status: { type, working } as SessionStatus },
  }
}

function setup(data: Record<string, Snapshot> = {}, driver = new Driver()) {
  const connection = new Connection()
  connection.data = data
  return { connection, driver, service: new CaffeinationService(connection, driver) }
}

async function aliases() {
  const dir = await mkdtemp(path.join(tmpdir(), "kilo-caffeination-alias-"))
  const real = path.join(dir, "real")
  const alias = path.join(dir, "alias")
  await mkdir(real)
  await symlink(real, alias, process.platform === "win32" ? "junction" : "dir")
  return { dir, real: await realpath(real), alias }
}

describe("CaffeinationService", () => {
  it("defaults off without power, network, or reconnect work", async () => {
    const test = setup({ [root]: snapshot({ one: "busy" }) })
    expect(test.service.getState()).toEqual({ enabled: false, active: false, available: true })
    test.connection.emit(status("one", "busy"), root)
    test.connection.change("connecting")
    test.connection.change("connected")
    await test.service.refresh()
    await Bun.sleep(0)
    expect(test.connection.calls).toEqual([])
    expect(test.driver.starts).toBe(0)
    await test.service.dispose()
    expect(test.driver.stops).toBe(0)
  })

  it("hydrates overlapping directories and releases only after the last running session", async () => {
    const test = setup({ [root]: snapshot({ one: "busy" }), [tree]: snapshot({ two: "retry" }) })
    test.connection.dirs.push(tree)
    await test.service.setEnabled(true)
    expect(test.driver.starts).toBe(1)
    expect(test.connection.calls).toEqual([root, tree])
    test.connection.emit(status("one", "idle"), root)
    await Bun.sleep(0)
    expect(test.driver.stops).toBe(0)
    test.connection.emit(status("two", "offline"), tree)
    await Bun.sleep(0)
    expect(test.driver.stops).toBe(1)
    expect(test.service.getState().active).toBe(false)
    await test.service.dispose()
  })

  it("applies activity-only events without changing runner status", async () => {
    const test = setup({ [root]: snapshot({ one: { type: "busy", working: true } }) })
    await test.service.setEnabled(true)
    test.connection.emit(status("one", "busy", false, "session.working"), root)
    await Bun.sleep(0)
    expect(test.driver.held).toBe(false)
    test.connection.emit(status("one", "idle", true, "session.working"), root)
    await Bun.sleep(0)
    expect(test.driver.held).toBe(true)
    test.connection.emit(status("one", "idle", false, "session.working"), root)
    await Bun.sleep(0)
    expect(test.driver.held).toBe(false)
    await test.service.dispose()
  })

  it("replays activity-only updates over a stale status snapshot", async () => {
    const test = setup()
    const gate = Promise.withResolvers<Reply<Snapshot>>()
    test.connection.statuses = () => gate.promise
    const enabled = test.service.setEnabled(true)
    test.connection.emit(status("one", "busy", false, "session.working"), root)
    gate.resolve({ data: snapshot({ one: { type: "busy", working: true } }) })
    await enabled
    expect(test.driver.starts).toBe(0)
    await test.service.dispose()
  })

  it("includes backend directories observed while disabled and newly observed live directories", async () => {
    const test = setup({ [tree]: snapshot({ one: "busy" }) })
    test.connection.emit(status("one", "busy"), tree)
    expect(test.connection.calls).toEqual([])
    await test.service.setEnabled(true)
    expect(test.driver.starts).toBe(1)
    test.connection.emit(status("one", "idle"), tree)
    await Bun.sleep(0)
    test.connection.emit(status("two", "busy"), "/other")
    await Bun.sleep(0)
    expect(test.driver.starts).toBe(2)
    expect(test.connection.calls).toContain("/other")
    test.connection.emit(status("two", "idle"), "/other")
    await Bun.sleep(0)
    expect(test.service.getState().active).toBe(false)
    await test.service.dispose()
  })

  it.each(["alias", "real"] as const)(
    "releases rehydrated %s snapshots from the other symlink spelling",
    async (route) => {
      const paths = await aliases()
      const source = paths[route]
      const target = route === "alias" ? paths.real : paths.alias
      const rows = snapshot({ parent: { type: "busy", working: false }, background: { type: "idle", working: true } })
      const test = setup({ [source]: rows, [target]: rows })
      test.connection.dirs = [source]
      try {
        await test.service.setEnabled(true)
        await test.service.setEnabled(false)
        await test.service.setEnabled(true)
        expect(test.driver.held).toBe(true)
        test.connection.data[source] = test.connection.data[target] = snapshot({
          parent: { type: "busy", working: false },
        })
        test.connection.emit(status("background", "idle", false, "session.working"), target)
        await Bun.sleep(0)
        expect(test.service.getState().active).toBe(false)
        expect(test.driver.held).toBe(false)
        expect(test.connection.calls).toEqual([source, source])
      } finally {
        await test.service.dispose()
        await rm(paths.dir, { recursive: true, force: true })
      }
    },
  )

  it("keeps equal session IDs isolated across real directories", async () => {
    const paths = await aliases()
    const other = path.join(paths.dir, "other")
    await mkdir(other)
    const test = setup({ [paths.alias]: snapshot({ one: "busy" }), [other]: snapshot({ one: "busy" }) })
    test.connection.dirs = [paths.alias, other]
    try {
      await test.service.setEnabled(true)
      test.connection.emit(status("one", "busy", false), paths.real)
      await Bun.sleep(0)
      expect(test.driver.held).toBe(true)
      test.connection.emit(status("one", "busy", false), other)
      await Bun.sleep(0)
      expect(test.driver.held).toBe(false)
    } finally {
      await test.service.dispose()
      await rm(paths.dir, { recursive: true, force: true })
    }
  })

  it("removes a deleted directory through its cached canonical alias", async () => {
    const paths = await aliases()
    const test = setup({ [paths.alias]: snapshot({ one: "busy" }) })
    test.connection.dirs = [paths.alias]
    try {
      await test.service.setEnabled(true)
      const gate = Promise.withResolvers<Reply<Snapshot>>()
      test.connection.statuses = () => gate.promise
      const refresh = test.service.refresh()
      await rm(paths.real, { recursive: true })
      test.connection.dirs = []
      test.connection.emit({ id: "disposed", type: "server.instance.disposed", properties: { directory: paths.real } })
      gate.resolve({ data: snapshot({ one: "busy" }) })
      await refresh
      expect(test.driver.held).toBe(false)
      expect(test.connection.calls).toHaveLength(2)
      await test.service.refresh()
      expect(test.connection.calls).toHaveLength(2)
    } finally {
      await test.service.dispose()
      await rm(paths.dir, { recursive: true, force: true })
    }
  })

  it("resolves a retargeted alias after reset instead of caching disabled observations", async () => {
    const paths = await aliases()
    const other = path.join(paths.dir, "other")
    await mkdir(other)
    const test = setup({ [paths.alias]: snapshot({ one: "busy" }) })
    test.connection.dirs = [paths.alias]
    try {
      await test.service.setEnabled(true)
      await test.service.setEnabled(false)
      test.connection.emit(status("one", "busy"), paths.alias)
      expect(test.connection.calls).toEqual([paths.alias])
      await rm(paths.alias)
      await symlink(other, paths.alias, process.platform === "win32" ? "junction" : "dir")
      await test.service.setEnabled(true)
      test.connection.emit(status("one", "busy", false), await realpath(other))
      await Bun.sleep(0)
      expect(test.driver.held).toBe(false)
      expect(test.connection.calls).toEqual([paths.alias, paths.alias])
    } finally {
      await test.service.dispose()
      await rm(paths.dir, { recursive: true, force: true })
    }
  })

  it("routes equivalent directory spellings to the same status feed", async () => {
    const test = setup({ [root]: snapshot({ one: { type: "idle", working: true } }) })
    await test.service.setEnabled(true)
    test.connection.emit(status("one", "busy", false), "\\workspace\\")
    await Bun.sleep(0)
    expect(test.service.getState().active).toBe(false)
    expect(test.connection.calls).toEqual([root])
    test.connection.emit(status("one", "idle", true), `${root}/`)
    await Bun.sleep(0)
    expect(test.service.getState().active).toBe(true)
    expect(test.connection.calls).toEqual([root])
    await test.service.dispose()
  })

  it.each([
    ["busy", undefined],
    ["idle", true],
  ] as const)("rehydrates unqualified %s work without inventing directory ownership", async (type, working) => {
    const test = setup()
    await test.service.setEnabled(true)
    test.connection.data[root] = snapshot({ one: { type, working } })
    test.connection.emit(status("one", type, working))
    await Bun.sleep(0)
    expect(test.driver.starts).toBe(1)
    test.connection.emit(status("one", "busy", false))
    await Bun.sleep(0)
    expect(test.service.getState().active).toBe(false)
    expect(test.connection.calls).toHaveLength(2)
    test.connection.data[root] = snapshot()
    test.connection.emit(status("unknown", type, working))
    await Bun.sleep(0)
    expect(test.driver.starts).toBe(1)
    await test.service.dispose()
  })

  it.each(["busy", "retry", "idle", "offline"] as const)("treats working as authoritative for %s", async (type) => {
    const test = setup({ [root]: snapshot({ one: { type, working: false } }) })
    await test.service.setEnabled(true)
    test.connection.change("connecting")
    test.connection.change("connected")
    await Bun.sleep(0)
    expect(test.driver.starts).toBe(0)
    test.connection.emit(status("one", type, true), root)
    await Bun.sleep(0)
    expect(test.service.getState().active).toBe(true)
    test.connection.emit(status("one", type, false), root)
    await Bun.sleep(0)
    expect(test.service.getState().active).toBe(false)
    expect(test.driver.starts).toBe(1)
    expect(test.driver.stops).toBe(1)
    await test.service.dispose()
  })

  it.each([
    ["busy", true],
    ["retry", true],
    ["idle", false],
    ["offline", false],
  ] as const)("uses the legacy %s fallback when working is absent", async (type, active) => {
    const test = setup({ [root]: snapshot({ one: type }) })
    await test.service.setEnabled(true)
    expect(test.service.getState().active).toBe(active)
    await test.service.dispose()
  })

  it("does not veto automatic work for pending prompts or turn completion", async () => {
    const test = setup({ [root]: snapshot({ one: { type: "busy", working: true } }) })
    await test.service.setEnabled(true)
    for (const type of ["permission.asked", "question.asked", "session.turn.close"]) {
      test.connection.emit(
        {
          id: type,
          type,
          properties: { id: "wait", sessionID: "one", blocking: true, reason: "completed" },
        } as SSEPayload,
        root,
      )
    }
    await Bun.sleep(0)
    expect(test.service.getState().active).toBe(true)
    expect(test.driver.stops).toBe(0)
    expect(test.connection.calls).toEqual([root])
    test.connection.emit(status("one", "busy", false), root)
    await Bun.sleep(0)
    expect(test.service.getState().active).toBe(false)
    await test.service.dispose()
  })

  it("keeps independent background work while foreground and blocked sessions make no progress", async () => {
    const test = setup({
      [root]: snapshot({ foreground: { type: "busy", working: true }, blocked: { type: "busy", working: false } }),
      [tree]: snapshot({ background: { type: "idle", working: true } }),
    })
    test.connection.dirs.push(tree)
    await test.service.setEnabled(true)
    test.connection.emit(status("foreground", "idle", false), root)
    await Bun.sleep(0)
    expect(test.driver.stops).toBe(0)
    test.connection.emit(status("background", "idle", false), tree)
    await Bun.sleep(0)
    expect(test.service.getState().active).toBe(false)
    expect(test.driver.starts).toBe(1)
    expect(test.driver.stops).toBe(1)
    await test.service.dispose()
  })

  it.each(["session.idle", "session.error", "session.deleted"])("releases legacy work for %s", async (type) => {
    const test = setup({ [root]: snapshot({ one: "busy" }) })
    await test.service.setEnabled(true)
    test.connection.emit({ id: "end", type, properties: { sessionID: "one", reason: "completed" } } as SSEPayload, root)
    await Bun.sleep(0)
    expect(test.service.getState().active).toBe(false)
    expect(test.driver.stops).toBe(1)
    await test.service.dispose()
  })

  it.each(["session.idle", "session.error"] as const)(
    "does not let %s erase authoritative background work",
    async (type) => {
      const test = setup({ [root]: snapshot({ one: { type: "idle", working: true } }) })
      await test.service.setEnabled(true)
      test.connection.emit({ id: type, type, properties: { sessionID: "one" } }, root)
      await Bun.sleep(0)
      expect(test.driver.stops).toBe(0)
      test.connection.emit(status("one", "idle", false), root)
      await Bun.sleep(0)
      expect(test.service.getState().active).toBe(false)
      await test.service.dispose()
    },
  )

  it("clears a disposed directory without discarding a running sibling", async () => {
    const test = setup({ [root]: snapshot({ one: "busy" }), [tree]: snapshot({ two: "busy" }) })
    test.connection.dirs.push(tree)
    await test.service.setEnabled(true)
    test.connection.emit({ id: "disposed", type: "server.instance.disposed", properties: { directory: root } })
    await Bun.sleep(0)
    expect(test.driver.stops).toBe(0)
    test.connection.emit(status("two", "idle"), tree)
    await Bun.sleep(0)
    expect(test.service.getState().active).toBe(false)
    await test.service.dispose()
  })

  it.each(["session.deleted", "server.instance.disposed"] as const)(
    "does not restore a snapshot after %s",
    async (type) => {
      const test = setup({ [root]: snapshot({ one: { type: "idle", working: true } }) })
      await test.service.setEnabled(true)
      const gate = Promise.withResolvers<Reply<Snapshot>>()
      test.connection.statuses = () => gate.promise
      const refresh = test.service.refresh()
      test.connection.emit({ id: type, type, properties: { sessionID: "one", directory: root } } as SSEPayload, root)
      await Bun.sleep(0)
      expect(test.service.getState().active).toBe(false)
      gate.resolve({ data: { one: { type: "idle", working: true } } })
      await refresh
      expect(test.service.getState().active).toBe(false)
      await test.service.dispose()
    },
  )

  it("replays newer events while independent directory snapshots finish", async () => {
    const gate = Promise.withResolvers<Reply<Snapshot>>()
    const test = setup()
    test.connection.dirs.push(tree)
    test.connection.statuses = async (dir) => (dir === root ? gate.promise : { data: { two: { type: "busy" } } })
    const enabling = test.service.setEnabled(true)
    test.connection.emit(status("one", "idle"), root)
    await Bun.sleep(0)
    expect(test.service.getState().active).toBe(true)
    gate.resolve({ data: { one: { type: "busy" } } })
    await enabling
    test.connection.emit(status("two", "idle"), tree)
    await Bun.sleep(0)
    expect(test.service.getState().active).toBe(false)
    await test.service.dispose()
  })

  it("replays authoritative status changes over stale snapshots in both directions", async () => {
    const test = setup({ [root]: snapshot({ one: { type: "busy", working: true } }) })
    await test.service.setEnabled(true)
    const gate = Promise.withResolvers<Reply<Snapshot>>()
    test.connection.statuses = () => gate.promise
    const refresh = test.service.refresh()
    test.connection.emit(status("one", "retry", false), root)
    gate.resolve({ data: { one: { type: "busy", working: true } } })
    await refresh
    expect(test.service.getState().active).toBe(false)
    const pending = Promise.withResolvers<Reply<Snapshot>>()
    test.connection.statuses = () => pending.promise
    const recovery = test.service.refresh()
    test.connection.emit(status("one", "idle", true), root)
    test.connection.emit({ id: "idle", type: "session.idle", properties: { sessionID: "one" } }, root)
    pending.resolve({ data: { one: { type: "idle", working: false } } })
    await recovery
    expect(test.service.getState().active).toBe(true)
    await test.service.dispose()
  })

  it("drops failed-directory activity, keeps healthy siblings, and recovers on refresh", async () => {
    const test = setup({ [root]: snapshot({ one: "busy" }), [tree]: snapshot({ two: "busy" }) })
    test.connection.dirs.push(tree)
    await test.service.setEnabled(true)
    test.connection.statuses = async (dir) => {
      if (dir === root) throw new Error("status failed")
      return { data: { two: { type: "busy" } } }
    }
    await test.service.refresh()
    expect(test.service.getState().active).toBe(true)
    test.connection.emit(status("two", "idle"), tree)
    await Bun.sleep(0)
    expect(test.service.getState().active).toBe(false)
    test.connection.statuses = async () => ({ data: {} })
    await test.service.refresh()
    test.connection.emit(status("one", "busy"), root)
    await Bun.sleep(0)
    expect(test.driver.starts).toBe(2)
    await test.service.dispose()
  })

  it("fails closed when the status snapshot is missing and can recover", async () => {
    const test = setup()
    test.connection.statuses = async () => ({ error: new Error("unavailable") })
    await test.service.setEnabled(true)
    expect(test.driver.starts).toBe(0)
    test.connection.statuses = async () => ({ data: { one: { type: "idle", working: true } } })
    await test.service.refresh()
    expect(test.driver.starts).toBe(1)
    await test.service.dispose()
  })

  it.each(["connecting", "disconnected", "error"] as const)(
    "releases throughout %s and rehydrates on reconnect",
    async (state) => {
      const test = setup({ [root]: snapshot({ one: "busy" }) })
      await test.service.setEnabled(true)
      test.connection.change(state)
      test.connection.emit(status("one", "busy"), root)
      await Bun.sleep(0)
      expect(test.service.getState().active).toBe(false)
      expect(test.driver.stops).toBe(1)
      test.connection.data[root] = snapshot()
      test.connection.change("connected")
      await Bun.sleep(0)
      expect(test.driver.starts).toBe(1)
      test.connection.data[root] = snapshot({ one: "busy" })
      await test.service.refresh()
      expect(test.driver.starts).toBe(2)
      await test.service.dispose()
    },
  )

  it("ignores late snapshots from the previous connection", async () => {
    const test = setup({ [root]: snapshot({ one: "busy" }) })
    await test.service.setEnabled(true)
    const gate = Promise.withResolvers<Reply<Snapshot>>()
    test.connection.statuses = () => gate.promise
    const refresh = test.service.refresh()
    await Bun.sleep(0)
    test.connection.change("connecting")
    test.connection.statuses = async () => ({ data: {} })
    test.connection.change("connected")
    await Bun.sleep(0)
    gate.resolve({ data: { one: { type: "busy" } } })
    await refresh
    expect(test.service.getState().active).toBe(false)
    expect(test.driver.starts).toBe(1)
    await test.service.dispose()
  })

  it("does not restore snapshots or issue requests after disable or disposal", async () => {
    const test = setup()
    const gate = Promise.withResolvers<Reply<Snapshot>>()
    test.connection.statuses = () => gate.promise
    const enabling = test.service.setEnabled(true)
    await Bun.sleep(0)
    await test.service.setEnabled(false)
    await test.service.dispose()
    gate.resolve({ data: { one: { type: "busy" } } })
    await enabling
    await test.service.refresh()
    await test.service.setEnabled(true)
    expect(test.driver.starts).toBe(0)
    expect(test.connection.calls).toHaveLength(1)
    expect(test.connection.events.size).toBe(0)
    expect(test.connection.states.size).toBe(0)
  })

  it.each(["disable", "dispose", "disconnect", "idle", "blocked"])(
    "cancels a late acquisition after %s",
    async (action) => {
      const test = setup({ [root]: snapshot({ one: "busy" }) })
      const gate = Promise.withResolvers<void>()
      test.driver.open = () => gate.promise
      const states: boolean[] = []
      test.service.onChange((state) => states.push(state.active))
      const enabling = test.service.setEnabled(true)
      await Bun.sleep(0)
      expect(test.driver.starts).toBe(1)
      const ending =
        action === "dispose"
          ? test.service.dispose()
          : action === "disable"
            ? test.service.setEnabled(false)
            : undefined
      if (action === "disconnect") test.connection.change("connecting")
      if (action === "idle") test.connection.emit(status("one", "idle"), root)
      if (action === "blocked") test.connection.emit(status("one", "busy", false), root)
      gate.resolve()
      await enabling
      await ending
      await Bun.sleep(0)
      expect(states).not.toContain(true)
      expect(test.driver.held).toBe(false)
      expect(test.driver.stops).toBe(1)
      await test.service.dispose()
      expect(test.driver.stops).toBe(1)
    },
  )

  it("cancels an old acquisition even when work resumes before it completes", async () => {
    const test = setup({ [root]: snapshot({ one: "busy" }) })
    const gate = Promise.withResolvers<void>()
    test.driver.open = () => gate.promise
    const enabling = test.service.setEnabled(true)
    await Bun.sleep(0)
    const stale = test.driver.exit
    test.connection.emit(status("one", "busy", false), root)
    test.connection.emit(status("one", "busy", true), root)
    gate.resolve()
    await enabling
    await Bun.sleep(0)
    expect(test.driver.stops).toBe(1)
    expect(test.driver.starts).toBe(2)
    expect(test.service.getState().active).toBe(true)
    stale?.(new Error("late exit"))
    await Bun.sleep(0)
    expect(test.driver.starts).toBe(2)
    expect(test.service.getState().error).toBeUndefined()
    await test.service.dispose()
  })

  it("waits for cleanup before reacquisition and shares idempotent disposal", async () => {
    const test = setup({ [root]: snapshot({ one: "busy" }) })
    await test.service.setEnabled(true)
    const gate = Promise.withResolvers<void>()
    test.driver.close = () => gate.promise
    const disabling = test.service.setEnabled(false)
    await Bun.sleep(0)
    const enabling = test.service.setEnabled(true)
    await Bun.sleep(0)
    expect(test.driver.starts).toBe(1)
    expect(test.driver.stops).toBe(1)
    gate.resolve()
    await Promise.all([disabling, enabling])
    expect(test.driver.starts).toBe(2)
    const stop = Promise.withResolvers<void>()
    test.driver.close = () => stop.promise
    const closing = test.service.dispose()
    expect(test.service.dispose()).toBe(closing)
    let settled = false
    void closing.then(() => {
      settled = true
    })
    await Bun.sleep(0)
    expect(settled).toBe(false)
    stop.resolve()
    await closing
    expect(test.service.getState().active).toBe(false)
    expect(test.driver.stops).toBe(2)
  })

  it("recovers once from a failed start without leaving its partial acquisition held", async () => {
    const test = setup({ [root]: snapshot({ one: "busy" }) })
    test.driver.open = () => {
      if (test.driver.starts === 1) throw new Error("start failed")
      expect(test.driver.stops).toBe(1)
      return Promise.resolve()
    }
    await test.service.setEnabled(true)
    await Bun.sleep(0)
    expect(test.driver.starts).toBe(2)
    expect(test.service.getState()).toMatchObject({ active: true, available: true, error: undefined })
    await test.service.dispose()
  })

  it("bounds failed-start retries and allows an explicit off/on recovery", async () => {
    const test = setup({ [root]: snapshot({ one: "busy" }) })
    test.driver.open = async () => {
      throw new Error("start failed")
    }
    await test.service.setEnabled(true)
    await Bun.sleep(0)
    expect(test.driver.starts).toBe(2)
    expect(test.driver.stops).toBe(2)
    expect(test.driver.held).toBe(false)
    expect(test.service.getState()).toMatchObject({ active: false, available: false, error: "start failed" })
    test.connection.emit(status("one", "busy"), root)
    await Bun.sleep(0)
    expect(test.driver.starts).toBe(2)
    await test.service.setEnabled(false)
    test.driver.open = () => Promise.resolve()
    await test.service.setEnabled(true)
    expect(test.driver.starts).toBe(3)
    expect(test.service.getState()).toMatchObject({ active: true, available: true, error: undefined })
    await test.service.dispose()
  })

  it("recovers once from process exit and reports its final error", async () => {
    const test = setup({ [root]: snapshot({ one: "busy" }) })
    await test.service.setEnabled(true)
    test.driver.die(new Error("first exit"))
    await Bun.sleep(0)
    expect(test.driver.starts).toBe(2)
    expect(test.service.getState().active).toBe(true)
    test.driver.die(new Error("native failure"))
    await Bun.sleep(0)
    expect(test.driver.starts).toBe(2)
    expect(test.service.getState()).toMatchObject({ active: false, available: false, error: "native failure" })
    await test.service.dispose()
  })

  it("never publishes active when the process exits during startup", async () => {
    const test = setup({ [root]: snapshot({ one: "busy" }) })
    const states: boolean[] = []
    test.service.onChange((state) => states.push(state.active))
    test.driver.open = async () => {
      test.driver.die(new Error("early exit"))
    }
    await test.service.setEnabled(true)
    await Bun.sleep(0)
    expect(states).not.toContain(true)
    expect(test.driver.starts).toBe(2)
    expect(test.service.getState().available).toBe(false)
    await test.service.dispose()
  })

  it("lets the consent adapter retry failed cleanup and then enable again", async () => {
    const test = setup({ [root]: snapshot({ one: "busy" }) })
    const toggle = confirmCaffeination(test.service, async () => true)
    await toggle(true)
    test.driver.close = async () => {
      throw new Error("stop failed")
    }
    await toggle(false)
    expect(test.driver.held).toBe(true)
    expect(test.service.getState()).toMatchObject({
      enabled: false,
      active: true,
      available: false,
      error: "stop failed",
    })
    test.driver.close = () => Promise.resolve()
    await toggle(false)
    expect(test.driver.held).toBe(false)
    expect(test.service.getState()).toEqual({ enabled: false, active: false, available: true, error: undefined })
    await toggle(true)
    expect(test.driver.starts).toBe(2)
    expect(test.driver.held).toBe(true)
    await test.service.dispose()
    expect(test.driver.held).toBe(false)
  })

  it("propagates failed disposal without dropping cleanup ownership", async () => {
    const test = setup({ [root]: snapshot({ one: "busy" }) })
    await test.service.setEnabled(true)
    test.driver.close = async () => {
      throw new Error("stop failed")
    }
    const closing = test.service.dispose()
    await expect(closing).rejects.toThrow("stop failed")
    expect(test.service.dispose()).toBe(closing)
    expect(test.driver.stops).toBe(1)
    expect(test.driver.held).toBe(true)
    expect(test.service.getState()).toMatchObject({ active: true, available: false, error: "stop failed" })
  })

  it("does not load activity or start an unavailable driver", async () => {
    const test = setup({ [root]: snapshot({ one: "busy" }) }, new Driver(false, "unavailable"))
    await test.service.setEnabled(true)
    test.connection.emit(status("one", "busy"), root)
    expect(test.connection.calls).toEqual([])
    expect(test.driver.starts).toBe(0)
    expect(test.service.getState()).toMatchObject({ available: false, active: false, error: "unavailable" })
    await test.service.dispose()
  })
})
