// kilocode_change - new file
//
// Unit tests for KiloSnapshotTrack.wrap — the slow-repo guard that sits
// on top of Snapshot.track(). These tests inject fake hooks so we don't
// touch the real Question module or write to the filesystem.

import { describe, expect, test } from "bun:test"
import { Duration, Effect } from "effect"
import type { MessageID, SessionID, PartID } from "../../src/session/schema"
import { KiloSnapshotTrack } from "../../src/kilocode/snapshot/track"

const SESSION = "ses_test" as SessionID
const MESSAGE = "msg_test" as MessageID

// Build a fast inner snapshot that resolves immediately with a hash.
const fastInner = (hash = "deadbeef") => Effect.succeed<string | undefined>(hash)

// Build a slow inner snapshot that resolves after `ms` milliseconds.
const slowInner = (ms: number, hash = "slowhash") =>
  Effect.promise(() => new Promise<string | undefined>((resolve) => setTimeout(() => resolve(hash), ms)))

// Build an inner snapshot that never completes unless interrupted.
const hangInner = () => Effect.promise(() => new Promise<string | undefined>(() => {}))

// Build an inner snapshot that fails with a typed Effect error. The double
// cast mirrors how the real `Snapshot.track` Effect is shaped: callers see
// `Effect.Effect<string | undefined>` (error channel `never`), but failures
// can still flow through because the production code path uses `Effect.catch`
// to absorb them. Centralizing the cast here keeps per-test code readable.
const failingInner = (err: Error) =>
  Effect.fail(err as unknown as never) as unknown as Effect.Effect<string | undefined>

type Event = { kind: "start"; text: string } | { kind: "update"; text: string } | { kind: "end" }

interface Calls {
  ask: number
  persist: number
  progress: Event[]
}

const makeHooks = (
  answer: KiloSnapshotTrack.Answer | Promise<KiloSnapshotTrack.Answer>,
): { hooks: KiloSnapshotTrack.Hooks; calls: Calls } => {
  const calls: Calls = { ask: 0, persist: 0, progress: [] }
  let counter = 0
  const hooks: KiloSnapshotTrack.Hooks = {
    async ask() {
      calls.ask += 1
      return answer
    },
    async persistDisable() {
      calls.persist += 1
    },
    async startProgress(input) {
      calls.progress.push({ kind: "start", text: input.text })
      counter += 1
      return {
        sessionID: input.sessionID,
        messageID: input.messageID,
        partID: `prt_${counter}` as PartID,
      }
    },
    async updateProgress(input) {
      calls.progress.push({ kind: "update", text: input.text })
    },
    async endProgress() {
      calls.progress.push({ kind: "end" })
    },
  }
  return { hooks, calls }
}

