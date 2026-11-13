import { afterEach, describe, expect, test } from "bun:test"
import type { KiloRetentionRpc } from "@opencode/schema/kilocode/retention"
import { CleanupPoll, type CleanupRpc, type CleanupState } from "../webview-ui/src/components/settings/cleanup"

const polls: CleanupPoll[] = []
afterEach(() => polls.splice(0).forEach((poll) => poll.dispose()))

type Pending<T> = { resolve: (value: T) => void; reject: (error: unknown) => void; signal?: AbortSignal }

// A stand-in for the retention RPC that answers each call when the test says so. The webview test suite runs no
// server; the real RPC is exercised in packages/kilo-cli/test/retention.test.ts.
function fixture(timing = { poll: 20, timeout: 1000 }) {
  const calls = {
    status: [] as Pending<KiloRetentionRpc.Status>[],
    run: [] as Pending<KiloRetentionRpc.Status>[],
    cancel: [] as Pending<{ requested: boolean }>[],
  }
  const defer = <T,>(list: Pending<T>[], signal?: AbortSignal) =>
    new Promise<T>((resolve, reject) => {
      list.push({ resolve, reject, signal })
      signal?.addEventListener("abort", () => reject(signal.reason))
    })
  const rpc: CleanupRpc = {
    status: (_input, options) => defer(calls.status, options.signal),
    run: () => defer(calls.run),
    cancel: () => defer(calls.cancel),
  }
  const states: CleanupState[] = []
  const poll = new CleanupPoll(rpc, (state) => states.push(state), timing)
  polls.push(poll)
  return { poll, calls, states, last: () => states.at(-1) }
}

const policy = { enabled: true, maxAgeDays: 30 }
const progress = { phase: "deleting" as const, total: 12, processed: 7, deleted: 6, failed: 1, skippedActive: 2 }
const result = { at: 1, scanned: 20, deleted: 12, skippedActive: 2, failed: 0, durationMs: 1200 }
const flush = () => Bun.sleep(0)

describe("session cleanup polling", () => {
  test("keeps one status request in flight and polls again after each reply", async () => {
    const f = fixture()
    f.poll.start()
    f.poll.start()
    expect(f.calls.status).toHaveLength(1)
    f.calls.status[0].resolve({ policy, progress })
    await flush()
    expect(f.last()).toEqual({ running: false, status: { policy, progress } })
    await Bun.sleep(40)
    expect(f.calls.status).toHaveLength(2)
    f.calls.status[1].resolve({ policy, last: result })
    await flush()
    expect(f.last()?.status).toEqual({ policy, last: result })
  })

  test("an unreachable status keeps the last progress and shows a warning until it recovers", async () => {
    const f = fixture()
    f.poll.start()
    f.calls.status[0].resolve({ policy, progress })
    await Bun.sleep(40)
    f.calls.status[1].reject(new Error("offline"))
    await flush()
    expect(f.last()).toMatchObject({ error: "status", status: { progress } })
    await Bun.sleep(40)
    f.calls.status[2].resolve({ policy, progress: { ...progress, processed: 8, deleted: 7 } })
    await flush()
    expect(f.last()?.error).toBeUndefined()
    expect(f.last()?.status?.progress?.processed).toBe(8)
  })

  test("a slow status times out without losing the shown state", async () => {
    const f = fixture({ poll: 1000, timeout: 20 })
    f.poll.start()
    await Bun.sleep(40)
    expect(f.calls.status[0].signal?.aborted).toBe(true)
    expect(f.last()?.error).toBe("timeout")
  })

  test("a manual run forces a pass, shows it as running and settles with its result", async () => {
    const f = fixture()
    f.poll.execute()
    f.poll.execute()
    expect(f.calls.run).toHaveLength(1)
    expect(f.last()).toEqual({ running: true, error: undefined })
    f.calls.run[0].resolve({ policy, last: result })
    await flush()
    expect(f.last()).toEqual({ running: false, error: undefined, status: { policy, last: result } })
    f.poll.execute()
    expect(f.calls.run).toHaveLength(2)
  })

  test("a failed run shows the run error and allows another run", async () => {
    const f = fixture()
    f.poll.execute()
    f.calls.run[0].reject(new Error("dropped"))
    await flush()
    expect(f.last()).toEqual({ running: false, error: "run" })
    // A later status keeps the run error visible: the user should check the last result first.
    f.poll.start()
    f.calls.status[0].resolve({ policy, last: result })
    await flush()
    expect(f.last()?.error).toBe("run")
    f.poll.execute()
    expect(f.calls.run).toHaveLength(2)
    expect(f.last()?.error).toBeUndefined()
  })

  test("stop cancels only a pass that reports progress, then reads the status", async () => {
    const f = fixture({ poll: 1000, timeout: 1000 })
    f.poll.stop()
    expect(f.calls.cancel).toHaveLength(0)
    f.poll.start()
    f.calls.status[0].resolve({ policy, progress })
    await flush()
    f.poll.stop()
    expect(f.calls.cancel).toHaveLength(1)
    f.calls.cancel[0].resolve({ requested: true })
    await flush()
    expect(f.calls.status).toHaveLength(2)
    f.calls.status[1].resolve({ policy, last: { ...result, cancelled: true } })
    await flush()
    expect(f.last()?.status?.last?.cancelled).toBe(true)
  })

  test("disposal stops polling and ignores late replies", async () => {
    const f = fixture()
    f.poll.start()
    f.poll.dispose()
    f.calls.status[0].resolve({ policy, progress })
    await Bun.sleep(40)
    expect(f.states).toEqual([])
    expect(f.calls.status).toHaveLength(1)
    f.poll.start()
    f.poll.execute()
    expect(f.calls.status).toHaveLength(1)
    expect(f.calls.run).toHaveLength(0)
  })
})
