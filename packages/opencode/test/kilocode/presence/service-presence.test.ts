import { describe, expect, mock, setSystemTime, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Auth } from "@/auth"

// Each KiloViewers.layer construction reads these env vars (post-refactor), so
// setting them here controls presence wiring per test.
process.env.KILO_EVENT_SERVICE_URL = "wss://test-presence"
process.env.KILO_PLATFORM = "cli"

const attachedCalls: string[][] = []

type Call = { type: "subscribe" | "unsubscribe" | "connect" | "disconnect"; contexts: string[] }

// Ordering log shared across FakeClient instances, so ordering can be asserted
// across a disconnect on one client and a connect on its replacement.
const sequence: string[] = []
let clientSeq = 0

class FakeClient {
  calls: Call[] = []
  id = ++clientSeq
  constructor() {}
  async connect(): Promise<void> {
    this.calls.push({ type: "connect", contexts: [] })
    sequence.push(`connect:${this.id}`)
  }
  disconnect(): void {
    this.calls.push({ type: "disconnect", contexts: [] })
    sequence.push(`disconnect:${this.id}`)
  }
  subscribe(contexts: string[]): void {
    this.calls.push({ type: "subscribe", contexts: [...contexts] })
  }
  unsubscribe(contexts: string[]): void {
    this.calls.push({ type: "unsubscribe", contexts: [...contexts] })
  }
  onReconnect(): () => void {
    return () => {}
  }
}

const realSessions = await import("@/kilo-sessions/kilo-sessions")
const realSetAttached = realSessions.KiloSessions.setAttachedSessions
mock.module("@/kilo-sessions/kilo-sessions", () => ({
  ...realSessions,
  KiloSessions: {
    ...realSessions.KiloSessions,
    setAttachedSessions: (ids: readonly string[]) => {
      attachedCalls.push([...ids])
      realSetAttached(ids)
    },
  },
}))

let current = new FakeClient()
mock.module("@/kilocode/event-service/client", () => ({
  EventServiceClient: class {
    constructor() {
      // The service constructs one client per layer; expose it for assertions.
      current = new FakeClient()
    }
    async connect() {
      await current.connect()
    }
    disconnect() {
      current.disconnect()
    }
    subscribe(c: string[]) {
      current.subscribe(c)
    }
    unsubscribe(c: string[]) {
      current.unsubscribe(c)
    }
    onReconnect() {
      return current.onReconnect()
    }
  },
}))

const { KiloViewers } = await import("@/kilocode/presence/service")

const authLayer = Layer.succeed(
  Auth.Service,
  Auth.Service.of({
    get: () => Effect.succeed({ type: "api", key: "tok" } as unknown as Auth.Info),
    all: () => Effect.succeed({} as never),
    set: () => Effect.void,
    remove: () => Effect.void,
  }),
)

const layer = KiloViewers.layer.pipe(Layer.provide(authLayer))

const uid = "11111111-1111-4111-8111-111111111111"

function run(body: (viewers: {
  update: (s: {
    viewer: { id: string; active: boolean }
    attached: readonly string[]
    visible: readonly string[]
  }) => Effect.Effect<void>
  invalidateAuth: () => Effect.Effect<void>
}) => Effect.Effect<void>, l: typeof layer = layer) {
  return Effect.gen(function* () {
    const v = yield* KiloViewers.Service
    yield* body(v)
  }).pipe(Effect.provide(l), Effect.runPromise)
}

function subscribeCalls(): string[][] {
  return current.calls.filter((c) => c.type === "subscribe").map((c) => c.contexts)
}

function unsubscribeCalls(): string[][] {
  return current.calls.filter((c) => c.type === "unsubscribe").map((c) => c.contexts)
}

