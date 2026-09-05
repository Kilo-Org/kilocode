import { describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { KiloClient, SessionStatus } from "@kilocode/sdk/v2/client"
import type { ConnectionState } from "../../src/services/cli-backend/connection-service"
import type { SSEPayload } from "../../src/services/cli-backend/sdk-sse-adapter"
import { CaffeinationService } from "../../src/services/caffeination"
import { confirmCaffeination } from "../../src/services/caffeination/confirm"

type Snapshot = Record<string, Pick<SessionStatus, "type">>
const root = "/workspace"
const tree = "/workspace/tree"

function setup(data: Record<string, Snapshot> = {}) {
  const events = new Set<(event: SSEPayload, dir?: string) => void>()
  const states = new Set<(state: ConnectionState) => void>()
  const connection = {
    state: "connected" as ConnectionState,
    dirs: Object.keys(data).length ? Object.keys(data) : [root],
    calls: [] as string[],
    load: async (dir: string): Promise<Snapshot> => data[dir] ?? {},
    onEvent: (listener: (event: SSEPayload, dir?: string) => void) => {
      events.add(listener)
      return () => events.delete(listener)
    },
    onStateChange: (listener: (state: ConnectionState) => void) => {
      states.add(listener)
      return () => states.delete(listener)
    },
    getConnectionState: () => connection.state,
    getKnownDirectories: () => connection.dirs,
    getClient: () =>
      ({
        session: {
          status: async ({ directory }: { directory: string }) => {
            connection.calls.push(directory)
            return { data: await connection.load(directory) }
          },
        },
      }) as unknown as KiloClient,
  }
  const driver = {
    available: true,
    held: false,
    starts: 0,
    stops: 0,
    exit: undefined as ((error?: Error) => void) | undefined,
    open: () => Promise.resolve(),
    close: () => Promise.resolve(),
    async start(_pid: number, exit: (error?: Error) => void) {
      driver.starts++
      driver.held = true
      driver.exit = exit
      await driver.open()
    },
    async stop() {
      driver.stops++
      await driver.close()
      driver.held = false
    },
  }
  const service = new CaffeinationService(connection, driver)
  const emit = (event: SSEPayload, dir = root) => {
    for (const listener of events) listener(event, dir)
  }
  const status = (id: string, type: SessionStatus["type"], dir = root) =>
    emit(
      { id: "status", type: "session.status", properties: { sessionID: id, status: { type } as SessionStatus } },
      dir,
    )
  const change = (state: ConnectionState) => {
    connection.state = state
    for (const listener of states) listener(state)
  }
  return { service, driver, connection, status, emit, change, events, states }
}

describe("keep-awake", () => {
  it("does no work by default and follows all busy/retry sessions without inspecting prompts", async () => {
    const test = setup({ [root]: { one: { type: "busy" } }, [tree]: { two: { type: "retry" } } })
    test.status("one", "busy")
    await test.service.refresh()
    expect(test.driver.starts).toBe(0)
    expect(test.connection.calls).toEqual([])
    await test.service.setEnabled(true)
    expect(test.driver.starts).toBe(1)
    test.emit({ id: "question", type: "question.asked", properties: { id: "q", sessionID: "one", questions: [] } })
    test.status("two", "idle", tree)
    await Bun.sleep(0)
    expect(test.driver.held).toBe(true)
    test.status("one", "offline")
    await Bun.sleep(0)
    expect(test.driver.held).toBe(false)
    await test.service.dispose()
  })

  it("replays live updates over stale snapshots and includes newly observed directories", async () => {
    const test = setup()
    const gate = Promise.withResolvers<Snapshot>()
    test.connection.load = (dir) => (dir === root ? gate.promise : Promise.resolve({ two: { type: "busy" } }))
    const enabled = test.service.setEnabled(true)
    test.status("one", "idle")
    test.status("two", "busy", tree)
    gate.resolve({ one: { type: "busy" } })
    await enabled
    expect(test.driver.held).toBe(true)
    test.emit({ id: "deleted", type: "session.deleted", properties: { sessionID: "two" } } as SSEPayload, tree)
    await Bun.sleep(0)
    expect(test.driver.held).toBe(false)
    await test.service.dispose()
  })

  it.each(["connecting", "disconnected", "error"] as const)(
    "releases on %s and ignores old snapshots",
    async (state) => {
      const test = setup({ [root]: { one: { type: "busy" } } })
      await test.service.setEnabled(true)
      const gate = Promise.withResolvers<Snapshot>()
      test.connection.load = () => gate.promise
      const refresh = test.service.refresh()
      await Bun.sleep(0)
      test.change(state)
      test.connection.load = async () => ({})
      test.change("connected")
      gate.resolve({ one: { type: "busy" } })
      await refresh
      await Bun.sleep(0)
      expect(test.driver.held).toBe(false)
      expect(test.driver.starts).toBe(1)
      await test.service.dispose()
    },
  )

  it.each([false, true])("canonicalizes snapshot and live-event aliases (reverse=%s)", async (reverse) => {
    const dir = await mkdtemp(join(tmpdir(), "keep-awake-"))
    const actual = join(dir, "actual")
    const alias = join(dir, "alias")
    await mkdir(actual)
    await symlink(actual, alias, process.platform === "win32" ? "junction" : "dir")
    const real = await realpath(actual)
    const source = reverse ? real : alias
    const target = reverse ? alias : real
    const test = setup({ [source]: { one: { type: "busy" } } })
    try {
      await test.service.setEnabled(true)
      await test.service.setEnabled(false)
      await test.service.setEnabled(true)
      test.status("one", "idle", target)
      await Bun.sleep(0)
      expect(test.driver.held).toBe(false)
      expect(test.connection.calls).toEqual([source, source])
    } finally {
      await test.service.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it.each(["disable", "disconnect", "dispose"] as const)("cleans up a late acquisition after %s", async (action) => {
    const test = setup({ [root]: { one: { type: "busy" } } })
    const gate = Promise.withResolvers<void>()
    test.driver.open = () => gate.promise
    const enabled = test.service.setEnabled(true)
    await Bun.sleep(0)
    expect(test.driver.starts).toBe(1)
    const stopped =
      action === "dispose" ? test.service.dispose() : action === "disable" ? test.service.setEnabled(false) : undefined
    if (action === "disconnect") test.change("connecting")
    gate.resolve()
    await Promise.all([enabled, stopped])
    expect(test.driver.held).toBe(false)
    expect(test.service.getState().active).toBe(false)
    await test.service.dispose()
    expect(test.events.size + test.states.size).toBe(0)
  })

  it("reports process failure without automatic restart and allows explicit retry", async () => {
    const test = setup({ [root]: { one: { type: "busy" } } })
    test.driver.open = async () => {
      throw new Error("start failed")
    }
    await test.service.setEnabled(true)
    expect(test.driver.starts).toBe(1)
    expect(test.driver.held).toBe(false)
    expect(test.service.getState().error).toBe("start failed")
    test.driver.open = () => Promise.resolve()
    await test.service.setEnabled(false)
    await test.service.setEnabled(true)
    test.driver.held = false
    test.driver.exit?.(new Error("process exited"))
    await Bun.sleep(0)
    expect(test.driver.starts).toBe(2)
    expect(test.service.getState()).toMatchObject({ active: false, available: false, error: "process exited" })
    await test.service.dispose()
  })

  it("retains failed cleanup for another off attempt and awaits idempotent disposal", async () => {
    const test = setup({ [root]: { one: { type: "busy" } } })
    await test.service.setEnabled(true)
    test.driver.close = async () => {
      throw new Error("stop failed")
    }
    await test.service.setEnabled(false)
    expect(test.service.getState()).toMatchObject({ enabled: false, active: true, available: false })
    test.driver.close = () => Promise.resolve()
    await test.service.setEnabled(false)
    expect(test.driver.held).toBe(false)
    await test.service.setEnabled(true)
    const gate = Promise.withResolvers<void>()
    test.driver.close = () => gate.promise
    const closing = test.service.dispose()
    expect(test.service.dispose()).toBe(closing)
    gate.resolve()
    await closing
    expect(test.driver.held).toBe(false)
  })

  it("shares consent, remembers acceptance, and does not enable after a cancelled request", async () => {
    const test = setup()
    const answer = Promise.withResolvers<boolean>()
    let prompts = 0
    const toggle = confirmCaffeination(test.service, () => {
      prompts++
      return answer.promise
    })
    const pending = toggle(true)
    expect(toggle(true)).toBe(pending)
    expect(test.service.getState().enabled).toBe(false)
    await toggle(false)
    answer.resolve(true)
    await pending
    expect(test.service.getState().enabled).toBe(false)
    await toggle(true)
    await toggle(false)
    await toggle(true)
    expect(prompts).toBe(2)
    expect(test.service.getState().enabled).toBe(true)
    await test.service.dispose()
  })

  it("leaves keep-awake off when consent is declined", async () => {
    const test = setup()
    await confirmCaffeination(test.service, async () => false)(true)
    expect(test.service.getState().enabled).toBe(false)
    expect(test.driver.starts).toBe(0)
    await test.service.dispose()
  })
})
