import { describe, expect, test, beforeEach } from "bun:test"
import { IngestQueue } from "../../../src/kilo-sessions/ingest-queue"

function scheduler(now: () => number) {
  const tasks = new Map<number, { at: number; fn: () => void }>()
  let next = 1

  const setTimeout = (fn: () => void, ms: number) => {
    const id = next
    next += 1
    tasks.set(id, { at: now() + ms, fn })
    return id as unknown as ReturnType<typeof globalThis.setTimeout>
  }

  const clearTimeout = (timer: ReturnType<typeof globalThis.setTimeout>) => {
    tasks.delete(timer as unknown as number)
  }

  const run = () => {
    const due = Array.from(tasks.entries())
      .filter(([, t]) => t.at <= now())
      .map(([id]) => id)
    for (const id of due) {
      const task = tasks.get(id)
      tasks.delete(id)
      task?.fn()
    }
  }

  const size = () => tasks.size

  const nextAt = () => {
    const at = Array.from(tasks.values())
      .map((t) => t.at)
      .sort((a, b) => a - b)[0]
    return at
  }

  return {
    setTimeout,
    clearTimeout,
    run,
    size,
    nextAt,
  } as const
}

describe("share ingest queue", () => {
  const clock = {
    now: 0,
  }

  beforeEach(() => {
    clock.now = 0
  })

  test("throttles flush scheduling: later sync does not reschedule", async () => {
    const calls: unknown[] = []
    const sched = scheduler(() => clock.now)

    const q = IngestQueue.create({
      now: () => clock.now,
      setTimeout: sched.setTimeout,
      clearTimeout: sched.clearTimeout,
      log: { error: () => {} },
      getShare: async () => ({ ingestPath: "/ingest" }),
      getClient: async () => ({
        url: "https://ingest.test",
        fetch: async (_input, init) => {
          calls.push(JSON.parse((init?.body as string) ?? "{}"))
          return new Response("{}", { status: 200 })
        },
      }),
    })

    await q.sync("s1", [{ type: "session", data: { id: "s1", v: 1 } as any }])
    expect(sched.size()).toBe(1)

    clock.now = 900
    await q.sync("s1", [{ type: "session", data: { id: "s1", v: 2 } as any }])
    expect(sched.size()).toBe(1)

    clock.now = 1000
    sched.run()
    await Bun.sleep(0)
    expect(calls.length).toBe(1)
    expect((calls[0] as any).data[0].data.v).toBe(2)
  })

  test("coalesces same-key updates and sends latest", async () => {
    const sent: unknown[] = []
    const sched = scheduler(() => clock.now)

    const q = IngestQueue.create({
      now: () => clock.now,
      setTimeout: sched.setTimeout,
      clearTimeout: sched.clearTimeout,
      log: { error: () => {} },
      getShare: async () => ({ ingestPath: "/ingest" }),
      getClient: async () => ({
        url: "https://ingest.test",
        fetch: async (_input, init) => {
          sent.push(JSON.parse((init?.body as string) ?? "{}"))
          return new Response("{}", { status: 200 })
        },
      }),
    })

    await q.sync("s2", [{ type: "session", data: { id: "s2", v: 1 } as any }])
    clock.now = 100
    await q.sync("s2", [{ type: "session", data: { id: "s2", v: 2 } as any }])

    clock.now = 1000
    sched.run()
    await Bun.sleep(0)
    expect(sent.length).toBe(1)
    expect((sent[0] as any).data.length).toBe(1)
    expect((sent[0] as any).data[0].data.v).toBe(2)
  })

  test("kilo_meta uses stable key and coalesces", async () => {
    const sent: unknown[] = []
    const sched = scheduler(() => clock.now)

    const q = IngestQueue.create({
      now: () => clock.now,
      setTimeout: sched.setTimeout,
      clearTimeout: sched.clearTimeout,
      log: { error: () => {} },
      getShare: async () => ({ ingestPath: "/ingest" }),
      getClient: async () => ({
        url: "https://ingest.test",
        fetch: async (_input, init) => {
          sent.push(JSON.parse((init?.body as string) ?? "{}"))
          return new Response("{}", { status: 200 })
        },
      }),
    })

    await q.sync("s7", [
      { type: "kilo_meta", data: { platform: "cli", gitUrl: "https://github.com/old/repo.git", gitBranch: "main" } },
    ])
    clock.now = 100
    await q.sync("s7", [
      {
        type: "kilo_meta",
        data: { platform: "vscode", orgId: "org-1", gitUrl: "https://github.com/new/repo.git", gitBranch: "feature" },
      },
    ])

    clock.now = 1000
    sched.run()
    await Bun.sleep(0)
    expect(sent.length).toBe(1)
    expect((sent[0] as any).data.length).toBe(1)
    expect((sent[0] as any).data[0].type).toBe("kilo_meta")
    expect((sent[0] as any).data[0].data.platform).toBe("vscode")
    expect((sent[0] as any).data[0].data.orgId).toBe("org-1")
    expect((sent[0] as any).data[0].data.gitUrl).toBe("https://github.com/new/repo.git")
    expect((sent[0] as any).data[0].data.gitBranch).toBe("feature")
  })

  test("network failure retries and fill preserves newer updates", async () => {
    const sent: unknown[] = []
    const sched = scheduler(() => clock.now)
    let attempt = 0

    const q = IngestQueue.create({
      now: () => clock.now,
      setTimeout: sched.setTimeout,
      clearTimeout: sched.clearTimeout,
      log: { error: () => {} },
      getShare: async () => ({ ingestPath: "/ingest" }),
      getClient: async () => ({
        url: "https://ingest.test",
        fetch: async (_input, init) => {
          attempt += 1
          if (attempt === 1) throw new Error("network")
          sent.push(JSON.parse((init?.body as string) ?? "{}"))
          return new Response("{}", { status: 200 })
        },
      }),
    })

    await q.sync("s3", [{ type: "session", data: { id: "s3", v: 1 } as any }])

    clock.now = 1000
    sched.run() // attempt 1 -> network fail -> requeue due at 2000
    await Bun.sleep(0)

    clock.now = 1500
    await q.sync("s3", [{ type: "session", data: { id: "s3", v: 2 } as any }])

    clock.now = 2000
    sched.run() // attempt 2 -> ok
    await Bun.sleep(0)
    expect(sent.length).toBe(1)
    expect((sent[0] as any).data[0].data.v).toBe(2)
  })

  test("404 does not requeue", async () => {
    const sched = scheduler(() => clock.now)
    const q = IngestQueue.create({
      now: () => clock.now,
      setTimeout: sched.setTimeout,
      clearTimeout: sched.clearTimeout,
      log: { error: () => {} },
      getShare: async () => ({ ingestPath: "/ingest" }),
      getClient: async () => ({
        url: "https://ingest.test",
        fetch: async () => new Response("{}", { status: 404 }),
      }),
    })

    await q.sync("s4", [{ type: "session", data: { id: "s4" } as any }])
    clock.now = 1000
    sched.run()
    await Bun.sleep(0)
    expect(sched.size()).toBe(0)
  })

  test("401 triggers auth error handler and does not requeue", async () => {
    const sched = scheduler(() => clock.now)
    let cleared = false

    const q = IngestQueue.create({
      now: () => clock.now,
      setTimeout: sched.setTimeout,
      clearTimeout: sched.clearTimeout,
      log: { error: () => {} },
      onAuthError: () => {
        cleared = true
      },
      getShare: async () => ({ ingestPath: "/ingest" }),
      getClient: async () => ({
        url: "https://ingest.test",
        fetch: async () => new Response("{}", { status: 401 }),
      }),
    })

    await q.sync("s5", [{ type: "session", data: { id: "s5" } as any }])
    clock.now = 1000
    sched.run()
    await Bun.sleep(0)
    expect(cleared).toBe(true)
    expect(sched.size()).toBe(0)
  })

  test("retry budget exceeded stops requeueing", async () => {
    const errors: Record<string, unknown>[] = []
    const sched = scheduler(() => clock.now)
    let attempts = 0

    const q = IngestQueue.create({
      now: () => clock.now,
      setTimeout: sched.setTimeout,
      clearTimeout: sched.clearTimeout,
      log: {
        error: (_message, data) => {
          errors.push(data)
        },
      },
      getShare: async () => ({ ingestPath: "/ingest" }),
      getClient: async () => ({
        url: "https://ingest.test",
        fetch: async () => {
          attempts += 1
          throw new Error("network")
        },
      }),
    })

    await q.sync("s6", [{ type: "session", data: { id: "s6" } as any }])
    expect(sched.size()).toBe(1)

    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      const at = sched.nextAt()
      expect(typeof at).toBe("number")

      clock.now = at ?? 0
      sched.run()
      await Bun.sleep(0)

      expect(attempts).toBe(n)
      expect(sched.size()).toBe(n < 7 ? 1 : 0)
    }

    expect(errors.some((e) => e.error === "retry budget exceeded")).toBe(true)
  })

  test("session_open and session_close use stable keys and coalesce", async () => {
    const sent: unknown[] = []
    const sched = scheduler(() => clock.now)

    const q = IngestQueue.create({
      now: () => clock.now,
      setTimeout: sched.setTimeout,
      clearTimeout: sched.clearTimeout,
      log: { error: () => {} },
      getShare: async () => ({ ingestPath: "/ingest" }),
      getClient: async () => ({
        url: "https://ingest.test",
        fetch: async (_input, init) => {
          sent.push(JSON.parse((init?.body as string) ?? "{}"))
          return new Response("{}", { status: 200 })
        },
      }),
    })

    // Two session_open events should coalesce to one (stable key)
    await q.sync("s8", [{ type: "session_open", data: {} }])
    clock.now = 100
    await q.sync("s8", [{ type: "session_open", data: {} }])

    // Two session_close events should coalesce, keeping the latest reason
    clock.now = 200
    await q.sync("s8", [{ type: "session_close", data: { reason: "completed" } }])
    clock.now = 300
    await q.sync("s8", [{ type: "session_close", data: { reason: "error" } }])

    clock.now = 1000
    sched.run()
    await Bun.sleep(0)
    expect(sent.length).toBe(1)

    const payload = sent[0] as { data: { type: string; data: unknown }[] }
    const types = payload.data.map((d) => d.type)
    expect(types).toContain("session_open")
    expect(types).toContain("session_close")
    // Only one of each due to stable keys
    expect(types.filter((t) => t === "session_open").length).toBe(1)
    expect(types.filter((t) => t === "session_close").length).toBe(1)
    // session_close should have the latest reason
    const close = payload.data.find((d) => d.type === "session_close")
    expect((close?.data as { reason: string }).reason).toBe("error")
  })

  test("session_status uses stable key and coalesces", async () => {
    const sent: unknown[] = []
    const sched = scheduler(() => clock.now)

    const q = IngestQueue.create({
      now: () => clock.now,
      setTimeout: sched.setTimeout,
      clearTimeout: sched.clearTimeout,
      log: { error: () => {} },
      getShare: async () => ({ ingestPath: "/ingest" }),
      getClient: async () => ({
        url: "https://ingest.test",
        fetch: async (_input, init) => {
          sent.push(JSON.parse((init?.body as string) ?? "{}"))
          return new Response("{}", { status: 200 })
        },
      }),
    })

    await q.sync("s10", [{ type: "session_status", data: { status: "busy" } }])
    clock.now = 100
    await q.sync("s10", [{ type: "session_status", data: { status: "question" } }])
    clock.now = 200
    await q.sync("s10", [{ type: "session_status", data: { status: "idle" } }])

    clock.now = 1000
    sched.run()
    await Bun.sleep(0)
    expect(sent.length).toBe(1)

    const payload = sent[0] as { data: { type: string; data: unknown }[] }
    const statuses = payload.data.filter((d) => d.type === "session_status")
    // Only one session_status due to stable key
    expect(statuses.length).toBe(1)
    // Should have the latest status
    expect((statuses[0]!.data as { status: string }).status).toBe("idle")
  })

  test("flush sends request with ?v=2 query parameter", async () => {
    const urls: string[] = []
    const sched = scheduler(() => clock.now)

    const q = IngestQueue.create({
      now: () => clock.now,
      setTimeout: sched.setTimeout,
      clearTimeout: sched.clearTimeout,
      log: { error: () => {} },
      getShare: async () => ({ ingestPath: "/ingest" }),
      getClient: async () => ({
        url: "https://ingest.test",
        fetch: async (input, _init) => {
          urls.push(String(input))
          return new Response("{}", { status: 200 })
        },
      }),
    })

    await q.sync("s9", [{ type: "session", data: { id: "s9" } as any }])
    clock.now = 1000
    sched.run()
    await Bun.sleep(0)
    expect(urls.length).toBe(1)
    expect(urls[0]).toBe("https://ingest.test/ingest?v=2")
  })

  test("agent_notification distinct ids survive one debounce batch", async () => {
    const sent: unknown[] = []
    const sched = scheduler(() => clock.now)

    const q = IngestQueue.create({
      now: () => clock.now,
      setTimeout: sched.setTimeout,
      clearTimeout: sched.clearTimeout,
      log: { error: () => {} },
      getShare: async () => ({ ingestPath: "/ingest" }),
      getClient: async () => ({
        url: "https://ingest.test",
        fetch: async (_input, init) => {
          sent.push(JSON.parse((init?.body as string) ?? "{}"))
          return new Response("{}", { status: 200 })
        },
      }),
    })

    await q.sync("s-notify", [
      { type: "agent_notification", data: { id: "n1", message: "first" } },
      { type: "agent_notification", data: { id: "n2", message: "second" } },
    ])

    clock.now = 1000
    sched.run()
    await Bun.sleep(0)

    expect(sent.length).toBe(1)
    const payload = sent[0] as { data: { type: string; data: { id: string; message: string } }[] }
    expect(payload.data.length).toBe(2)
    const ids = payload.data.map((d) => d.data.id).sort()
    expect(ids).toEqual(["n1", "n2"])
  })

  test("agent_notification with the same id coalesces", async () => {
    const sent: unknown[] = []
    const sched = scheduler(() => clock.now)

    const q = IngestQueue.create({
      now: () => clock.now,
      setTimeout: sched.setTimeout,
      clearTimeout: sched.clearTimeout,
      log: { error: () => {} },
      getShare: async () => ({ ingestPath: "/ingest" }),
      getClient: async () => ({
        url: "https://ingest.test",
        fetch: async (_input, init) => {
          sent.push(JSON.parse((init?.body as string) ?? "{}"))
          return new Response("{}", { status: 200 })
        },
      }),
    })

    await q.sync("s-notify", [{ type: "agent_notification", data: { id: "n1", message: "first" } }])
    clock.now = 100
    await q.sync("s-notify", [{ type: "agent_notification", data: { id: "n1", message: "second" } }])

    clock.now = 1000
    sched.run()
    await Bun.sleep(0)

    expect(sent.length).toBe(1)
    const payload = sent[0] as { data: { type: string; data: { id: string; message: string } }[] }
    expect(payload.data.length).toBe(1)
    expect(payload.data[0].data.message).toBe("second")
  })

  test("drain flushes every pending session and does not re-enqueue on failure", async () => {
    const sent: { sessionId: string; body: unknown }[] = []
    const sched = scheduler(() => clock.now)
    let fail = false

    const q = IngestQueue.create({
      now: () => clock.now,
      setTimeout: sched.setTimeout,
      clearTimeout: sched.clearTimeout,
      log: { error: () => {} },
      getShare: async (sessionId) => ({ ingestPath: `/ingest/${sessionId}` }),
      getClient: async () => ({
        url: "https://ingest.test",
        fetch: async (input, init) => {
          const url = String(input)
          const sessionId = url.includes("/s-a") ? "s-a" : "s-b"
          sent.push({ sessionId, body: JSON.parse((init?.body as string) ?? "{}") })
          if (fail) throw new Error("network")
          return new Response("{}", { status: 200 })
        },
      }),
    })

    await q.sync("s-a", [{ type: "session", data: { id: "s-a", v: 1 } as any }])
    await q.sync("s-b", [{ type: "session", data: { id: "s-b", v: 1 } as any }])
    expect(sched.size()).toBe(2)

    await q.drain()
    await Bun.sleep(0)

    expect(sent.length).toBe(2)
    expect(sent.map((s) => s.sessionId).sort()).toEqual(["s-a", "s-b"])
    expect(sched.size()).toBe(0)

    // Failure path: drain POSTs once and does not re-enqueue for retry.
    fail = true
    clock.now = 5000
    await q.sync("s-c", [{ type: "session", data: { id: "s-c", v: 1 } as any }])
    await q.sync("s-d", [{ type: "session", data: { id: "s-d", v: 1 } as any }])
    expect(sched.size()).toBe(2)

    const before = sent.length
    await q.drain()
    await Bun.sleep(0)

    expect(sent.length).toBe(before + 2)
    expect(sched.size()).toBe(0)
  })

  test("drain does not re-enqueue on retryable HTTP status under shutdown", async () => {
    const errors: Record<string, unknown>[] = []
    const sched = scheduler(() => clock.now)

    const q = IngestQueue.create({
      now: () => clock.now,
      setTimeout: sched.setTimeout,
      clearTimeout: sched.clearTimeout,
      log: {
        error: (_message, data) => {
          errors.push(data)
        },
      },
      getShare: async () => ({ ingestPath: "/ingest" }),
      getClient: async () => ({
        url: "https://ingest.test",
        fetch: async () => new Response("", { status: 429 }),
      }),
    })

    await q.sync("s-429", [{ type: "session", data: { id: "s-429", v: 1 } as any }])
    expect(sched.size()).toBe(1)

    await q.drain()
    await Bun.sleep(0)

    // Shutdown path logs the retryable status and drops the item (no re-enqueue).
    expect(errors.some((e) => e.status === 429 && e.shutdown === true)).toBe(true)
    expect(sched.size()).toBe(0)
  })

  test("drain POSTs using cached client/share when resolution fails at teardown", async () => {
    const urls: string[] = []
    const sched = scheduler(() => clock.now)
    let live = true

    const q = IngestQueue.create({
      now: () => clock.now,
      setTimeout: sched.setTimeout,
      clearTimeout: sched.clearTimeout,
      log: { error: () => {} },
      getShare: async () => {
        if (!live) return undefined
        return { ingestPath: "/ingest" }
      },
      getClient: async () => {
        if (!live) return undefined
        return {
          url: "https://ingest.test",
          fetch: async (input) => {
            urls.push(String(input))
            return new Response("{}", { status: 200 })
          },
        }
      },
    })

    // Prime cache with a successful flush.
    await q.sync("s-cache", [{ type: "session", data: { id: "s-cache", v: 1 } as any }])
    clock.now = 1000
    sched.run()
    await Bun.sleep(0)
    expect(urls).toEqual(["https://ingest.test/ingest?v=2"])

    // Queue a new item, then break resolution so drain must use the cache.
    clock.now = 2000
    await q.sync("s-cache", [{ type: "session", data: { id: "s-cache", v: 2 } as any }])
    live = false

    await q.drain()
    await Bun.sleep(0)

    expect(urls.length).toBe(2)
    expect(urls[1]).toBe("https://ingest.test/ingest?v=2")
    expect(sched.size()).toBe(0)
  })

  test("drain waits for in-flight flush when queue map is empty", async () => {
    const sched = scheduler(() => clock.now)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let started = false
    let finished = false

    const q = IngestQueue.create({
      now: () => clock.now,
      setTimeout: sched.setTimeout,
      clearTimeout: sched.clearTimeout,
      log: { error: () => {} },
      getShare: async () => ({ ingestPath: "/ingest" }),
      getClient: async () => ({
        url: "https://ingest.test",
        fetch: async () => {
          started = true
          await gate
          finished = true
          return new Response("{}", { status: 200 })
        },
      }),
    })

    await q.sync("s-inflight", [{ type: "session", data: { id: "s-inflight" } as any }])
    clock.now = 1000
    sched.run()
    await Bun.sleep(0)
    expect(started).toBe(true)
    expect(finished).toBe(false)
    expect(sched.size()).toBe(0)

    const drained = q.drain()
    let drainDone = false
    void drained.then(() => {
      drainDone = true
    })

    await Bun.sleep(0)
    expect(drainDone).toBe(false)
    expect(finished).toBe(false)

    release()
    await drained
    await Bun.sleep(0)

    expect(finished).toBe(true)
    expect(drainDone).toBe(true)
  })

  test("drain suppresses re-enqueue when joined in-flight flush fails retryably", async () => {
    const sched = scheduler(() => clock.now)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let started = false

    const q = IngestQueue.create({
      now: () => clock.now,
      setTimeout: sched.setTimeout,
      clearTimeout: sched.clearTimeout,
      log: { error: () => {} },
      getShare: async () => ({ ingestPath: "/ingest" }),
      getClient: async () => ({
        url: "https://ingest.test",
        fetch: async () => {
          started = true
          await gate
          throw new Error("network")
        },
      }),
    })

    await q.sync("s-join-fail", [{ type: "session", data: { id: "s-join-fail" } as any }])
    clock.now = 1000
    sched.run()
    await Bun.sleep(0)
    expect(started).toBe(true)
    expect(sched.size()).toBe(0)

    const drained = q.drain()
    await Bun.sleep(0)

    release()
    await drained
    await Bun.sleep(0)

    // Shutdown suppresses re-enqueue; queue and timers must be empty.
    expect(sched.size()).toBe(0)
  })

  test("drain resolves when the bound expires on a never-settling flush", async () => {
    const errors: { message: string; data: Record<string, unknown> }[] = []
    const sched = scheduler(() => clock.now)
    let started = false

    const q = IngestQueue.create({
      now: () => clock.now,
      setTimeout: sched.setTimeout,
      clearTimeout: sched.clearTimeout,
      log: {
        error: (message, data) => {
          errors.push({ message, data })
        },
      },
      getShare: async () => ({ ingestPath: "/ingest" }),
      getClient: async () => ({
        url: "https://ingest.test",
        fetch: async () => {
          started = true
          // Never settles — drain must exit via its bound timeout, not the fetch.
          return new Promise<Response>(() => {})
        },
      }),
    })

    await q.sync("s-bound", [{ type: "session", data: { id: "s-bound" } as any }])
    expect(sched.size()).toBe(1)

    const drained = q.drain()
    let drainDone = false
    void drained.then(() => {
      drainDone = true
    })

    // Drain flushes immediately; fetch hangs and schedules the bound timer.
    await Bun.sleep(0)
    expect(started).toBe(true)
    expect(drainDone).toBe(false)
    expect(sched.size()).toBe(1)
    expect(sched.nextAt()).toBe(3000)

    // Advance past the 3s bound and fire the drain's internal timeout.
    clock.now = 3000
    sched.run()
    await drained
    await Bun.sleep(0)

    expect(drainDone).toBe(true)
    expect(errors.some((e) => e.message === "ingest drain timed out")).toBe(true)
    // Bound expiry must not re-enqueue or leave a retry timer.
    expect(sched.size()).toBe(0)
  })

  test("session_close into open debounce window reschedules flush earlier", async () => {
    const sent: unknown[] = []
    const sched = scheduler(() => clock.now)

    const q = IngestQueue.create({
      now: () => clock.now,
      setTimeout: sched.setTimeout,
      clearTimeout: sched.clearTimeout,
      log: { error: () => {} },
      getShare: async () => ({ ingestPath: "/ingest" }),
      getClient: async () => ({
        url: "https://ingest.test",
        fetch: async (_input, init) => {
          sent.push(JSON.parse((init?.body as string) ?? "{}"))
          return new Response("{}", { status: 200 })
        },
      }),
    })

    // Open a normal ~1s debounce window with a part.
    await q.sync("s-term", [{ type: "part", data: { id: "p1" } as any }])
    expect(sched.nextAt()).toBe(1000)

    // session_close must pull the flush forward to now (0 wait).
    clock.now = 200
    await q.sync("s-term", [{ type: "session_close", data: { reason: "completed" } }])
    expect(sched.nextAt()).toBe(200)

    sched.run()
    await Bun.sleep(0)
    expect(sent.length).toBe(1)
    const payload = sent[0] as { data: { type: string }[] }
    expect(payload.data.map((d) => d.type).sort()).toEqual(["part", "session_close"])
  })

  test("part/message-only batch still schedules at now + 1000", async () => {
    const sched = scheduler(() => clock.now)

    const q = IngestQueue.create({
      now: () => clock.now,
      setTimeout: sched.setTimeout,
      clearTimeout: sched.clearTimeout,
      log: { error: () => {} },
      getShare: async () => ({ ingestPath: "/ingest" }),
      getClient: async () => ({
        url: "https://ingest.test",
        fetch: async () => new Response("{}", { status: 200 }),
      }),
    })

    clock.now = 500
    await q.sync("s-coalesce", [{ type: "part", data: { id: "p1" } as any }])
    expect(sched.nextAt()).toBe(1500)

    clock.now = 800
    await q.sync("s-coalesce", [{ type: "message", data: { id: "m1" } as any }])
    // Later non-terminal sync must not move the flush earlier.
    expect(sched.nextAt()).toBe(1500)
  })

  test("terminal batch respects active retry backoff", async () => {
    const sent: unknown[] = []
    const sched = scheduler(() => clock.now)
    let attempt = 0

    const q = IngestQueue.create({
      now: () => clock.now,
      setTimeout: sched.setTimeout,
      clearTimeout: sched.clearTimeout,
      log: { error: () => {} },
      getShare: async () => ({ ingestPath: "/ingest" }),
      getClient: async () => ({
        url: "https://ingest.test",
        fetch: async (_input, init) => {
          attempt += 1
          if (attempt === 1) throw new Error("network")
          sent.push(JSON.parse((init?.body as string) ?? "{}"))
          return new Response("{}", { status: 200 })
        },
      }),
    })

    await q.sync("s-backoff", [{ type: "session", data: { id: "s-backoff", v: 1 } as any }])
    clock.now = 1000
    sched.run()
    await Bun.sleep(0)
    // Network fail → backoff 1000ms → due at 2000.
    expect(sched.nextAt()).toBe(2000)

    clock.now = 1200
    await q.sync("s-backoff", [{ type: "session_close", data: { reason: "completed" } }])
    // Terminal must still respect retry.until (2000), not fire at now (1200).
    expect(sched.nextAt()).toBe(2000)

    clock.now = 2000
    sched.run()
    await Bun.sleep(0)
    expect(sent.length).toBe(1)
    const payload = sent[0] as { data: { type: string }[] }
    expect(payload.data.map((d) => d.type).sort()).toEqual(["session", "session_close"])
  })
})