describe("KiloViewers.Service presence contexts", () => {
  test("active viewer subscribes platform plus its visible session context", async () => {
    attachedCalls.length = 0
    current = new FakeClient()
    await run((v) =>
      v.update({ viewer: { id: uid, active: true }, attached: ["ses_a"], visible: ["ses_a"] }),
    )
    const subs = subscribeCalls()
    expect(subs.length).toBe(1)
    expect(subs[0]).toContain("/presence/cli")
    expect(subs[0]).toContain("/presence/cli-session/ses_a")
    expect(attachedCalls).toEqual([["ses_a"], []])
  })

  test("inactive viewer opens no presence socket but keeps attachment", async () => {
    attachedCalls.length = 0
    current = new FakeClient()
    await run((v) =>
      v.update({ viewer: { id: uid, active: false }, attached: ["ses_a"], visible: ["ses_a"] }),
    )
    expect(subscribeCalls().length).toBe(0)
    expect(current.calls.some((c) => c.type === "connect")).toBe(false)
    expect(attachedCalls).toEqual([["ses_a"], []])
  })

  test("replacing the visible set unsubscribes old contexts before subscribing new ones", async () => {
    attachedCalls.length = 0
    current = new FakeClient()
    const olds = Array.from({ length: 199 }, (_, i) => `ses_old_${i}`)
    const next = Array.from({ length: 199 }, (_, i) => `ses_new_${i}`)
    await run((v) =>
      Effect.gen(function* () {
        yield* v.update({ viewer: { id: uid, active: true }, attached: olds, visible: olds })
        yield* v.update({ viewer: { id: uid, active: true }, attached: next, visible: next })
      }),
    )
    const order = current.calls.filter((c) => c.type === "subscribe" || c.type === "unsubscribe")
    const firstUnsubIdx = order.findIndex((c) => c.type === "unsubscribe")
    const lastSubIdx = order.map((c) => c.type).lastIndexOf("subscribe")
    expect(firstUnsubIdx).toBeGreaterThan(-1)
    expect(lastSubIdx).toBeGreaterThan(firstUnsubIdx)
    const unsub = unsubscribeCalls().at(-1)!
    const sub = subscribeCalls().at(-1)!
    expect(unsub.length).toBe(199)
    expect(sub.length).toBe(199)
    expect(sub.every((c) => c.startsWith("/presence/cli-session/ses_new_"))).toBe(true)
    expect(unsub.every((c) => c.startsWith("/presence/cli-session/ses_old_"))).toBe(true)
  })

  test("kill switch blocks the presence socket but attached union still reaches KiloSessions", async () => {
    attachedCalls.length = 0
    current = new FakeClient()
    const prev = process.env.KILO_DISABLE_PRESENCE
    process.env.KILO_DISABLE_PRESENCE = "1"
    try {
      await run((v) =>
        v.update({ viewer: { id: uid, active: true }, attached: ["ses_a"], visible: ["ses_a"] }),
      )
      expect(subscribeCalls().length).toBe(0)
      expect(current.calls.some((c) => c.type === "connect")).toBe(false)
      expect(attachedCalls).toEqual([["ses_a"], []])
    } finally {
      if (prev === undefined) delete process.env.KILO_DISABLE_PRESENCE
      else process.env.KILO_DISABLE_PRESENCE = prev
    }
  })
})

const uidB = "22222222-2222-4222-8222-222222222222"

describe("KiloViewers.Service viewer lifecycle", () => {
  test("viewer expires at lastSeen + 120s", async () => {
    attachedCalls.length = 0
    current = new FakeClient()
    const base = 1_700_000_000_000
    try {
      setSystemTime(base)
      await run((v) =>
        Effect.gen(function* () {
          yield* v.update({ viewer: { id: uid, active: true }, attached: ["ses_a"], visible: ["ses_a"] })
          setSystemTime(base + 119_999)
          yield* v.update({ viewer: { id: uidB, active: true }, attached: ["ses_b"], visible: ["ses_b"] })
          setSystemTime(base + 120_000)
          yield* v.update({ viewer: { id: uidB, active: true }, attached: ["ses_b"], visible: ["ses_b"] })
        }),
      )
      expect(attachedCalls.length).toBe(4)
      // One tick before the TTL the first viewer is still present.
      expect(attachedCalls[1]).toContain("ses_a")
      expect(attachedCalls[1]).toContain("ses_b")
      // At exactly lastSeen + TTL it is pruned (boundary inclusive).
      expect(attachedCalls[2]).toEqual(["ses_b"])
      expect(attachedCalls[3]).toEqual([])
    } finally {
      setSystemTime()
    }
  })

  test("account switch disconnects the old client before connecting the new one", async () => {
    attachedCalls.length = 0
    sequence.length = 0
    current = new FakeClient()
    let authInfo = { type: "api", key: "tok1" } as unknown as Auth.Info
    const mutableAuthLayer = Layer.succeed(
      Auth.Service,
      Auth.Service.of({
        get: () => Effect.sync(() => authInfo),
        all: () => Effect.succeed({} as never),
        set: () => Effect.void,
        remove: () => Effect.void,
      }),
    )
    let first: FakeClient | undefined
    let second: FakeClient | undefined
    await run(
      (v) =>
        Effect.gen(function* () {
          yield* v.update({ viewer: { id: uid, active: true }, attached: ["ses_a"], visible: ["ses_a"] })
          first = current
          authInfo = { type: "wellknown", key: "wk", token: "tok2" } as unknown as Auth.Info
          yield* v.invalidateAuth()
          second = current
          yield* v.update({ viewer: { id: uid, active: true }, attached: ["ses_a"], visible: ["ses_a"] })
        }),
      KiloViewers.layer.pipe(Layer.provide(mutableAuthLayer)),
    )
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(second).not.toBe(first)
    const oldConnect = sequence.indexOf(`connect:${first!.id}`)
    const oldDisconnect = sequence.indexOf(`disconnect:${first!.id}`)
    const newConnect = sequence.indexOf(`connect:${second!.id}`)
    expect(oldConnect).toBeGreaterThan(-1)
    expect(oldDisconnect).toBeGreaterThan(oldConnect)
    expect(newConnect).toBeGreaterThan(oldDisconnect)
  })

  test("scope disposal runs the finalizer", async () => {
    attachedCalls.length = 0
    current = new FakeClient()
    await run((v) =>
      v.update({ viewer: { id: uid, active: true }, attached: ["ses_a"], visible: ["ses_a"] }),
    )
    const types = current.calls.map((c) => c.type)
    expect(types).toContain("connect")
    expect(types.at(-1)).toBe("disconnect")
    expect(types.indexOf("disconnect")).toBeGreaterThan(types.indexOf("connect"))
    expect(attachedCalls).toEqual([["ses_a"], []])
  })
})
