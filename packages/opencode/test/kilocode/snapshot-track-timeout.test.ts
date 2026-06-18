// kilocode_change - new file
//
// Unit tests for KiloSnapshotTrack.wrap — the slow-repo guard that sits
// on top of Snapshot.track(). These tests inject fake hooks so we don't
// touch the real Question module or write to the filesystem.

import { describe, expect, test } from "bun:test"
import { Duration, Effect } from "effect"
import type { MessageID, SessionID } from "../../src/session/schema"
import { KiloSnapshotTrack } from "../../src/kilocode/snapshot/track"
import { awaitWithTimeout } from "../lib/effect"

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

  test("disable starts snapshot cancellation before config persistence finishes", async () => {
    const state = KiloSnapshotTrack.makeState()
    const cancelled = Promise.withResolvers<void>()
    const persisting = Promise.withResolvers<void>()
    const persist = Promise.withResolvers<void>()
    const { hooks: base } = makeHooks("disable")
    const hooks: KiloSnapshotTrack.Hooks = {
      ...base,
      async persistDisable() {
        await base.persistDisable()
        persisting.resolve()
        await persist.promise
      },
    }
    const inner = Effect.never.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          cancelled.resolve()
        }),
      ),
    )

    const run = Effect.runPromise(
      KiloSnapshotTrack.wrap({
        inner,
        state,
        sessionID: SESSION,
        messageID: MESSAGE,
        hooks,
        timeoutMs: 10,
        progressDelayMs: 2,
      }),
    )

    await persisting.promise
    await Effect.runPromise(
      awaitWithTimeout(
        Effect.promise(() => cancelled.promise),
        "snapshot cancellation did not start before config persistence finished",
        Duration.millis(200),
      ),
    )
    persist.resolve()

    expect(await run).toBeUndefined()
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

  test('timeout + snapshot initialization "wait" keeps waiting without asking', async () => {
    const state = KiloSnapshotTrack.makeState()
    const { hooks, calls } = makeHooks("disable")

    const result = await Effect.runPromise(
      KiloSnapshotTrack.wrap({
        inner: slowInner(50, "managed-hash"),
        state,
        snapshotInitialization: "wait",
        sessionID: SESSION,
        messageID: MESSAGE,
        hooks,
        timeoutMs: 10,
        progressDelayMs: 2,
      }),
    )

    expect(result).toBe("managed-hash")
    expect(calls.ask).toBe(0)
    expect(calls.persist).toBe(0)
    expect(state.disabledForSession).toBe(false)
  })

  test("concurrent timeout does not override an active continue choice", async () => {
    const state = KiloSnapshotTrack.makeState()
    const answer = Promise.withResolvers<KiloSnapshotTrack.Answer>()
    const asked = Promise.withResolvers<void>()
    const { hooks, calls } = makeHooks(answer.promise)
    const firstHooks: KiloSnapshotTrack.Hooks = {
      ...hooks,
      async ask(input) {
        asked.resolve()
        return hooks.ask(input)
      },
    }

    const first = Effect.runPromise(
      KiloSnapshotTrack.wrap({
        inner: slowInner(80, "first-hash"),
        state,
        sessionID: SESSION,
        messageID: MESSAGE,
        hooks: firstHooks,
        timeoutMs: 20,
        progressDelayMs: 5,
      }),
    )
    await asked.promise
    answer.resolve("continue")

    const second = await Effect.runPromise(
      KiloSnapshotTrack.wrap({
        inner: hangInner(),
        state,
        sessionID: SESSION,
        messageID: MESSAGE,
        hooks,
        timeoutMs: 20,
        progressDelayMs: 5,
      }),
    )

    expect(second).toBeUndefined()
    expect(await first).toBe("first-hash")
    expect(calls.ask).toBe(1)
    expect(state.disabledForSession).toBe(false)
    expect(state.asked).toBe(false)
    expect(state.owner).toBeUndefined()
  })

  test("cleanup does not clear a newer prompt owner", async () => {
    const state = KiloSnapshotTrack.makeState()
    const replacement = Symbol()
    const { hooks: base } = makeHooks("continue")
    const hooks: KiloSnapshotTrack.Hooks = {
      ...base,
      async endProgress(input) {
        state.owner = replacement
        await base.endProgress(input)
      },
    }

    const result = await Effect.runPromise(
      KiloSnapshotTrack.wrap({
        inner: slowInner(80, "continued-hash"),
        state,
        sessionID: SESSION,
        messageID: MESSAGE,
        hooks,
        timeoutMs: 20,
        progressDelayMs: 2,
      }),
    )

    expect(result).toBe("continued-hash")
    expect(state.owner).toBe(replacement)
    expect(state.asked).toBe(true)
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

  test("failed progress publication does not start update retries", async () => {
    const state = KiloSnapshotTrack.makeState()
    const { hooks: base } = makeHooks("continue")
    let updates = 0
    const hooks: KiloSnapshotTrack.Hooks = {
      ...base,
      async startProgress() {
        throw new Error("session service unavailable")
      },
      async updateProgress() {
        updates += 1
      },
    }

    const result = await Effect.runPromise(
      KiloSnapshotTrack.wrap({
        inner: slowInner(300, "hash"),
        state,
        sessionID: SESSION,
        messageID: MESSAGE,
        hooks,
        timeoutMs: 1_000,
        progressDelayMs: 2,
      }),
    )

    expect(result).toBe("hash")
    expect(updates).toBe(0)
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

  test.each(["disable", "dismissed"] as const)("%s path does not wait for snapshot cleanup", async (answer) => {
    const state = KiloSnapshotTrack.makeState()
    const { hooks, calls } = makeHooks(answer)
    const cleaning = Promise.withResolvers<void>()
    const cleanup = Promise.withResolvers<void>()
    const inner = Effect.never.pipe(
      Effect.ensuring(
        Effect.promise(async () => {
          cleaning.resolve()
          await cleanup.promise
        }),
      ),
    )

    const run = Effect.runPromise(
      KiloSnapshotTrack.wrap({
        inner,
        state,
        sessionID: SESSION,
        messageID: MESSAGE,
        hooks,
        timeoutMs: 20,
        progressDelayMs: 2,
      }),
    )
    const completed = await Effect.runPromise(
      awaitWithTimeout(
        Effect.promise(() => run),
        "snapshot wrapper waited for cleanup",
      ).pipe(
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false)),
      ),
    )
    const last = calls.progress.at(-1)

    cleanup.resolve()
    await run
    await cleaning.promise

    expect(completed).toBe(true)
    expect(last).toEqual({ kind: "end" })
  })

  test("stalled progress removal does not block completion and is retried", async () => {
    const state = KiloSnapshotTrack.makeState()
    const { hooks: base, calls } = makeHooks("continue")
    const started = Promise.withResolvers<void>()
    const ended = Promise.withResolvers<void>()
    const snapshot = Promise.withResolvers<string | undefined>()
    let attempts = 0
    const hooks: KiloSnapshotTrack.Hooks = {
      ...base,
      async startProgress(input) {
        await base.startProgress(input)
        started.resolve()
      },
      async endProgress(input, signal) {
        attempts += 1
        if (attempts === 3) {
          await base.endProgress(input)
          ended.resolve()
          return
        }
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("stalled removal")), { once: true })
        })
      },
    }

    const run = Effect.runPromise(
      KiloSnapshotTrack.wrap({
        inner: Effect.promise(() => snapshot.promise),
        state,
        sessionID: SESSION,
        messageID: MESSAGE,
        hooks,
        timeoutMs: 1_000,
        progressDelayMs: 2,
        progressCleanupTimeoutMs: 5,
      }),
    )

    await started.promise
    snapshot.resolve("hash")
    const result = await Effect.runPromise(
      awaitWithTimeout(
        Effect.promise(() => run),
        "snapshot wrapper waited for progress removal",
      ),
    )
    await Effect.runPromise(
      awaitWithTimeout(
        Effect.promise(() => ended.promise),
        "snapshot progress removal was not retried",
      ),
    )

    expect(result).toBe("hash")
    expect(attempts).toBe(3)
    expect(calls.progress.at(-1)).toEqual({ kind: "end" })
  })

  test("pending progress publication is removed after the snapshot finishes", async () => {
    const state = KiloSnapshotTrack.makeState()
    const { hooks: base, calls } = makeHooks("continue")
    const started = Promise.withResolvers<void>()
    const publish = Promise.withResolvers<void>()
    const ended = Promise.withResolvers<void>()
    const snapshot = Promise.withResolvers<string | undefined>()
    let ends = 0
    const hooks: KiloSnapshotTrack.Hooks = {
      ...base,
      async startProgress(input) {
        calls.progress.push({ kind: "start", text: input.text })
        started.resolve()
        await publish.promise
      },
      async endProgress(input) {
        await base.endProgress(input)
        ends += 1
        if (ends === 2) ended.resolve()
      },
    }

    const run = Effect.runPromise(
      KiloSnapshotTrack.wrap({
        inner: Effect.promise(() => snapshot.promise),
        state,
        sessionID: SESSION,
        messageID: MESSAGE,
        hooks,
        timeoutMs: 1_000,
        progressDelayMs: 2,
      }),
    )

    await started.promise
    snapshot.resolve("hash")
    expect(await run).toBe("hash")
    publish.resolve()
    await ended.promise

    expect(calls.progress.at(-1)).toEqual({ kind: "end" })
  })

  test("in-flight progress updates cannot recreate a removed indicator", async () => {
    const state = KiloSnapshotTrack.makeState()
    const { hooks: base, calls } = makeHooks("continue")
    const updating = Promise.withResolvers<void>()
    const update = Promise.withResolvers<void>()
    const ended = Promise.withResolvers<void>()
    const snapshot = Promise.withResolvers<string | undefined>()
    let ends = 0
    const hooks: KiloSnapshotTrack.Hooks = {
      ...base,
      async updateProgress(input) {
        updating.resolve()
        await update.promise
        calls.progress.push({ kind: "update", text: input.text })
      },
      async endProgress(input) {
        await base.endProgress(input)
        ends += 1
        if (ends === 2) ended.resolve()
      },
    }

    const run = Effect.runPromise(
      KiloSnapshotTrack.wrap({
        inner: Effect.promise(() => snapshot.promise),
        state,
        sessionID: SESSION,
        messageID: MESSAGE,
        hooks,
        timeoutMs: 1_000,
        progressDelayMs: 2,
      }),
    )

    await updating.promise
    snapshot.resolve("hash")
    expect(await run).toBe("hash")
    update.resolve()
    await ended.promise

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
