import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { SessionID } from "../../src/session/schema"
import { KiloSessionSteeringInbox } from "../../src/kilocode/session/steering-inbox"
import { SteeringNotice } from "../../src/kilocode/session/steering-notice"
import { KiloSession } from "../../src/kilocode/session"
import { KiloSessionPromptQueue } from "../../src/kilocode/session/prompt-queue"
import { KiloSessionSteering } from "../../src/kilocode/session/steering"

afterEach(() => {
  KiloSessionSteeringInbox._reset()
})

const id = (value: string) => SessionID.make(value)
const origin = id("ses_steering_origin")
const child = id("ses_steering_child")
const other = id("ses_steering_other")
const messageID = (value: string) => value as never

describe("steering inbox", () => {
  test("assigns one monotonic revision per user message and targets each active child", () => {
    const first = KiloSessionSteeringInbox.post({
      origin,
      messageID: messageID("msg_1"),
      text: "Email only",
      targets: [child, other],
    })
    const second = KiloSessionSteeringInbox.post({
      origin,
      messageID: messageID("msg_2"),
      text: "Drop Google",
      targets: [child],
    })
    expect(first?.revision).toBe(1)
    expect(second?.revision).toBe(2)
    expect(KiloSessionSteeringInbox.pending(child)?.text).toBe("Drop Google")
    // A target always sees the newest direction it has not consumed yet.
    expect(KiloSessionSteeringInbox.pending(other)?.text).toBe("Drop Google")
    expect(KiloSessionSteeringInbox.snapshot(origin)).toMatchObject({
      sessionID: origin,
      messageID: "msg_2",
      revision: 2,
      targets: [
        { sessionID: child, state: "pending" },
        { sessionID: other, state: "pending" },
      ],
    })
  })

  test("posts nothing when no target is active", () => {
    expect(
      KiloSessionSteeringInbox.post({ origin, messageID: messageID("msg"), text: "x", targets: [] }),
    ).toBeUndefined()
    expect(KiloSessionSteeringInbox.snapshot(origin)).toBeUndefined()
  })

  test("ack is idempotent, monotonic, and clears state once every target is caught up", () => {
    KiloSessionSteeringInbox.post({
      origin,
      messageID: messageID("msg"),
      text: "Email only",
      targets: [child, other],
    })
    KiloSessionSteeringInbox.ack(child, 1)
    expect(KiloSessionSteeringInbox.pending(child)).toBeUndefined()
    expect(KiloSessionSteeringInbox.snapshot(origin)?.targets).toEqual([
      { sessionID: child, state: "delivered" },
      { sessionID: other, state: "pending" },
    ])
    expect(KiloSessionSteeringInbox.snapshot(origin)?.targets).toEqual([
      { sessionID: child, state: "delivered" },
      { sessionID: other, state: "pending" },
    ])
    KiloSessionSteeringInbox.ack(other, 1)
    // History is released once every target caught up, but targets stay known so a
    // later update still fans out to the same children.
    expect(KiloSessionSteeringInbox.pending(child)).toBeUndefined()
    expect(KiloSessionSteeringInbox.pending(other)).toBeUndefined()

    KiloSessionSteeringInbox.post({ origin, messageID: messageID("msg"), text: "Again", targets: [child] })
    KiloSessionSteeringInbox.ack(child, 5)
    expect(KiloSessionSteeringInbox.acked(child)).toBe(5)
    KiloSessionSteeringInbox.ack(child, 2)
    expect(KiloSessionSteeringInbox.acked(child)).toBe(5)
  })

  test("reports a child that finished without acking as stale", () => {
    KiloSessionSteeringInbox.post({ origin, messageID: messageID("msg"), text: "Email only", targets: [child] })
    expect(KiloSessionSteeringInbox.stale(child)).toBe(true)
    KiloSessionSteeringInbox.ack(child, 1)
    expect(KiloSessionSteeringInbox.stale(child)).toBe(false)
  })

  test("clear drops pending direction for a cancelled target only", () => {
    KiloSessionSteeringInbox.post({ origin, messageID: messageID("msg"), text: "a", targets: [child] })
    KiloSessionSteeringInbox.post({
      origin: id("ses_other_origin"),
      messageID: messageID("msg"),
      text: "b",
      targets: [other],
    })
    KiloSessionSteeringInbox.clear(child)
    expect(KiloSessionSteeringInbox.pending(child)).toBeUndefined()
    expect(KiloSessionSteeringInbox.pending(other)?.text).toBe("b")
  })
})

describe("steering fan-out", () => {
  test("only real user text fans out", () => {
    expect(KiloSessionSteering.user([{ type: "text", text: "Remove Google login" }])).toBe(true)
    expect(KiloSessionSteering.user([{ type: "text", text: "marker", synthetic: true }])).toBe(false)
    expect(KiloSessionSteering.user([{ type: "text", text: "background result", metadata: { background: true } }])).toBe(
      false,
    )
    expect(KiloSessionSteering.user([{ type: "text", text: "   " }])).toBe(false)
    expect(KiloSessionSteering.user([{ type: "file" }])).toBe(false)
  })

  test("is opt-in per config or runtime flag", () => {
    const flags = { experimentalSubagentSteering: false }
    expect(KiloSessionSteering.enabled({ config: {}, flags })).toBe(false)
    expect(KiloSessionSteering.enabled({ config: { experimental: { subagent_steering: true } }, flags })).toBe(true)
    expect(KiloSessionSteering.enabled({ config: {}, flags: { experimentalSubagentSteering: true } })).toBe(true)
  })
})