describe("KiloSnapshotTrack.wrap", () => {
  test("returns the hash when inner resolves before the timeout", async () => {
    const state = KiloSnapshotTrack.makeState()
    const { hooks, calls } = makeHooks("continue")

    const result = await Effect.runPromise(
      KiloSnapshotTrack.wrap({
        inner: fastInner("fast-hash"),
        state,
        sessionID: SESSION,
        messageID: MESSAGE,
        hooks,
        timeoutMs: 1000,
      }),
    )

    expect(result).toBe("fast-hash")
    expect(calls.ask).toBe(0)
    expect(calls.persist).toBe(0)
    expect(state.disabledForSession).toBe(false)
    expect(state.asked).toBe(false)
  })

  test("returns undefined immediately when already disabled", async () => {
    const state = KiloSnapshotTrack.makeState()
    state.disabledForSession = true
    const { hooks, calls } = makeHooks("continue")

    // We pass a hang inner to prove it's never started — if the guard
    // didn't short-circuit, this test would time out.
    const result = await Effect.runPromise(
      KiloSnapshotTrack.wrap({
        inner: hangInner(),
        state,
        sessionID: SESSION,
        messageID: MESSAGE,
        hooks,
        timeoutMs: 5,
      }),
    )

    expect(result).toBeUndefined()
    expect(calls.ask).toBe(0)
  })

  test('timeout + user answer "continue" joins the fiber and returns its value', async () => {
    const state = KiloSnapshotTrack.makeState()
    const { hooks, calls } = makeHooks("continue")

    const result = await Effect.runPromise(
      KiloSnapshotTrack.wrap({
        inner: slowInner(80, "finished-late"),
        state,
        sessionID: SESSION,
        messageID: MESSAGE,
        hooks,
        timeoutMs: 20,
        progressDelayMs: 5,
      }),
    )

    expect(result).toBe("finished-late")
    expect(calls.ask).toBe(1)
    expect(calls.persist).toBe(0)
    // After a successful "continue" the guard resets `asked` so a subsequent
    // slow turn still gets the dialog instead of being silently disabled.
    expect(state.asked).toBe(false)
    expect(state.disabledForSession).toBe(false)
  })

  test('timeout + "disable" interrupts, persists, and flips disabledForSession', async () => {
    const state = KiloSnapshotTrack.makeState()
    const { hooks, calls } = makeHooks("disable")

    const result = await Effect.runPromise(
      KiloSnapshotTrack.wrap({
        inner: hangInner(),
        state,
        sessionID: SESSION,
        messageID: MESSAGE,
        hooks,
        timeoutMs: 10,
        progressDelayMs: 2,
      }),
    )

    expect(result).toBeUndefined()
    expect(calls.ask).toBe(1)
    expect(calls.persist).toBe(1)
    expect(state.disabledForSession).toBe(true)
    expect(state.asked).toBe(true)
  })

  test('timeout + "dismissed" interrupts and disables, but does NOT persist', async () => {
    const state = KiloSnapshotTrack.makeState()
    const { hooks, calls } = makeHooks("dismissed")

    const result = await Effect.runPromise(
      KiloSnapshotTrack.wrap({
        inner: hangInner(),
        state,
        sessionID: SESSION,
        messageID: MESSAGE,
        hooks,
        timeoutMs: 10,
        progressDelayMs: 2,
      }),
    )

    expect(result).toBeUndefined()
    expect(calls.ask).toBe(1)
    expect(calls.persist).toBe(0)
    expect(state.disabledForSession).toBe(true)
    expect(state.asked).toBe(true)
  })

  test("timeout without sessionID skips the prompt and disables silently", async () => {
    const state = KiloSnapshotTrack.makeState()
    const { hooks, calls } = makeHooks("continue")

    const result = await Effect.runPromise(
      KiloSnapshotTrack.wrap({
        inner: hangInner(),
        state,
        hooks,
        timeoutMs: 10,
        progressDelayMs: 2,
      }),
    )

    expect(result).toBeUndefined()
    expect(calls.ask).toBe(0)
    expect(calls.persist).toBe(0)
    expect(state.disabledForSession).toBe(true)
    expect(state.asked).toBe(false)
    // No messageID either → progress indicator is suppressed entirely.
    expect(calls.progress).toEqual([])
  })

  test("subsequent call after disable returns undefined without starting the inner", async () => {
    const state = KiloSnapshotTrack.makeState()
    const { hooks: firstHooks } = makeHooks("disable")

    await Effect.runPromise(
      KiloSnapshotTrack.wrap({
        inner: hangInner(),
        state,
        sessionID: SESSION,
        messageID: MESSAGE,
        hooks: firstHooks,
        timeoutMs: 10,
        progressDelayMs: 2,
      }),
    )
    expect(state.disabledForSession).toBe(true)

    let innerStarted = false
    const spyingInner = Effect.sync(() => {
      innerStarted = true
      return "should-not-run" as string | undefined
    })
    const { hooks: secondHooks, calls: secondCalls } = makeHooks("continue")

    const secondResult = await Effect.runPromise(
      KiloSnapshotTrack.wrap({
        inner: spyingInner,
        state,
        sessionID: SESSION,
        messageID: MESSAGE,
        hooks: secondHooks,
        timeoutMs: 10,
      }),
    )

    expect(secondResult).toBeUndefined()
    expect(innerStarted).toBe(false)
    expect(secondCalls.ask).toBe(0)
  })

  test("second slow call after a successful continue re-asks instead of silently disabling", async () => {
    const state = KiloSnapshotTrack.makeState()
    const { hooks, calls } = makeHooks("continue")

    // First call: slow → ask → continue → finishes
    const first = await Effect.runPromise(
      KiloSnapshotTrack.wrap({
        inner: slowInner(80, "hash-1"),
        state,
        sessionID: SESSION,
        messageID: MESSAGE,
        hooks,
        timeoutMs: 20,
        progressDelayMs: 5,
      }),
    )
    expect(first).toBe("hash-1")
    expect(calls.ask).toBe(1)
    // Reset semantics: successful continue clears `asked` so a future slow
    // turn gets the dialog again instead of being silently disabled.
    expect(state.asked).toBe(false)
    expect(state.disabledForSession).toBe(false)

    // Second call: still slow → dialog again → user picks continue again → finishes
    const second = await Effect.runPromise(
      KiloSnapshotTrack.wrap({
        inner: slowInner(80, "hash-2"),
        state,
        sessionID: SESSION,
        messageID: MESSAGE,
        hooks,
        timeoutMs: 20,
        progressDelayMs: 5,
      }),
    )
    expect(second).toBe("hash-2")
    expect(calls.ask).toBe(2) // re-asked
    expect(state.disabledForSession).toBe(false)
  })

  test("continue path keeps `asked` sticky when the fiber finished with no hash", async () => {
    const state = KiloSnapshotTrack.makeState()
    const { hooks, calls } = makeHooks("continue")

    // Simulate the fiber eventually completing but with no hash (e.g.
    // snapshot disabled mid-flight or non-git repo). The continue path waits
    // for it, so we get undefined back — and we must not reset `asked`,
    // otherwise repeated failures would keep re-prompting the user every
    // turn.
    const noHashInner = Effect.promise(
      () => new Promise<string | undefined>((resolve) => setTimeout(() => resolve(undefined), 80)),
    )
    const first = await Effect.runPromise(
      KiloSnapshotTrack.wrap({
        inner: noHashInner,
        state,
        sessionID: SESSION,
        messageID: MESSAGE,
        hooks,
        timeoutMs: 20,
        progressDelayMs: 5,
      }),
    )
    expect(first).toBeUndefined()
    expect(calls.ask).toBe(1)
    expect(state.asked).toBe(true)
  })

  test("inner typed failure is caught and returned as undefined", async () => {
    const state = KiloSnapshotTrack.makeState()
    const { hooks, calls } = makeHooks("continue")

    // Typed failure — mirrors how the real inner `track()` fails, which is
    // what Effect.catch inside wrap() is designed to handle. Untyped defects
    // (e.g. rejected Promises without Effect.tryPromise) are NOT caught; they
    // propagate and surface as test failures.
    const result = await Effect.runPromise(
      KiloSnapshotTrack.wrap({
        inner: failingInner(new Error("boom")),
        state,
        sessionID: SESSION,
        messageID: MESSAGE,
        hooks,
        timeoutMs: 100,
      }),
    )

    expect(result).toBeUndefined()
    expect(calls.ask).toBe(0)
    expect(state.disabledForSession).toBe(false)
  })
})

