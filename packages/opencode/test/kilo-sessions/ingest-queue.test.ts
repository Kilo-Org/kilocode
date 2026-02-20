import { describe, expect, test, beforeEach } from "bun:test"
import { IngestQueue } from "../../src/kilo-sessions/ingest-queue"

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

  test("flush sends request with ?v=1 query parameter", async () => {
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
    expect(urls[0]).toBe("https://ingest.test/ingest?v=1")
  })
})