describe("child index", () => {
  afterEach(() => {
    for (const value of [origin, child, other, id("ses_grandchild")]) KiloSession.clearPlatformOverride(value)
  })

  test("lists nested descendants so a swarm receives steering too", () => {
    const grandchild = id("ses_grandchild")
    KiloSession.register({ id: origin })
    KiloSession.register({ id: child, parentID: origin })
    KiloSession.register({ id: other, parentID: origin })
    KiloSession.register({ id: grandchild, parentID: child })
    expect(KiloSession.descendants(origin)).toEqual([child, grandchild, other])
    expect(KiloSession.descendants(grandchild)).toEqual([])
    KiloSession.clearPlatformOverride(child)
    expect(KiloSession.descendants(origin)).toEqual([other])
  })
})

describe("steering notice", () => {
  const entry = { revision: 2, text: "Remove Google login. Email only." }

  test("renders the user's own wording with provenance", () => {
    const rendered = SteeringNotice.output("Tool output", { [SteeringNotice.key]: entry })
    expect(rendered.startsWith("Tool output\n\n<subagent-steering>")).toBe(true)
    expect(rendered).toContain("This is a change from the user, not a peer or parent message.")
    expect(rendered).toContain("If it does not affect your task, continue as before.")
    expect(rendered).toContain(entry.text)
  })

  test("ignores malformed or foreign metadata", () => {
    expect(SteeringNotice.output("Tool output", undefined)).toBe("Tool output")
    expect(SteeringNotice.output("Tool output", { [SteeringNotice.key]: { revision: 0, text: "x" } })).toBe(
      "Tool output",
    )
    expect(SteeringNotice.output("Tool output", { [SteeringNotice.key]: { revision: 1, text: "" } })).toBe(
      "Tool output",
    )
    expect(SteeringNotice.output("Tool output", { other: 1 })).toBe("Tool output")
  })

  test("cleans the marker without touching other metadata", () => {
    const marker: Record<string, unknown> = { original: true, [SteeringNotice.key]: entry }
    const cleaned = SteeringNotice.clean({ metadata: marker })
    expect(cleaned.metadata).toEqual({ original: true })
  })
})

describe("steering notifier", () => {
  const output = { title: "Read", output: "Original", metadata: { original: true } }

  test("attaches one pending revision to the next tool result and acks it", () => {
    KiloSessionSteeringInbox.post({ origin, messageID: messageID("msg"), text: "Email only", targets: [child] })
    return Effect.runPromise(
      Effect.gen(function* () {
        const notify = yield* KiloSessionSteering.notifier({ sessionID: child, enabled: true })
        const result = yield* notify("read", output)
        expect(result.metadata).toMatchObject({
          original: true,
          [SteeringNotice.key]: { revision: 1, text: "Email only" },
        })
        expect(result.output).toBe("Original")
        expect(KiloSessionSteeringInbox.pending(child)).toBeUndefined()
        const next = yield* notify("read", output)
        expect(next).toEqual(output)
      }),
    )
  })

  test("never consumes direction on an aborted call", () => {
    KiloSessionSteeringInbox.post({ origin, messageID: messageID("msg"), text: "Email only", targets: [child] })
    const controller = new AbortController()
    controller.abort()
    return Effect.runPromise(
      Effect.gen(function* () {
        const notify = yield* KiloSessionSteering.notifier({ sessionID: child, enabled: true })
        expect(yield* notify("read", output, controller.signal)).toEqual(output)
        expect(KiloSessionSteeringInbox.pending(child)?.text).toBe("Email only")
      }),
    )
  })

  test("keeps board notices and steering on the same result", () => {
    KiloSessionSteeringInbox.post({ origin, messageID: messageID("msg"), text: "Email only", targets: [child] })
    return Effect.runPromise(
      Effect.gen(function* () {
        const notify = yield* KiloSessionSteering.notifier({
          sessionID: child,
          enabled: true,
          board: (_tool, value) =>
            Effect.succeed({ ...value, metadata: { ...value.metadata, board_notice: 3 } }),
        })
        const result = yield* notify("read", output)
        expect(result.metadata).toMatchObject({ board_notice: 3, [SteeringNotice.key]: { revision: 1 } })
      }),
    )
  })

  test("stays dormant when disabled", () => {
    KiloSessionSteeringInbox.post({ origin, messageID: messageID("msg"), text: "Email only", targets: [child] })
    return Effect.runPromise(
      Effect.gen(function* () {
        const notify = yield* KiloSessionSteering.notifier({ sessionID: child, enabled: false })
        expect(yield* notify("read", output)).toEqual(output)
        expect(KiloSessionSteeringInbox.pending(child)?.text).toBe("Email only")
      }),
    )
  })
})

describe("queue cancel", () => {
  test("drops pending steering so a stopped session receives nothing", () => {
    KiloSessionSteeringInbox.post({ origin, messageID: messageID("msg"), text: "Email only", targets: [child] })
    KiloSessionSteeringInbox.post({ origin: child, messageID: messageID("msg"), text: "nested", targets: [other] })
    return Effect.runPromise(KiloSessionPromptQueue.cancel(child)).then(() => {
      expect(KiloSessionSteeringInbox.pending(child)).toBeUndefined()
      expect(KiloSessionSteeringInbox.pending(other)).toBeUndefined()
    })
  })
})