describe("KiloSnapshotTrack progress indicator", () => {
  // Strip the braille spinner frame (first Unicode codepoint, plus the
  // trailing space) so tests can assert on the stable descriptive text
  // without caring which animation frame landed.
  const withoutFrame = (text: string) => text.replace(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s/, "")

  test("fast path does NOT publish a progress message (avoids UI flash)", async () => {
    const state = KiloSnapshotTrack.makeState()
    const { hooks, calls } = makeHooks("continue")

    await Effect.runPromise(
      KiloSnapshotTrack.wrap({
        inner: fastInner("hash"),
        state,
        sessionID: SESSION,
        messageID: MESSAGE,
        hooks,
        timeoutMs: 1000,
      }),
    )

    // The 500ms default delay means fast snapshots never emit a start.
    expect(calls.progress).toEqual([])
  })

  test("slow-but-succeeding path (under timeout) starts then ends the indicator", async () => {
    const state = KiloSnapshotTrack.makeState()
    const { hooks, calls } = makeHooks("continue")

    await Effect.runPromise(
      KiloSnapshotTrack.wrap({
        inner: slowInner(200, "late-hash"),
        state,
        sessionID: SESSION,
        messageID: MESSAGE,
        hooks,
        timeoutMs: 5_000,
        progressDelayMs: 5,
      }),
    )

    const events = calls.progress
    expect(events.at(0)?.kind).toBe("start")
    expect(events.at(-1)?.kind).toBe("end")

    const firstText = events.at(0) as Extract<(typeof events)[number], { text: string }>
    expect(withoutFrame(firstText.text)).toBe(
      KiloSnapshotTrack.formatProgress(KiloSnapshotTrack.PROGRESS_INITIALIZING, "").trim(),
    )

    // Every "update" event is just an animation tick of the same label — we
    // intentionally do NOT escalate the text after the timeout; the dialog
    // carries the "why", and the in-chat indicator stays short and stable.
    for (const evt of events) {
      if (evt.kind !== "update") continue
      expect(withoutFrame(evt.text)).toBe(
        KiloSnapshotTrack.formatProgress(KiloSnapshotTrack.PROGRESS_INITIALIZING, "").trim(),
      )
    }
  })

  test("timed-out path keeps the initializing label (no text escalation)", async () => {
    const state = KiloSnapshotTrack.makeState()
    const { hooks, calls } = makeHooks("continue")

    await Effect.runPromise(
      KiloSnapshotTrack.wrap({
        inner: slowInner(800, "late-hash"),
        state,
        sessionID: SESSION,
        messageID: MESSAGE,
        hooks,
        timeoutMs: 200,
        progressDelayMs: 5,
      }),
    )

    const events = calls.progress
    expect(events.at(0)?.kind).toBe("start")
    expect(events.at(-1)?.kind).toBe("end")

    // After the timeout trips, the label should stay on PROGRESS_INITIALIZING.
    // Every emitted event carries the same descriptive text modulo spinner
    // frame, proving we never escalated to a second template.
    const base = KiloSnapshotTrack.formatProgress(KiloSnapshotTrack.PROGRESS_INITIALIZING, "").trim()
    for (const evt of events) {
      if (!("text" in evt)) continue
      expect(withoutFrame(evt.text)).toBe(base)
    }
  })

  test("disable path removes the indicator before returning", async () => {
    const state = KiloSnapshotTrack.makeState()
    const { hooks, calls } = makeHooks("disable")

    await Effect.runPromise(
      KiloSnapshotTrack.wrap({
        inner: hangInner(),
        state,
        sessionID: SESSION,
        messageID: MESSAGE,
        hooks,
        timeoutMs: 200,
        progressDelayMs: 5,
      }),
    )

    expect(calls.progress.at(-1)).toEqual({ kind: "end" })
  })

  test("missing messageID suppresses the indicator even when slow", async () => {
    const state = KiloSnapshotTrack.makeState()
    const { hooks, calls } = makeHooks("continue")

    await Effect.runPromise(
      KiloSnapshotTrack.wrap({
        inner: slowInner(150, "hash"),
        state,
        sessionID: SESSION,
        hooks,
        timeoutMs: 5_000,
        progressDelayMs: 5,
      }),
    )

    // No messageID → skip the progress indicator entirely.
    expect(calls.progress).toEqual([])
  })

  test("frames cycle through the braille spinner set while animating", async () => {
    const state = KiloSnapshotTrack.makeState()
    const { hooks, calls } = makeHooks("continue")

    // Run long enough to get multiple animation ticks.
    await Effect.runPromise(
      KiloSnapshotTrack.wrap({
        inner: slowInner(500, "hash"),
        state,
        sessionID: SESSION,
        messageID: MESSAGE,
        hooks,
        timeoutMs: 5_000,
        progressDelayMs: 5,
      }),
    )

    const textEvents = calls.progress.filter(
      (e): e is Extract<(typeof calls.progress)[number], { text: string }> => "text" in e,
    )
    const frames = new Set<string>()
    for (const evt of textEvents) {
      const m = evt.text.match(/^([⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏])/)
      if (m) frames.add(m[1])
    }
    // At least two different frames should have been rendered during the run.
    expect(frames.size).toBeGreaterThanOrEqual(2)
  })
})

describe("KiloSnapshotTrack constants", () => {
  test("TIMEOUT_MS defaults to 10s and respects env override", () => {
    // The constant is evaluated once at module load, so we can only assert
    // on the default in this run. The env override is exercised by running
    // with KILO_SNAPSHOT_TRACK_TIMEOUT_MS, which this test suite does not set.
    expect(KiloSnapshotTrack.TIMEOUT_MS).toBe(10_000)
  })

  test("exposes stable answer labels", () => {
    expect(KiloSnapshotTrack.ANSWER_CONTINUE).toBe("Continue with snapshots")
    expect(KiloSnapshotTrack.ANSWER_DISABLE).toBe("Disable for this project")
  })
})

// Small guard: if Duration is ever swapped out for an incompatible version,
// this will catch it at compile time.
void Duration.millis
