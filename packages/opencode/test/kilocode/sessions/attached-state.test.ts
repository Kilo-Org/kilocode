import { describe, expect, test } from "bun:test"
import { AttachedState } from "../../../src/kilo-sessions/attached-state"

const nolog = { warn: () => {} }

function key(ids: Iterable<string>) {
  // Mirrors the collision-safe keyOf used by the implementation under test.
  return [...ids]
    .sort()
    .map((id) => `${id.length}:${id}`)
    .join(",")
}

describe("AttachedState", () => {
  test("announce adds the id to the union and fires heartbeat once", async () => {
    let heartbeatCalls = 0
    const state = AttachedState.create({
      heartbeat: () => {
        heartbeatCalls += 1
        return Promise.resolve()
      },
      log: nolog,
    })

    await state.announce("ses_new")

    expect(heartbeatCalls).toBe(1)
    expect([...state.union()].sort()).toEqual(["ses_new"])
  })

  test("announce is a no-op when the id is already in the union (presence-owned)", async () => {
    let heartbeatCalls = 0
    const state = AttachedState.create({
      heartbeat: () => {
        heartbeatCalls += 1
        return Promise.resolve()
      },
      log: nolog,
    })
    // setPresence is the only thing that fires a heartbeat in this test; it
    // is the one call the assertion below counts.
    state.setPresence(["ses_existing"])
    const heartbeatsAfterPresence = heartbeatCalls

    await state.announce("ses_existing")

    // No new heartbeat — the announce short-circuited because the id was
    // already owned by presence.
    expect(heartbeatCalls).toBe(heartbeatsAfterPresence)
    expect([...state.union()].sort()).toEqual(["ses_existing"])
  })

  test("announce is a no-op when the same id is announced twice and avoids an extra heartbeat", async () => {
    let heartbeatCalls = 0
    const state = AttachedState.create({
      heartbeat: () => {
        heartbeatCalls += 1
        return Promise.resolve()
      },
      log: nolog,
    })

    await state.announce("ses_dup")
    await state.announce("ses_dup")
    await state.announce("ses_dup")

    expect(heartbeatCalls).toBe(1)
    expect([...state.union()].sort()).toEqual(["ses_dup"])
  })

  test("presence adoption removes the id from the pending set without an extra heartbeat", async () => {
    let heartbeatCalls = 0
    const state = AttachedState.create({
      heartbeat: () => {
        heartbeatCalls += 1
        return Promise.resolve()
      },
      log: nolog,
    })

    await state.announce("ses_adopt")
    // announce heartbeat fired once
    expect(heartbeatCalls).toBe(1)

    // Presence reports the same id — it should be adopted and dropped from
    // pending; the union key is unchanged so no second heartbeat is required.
    state.setPresence(["ses_adopt"])

    expect(heartbeatCalls).toBe(1)
    expect([...state.union()].sort()).toEqual(["ses_adopt"])
  })

  test("heartbeat failure on announce rolls back only the pending entry, never a presence-owned id", async () => {
    let heartbeatCalls = 0
    const state = AttachedState.create({
      heartbeat: () => {
        heartbeatCalls += 1
        return Promise.reject(new Error("private relay detail: credential=must-not-leak"))
      },
      log: nolog,
    })

    // Presence owns "ses_owned" first; setPresence fires the first heartbeat.
    state.setPresence(["ses_owned"])
    const heartbeatsAfterPresence = heartbeatCalls

    // Now announce "ses_new" — heartbeat throws. The rollback must NOT touch
    // presence-owned "ses_owned".
    await expect(state.announce("ses_new")).rejects.toThrow("private relay detail")

    expect(heartbeatCalls).toBe(heartbeatsAfterPresence + 1)
    expect([...state.union()].sort()).toEqual(["ses_owned"])
  })

  test("concurrent setPresence during an in-flight announce retains the announced id", async () => {
    let resolveHeartbeat: (() => void) | undefined
    const heartbeatStarted = new Promise<void>((resolve) => {
      resolveHeartbeat = resolve
    })
    const heartbeatDone = Promise.withResolvers<void>()
    const calls: { announce: number; presence: number } = { announce: 0, presence: 0 }
    const state = AttachedState.create({
      // The same factory heartbeat is used by both paths; the slow path is the
      // announce (waits on heartbeatDone) and the fast path is setPresence.
      heartbeat: () => {
        // The announce call is the first one we expect; subsequent calls are
        // from setPresence while the announce is still in flight. Record
        // arrival order so the assertion can prove the announce happened
        // before setPresence.
        calls[calls.announce === 0 ? "announce" : "presence"] += 1
        resolveHeartbeat!()
        return heartbeatDone.promise
      },
      log: nolog,
    })

    // Start the announce but do not await yet.
    const announcePromise = state.announce("ses_new")
    await heartbeatStarted
    // Concurrent presence replacement while the announce heartbeat is in flight.
    // setPresence must NOT drop the pending "ses_new".
    state.setPresence(["ses_other"])
    heartbeatDone.resolve()
    await announcePromise

    expect(calls.announce).toBe(1)
    expect(calls.presence).toBe(1)
    // The announced id survived the concurrent presence replacement and is
    // still in the union alongside the presence-owned id.
    expect([...state.union()].sort()).toEqual(["ses_new", "ses_other"])
  })

  test("setPresence fires heartbeat only when the union actually changes", () => {
    let heartbeatCalls = 0
    const state = AttachedState.create({
      heartbeat: () => {
        heartbeatCalls += 1
        return Promise.resolve()
      },
      log: nolog,
    })

    state.setPresence(["ses_a", "ses_b"])
    expect(heartbeatCalls).toBe(1)

    // Same set — no heartbeat.
    state.setPresence(["ses_b", "ses_a"])
    expect(heartbeatCalls).toBe(1)

    // Changed union — heartbeat.
    state.setPresence(["ses_a"])
    expect(heartbeatCalls).toBe(2)
  })

  test("reset clears both presence and pending and a subsequent setPresence fires heartbeat again", async () => {
    let heartbeatCalls = 0
    const state = AttachedState.create({
      heartbeat: () => {
        heartbeatCalls += 1
        return Promise.resolve()
      },
      log: nolog,
    })
    state.setPresence(["ses_a"])
    await state.announce("ses_b")
    expect(heartbeatCalls).toBe(2)
    expect([...state.union()].sort()).toEqual(["ses_a", "ses_b"])

    state.reset()
    expect([...state.union()]).toEqual([])

    // A fresh presence replacement after reset must fire heartbeat because the
    // baseline union key is empty.
    state.setPresence(["ses_c"])
    expect(heartbeatCalls).toBe(3)
    expect([...state.union()].sort()).toEqual(["ses_c"])
  })

  test("union key remains stable for the same set of ids regardless of insertion order", () => {
    let heartbeatCalls = 0
    const state = AttachedState.create({
      heartbeat: () => {
        heartbeatCalls += 1
        return Promise.resolve()
      },
      log: nolog,
    })
    state.setPresence(["a", "b", "c"])
    expect(heartbeatCalls).toBe(1)
    state.setPresence(["c", "b", "a"])
    expect(heartbeatCalls).toBe(1)
  })

  test("announce after the same id was rolled back re-attaches it", async () => {
    let attempts = 0
    const state = AttachedState.create({
      heartbeat: () => {
        attempts += 1
        if (attempts === 1) return Promise.reject(new Error("transient"))
        return Promise.resolve()
      },
      log: nolog,
    })

    await expect(state.announce("ses_retry")).rejects.toThrow("transient")
    expect([...state.union()]).toEqual([])

    await state.announce("ses_retry")
    expect([...state.union()].sort()).toEqual(["ses_retry"])
  })

  test("warn log captures heartbeat failures from setPresence without surfacing them", () => {
    const warnings: unknown[][] = []
    const state = AttachedState.create({
      heartbeat: () => Promise.reject(new Error("presence heartbeat down")),
      log: { warn: (...args: unknown[]) => warnings.push(args) },
    })

    state.setPresence(["ses_a"])

    // setPresence fires heartbeat fire-and-forget; allow the microtask to drain.
    return Promise.resolve().then(() => {
      expect(warnings).toHaveLength(1)
      expect(String(warnings[0]?.[0])).toContain("heartbeat")
      const meta = warnings[0]?.[1] as { error?: unknown } | undefined
      expect(String(meta?.error ?? "")).toContain("presence heartbeat down")
      // Union still reflects presence even when heartbeat fails.
      expect([...state.union()].sort()).toEqual(["ses_a"])
      // key helper sanity-check (not part of the contract, but useful for the
      // reviewer to read the union key format).
      expect(key(state.union())).toBe("5:ses_a")
    })
  })

  // Regression: lastKey was being updated BEFORE the awaited heartbeat, so a
  // concurrent setPresence that adopted the same id would skip its heartbeat
  // because the (false) cache said the relay already knew. When the announce
  // then failed, the relay was left believing the old union. The fix is to
  // only update the last-sent key on a successful heartbeat, and to let
  // setPresence always fire when the current union diverges from it.
  // Updated for the presence-adoption-shields-failure contract: when
  // setPresence adopts the in-flight id, presence becomes authoritative
  // and the old announce heartbeat rejection is suppressed (the attach
  // is already successful from the caller's perspective).
  test("setPresence adopts an in-flight pending id and still fires heartbeat when the announce later fails", async () => {
    const announceHeartbeat = Promise.withResolvers<void>()

    const calls: { announce: number; presence: number } = { announce: 0, presence: 0 }
    let announcing = false
    const state = AttachedState.create({
      heartbeat: () => {
        if (announcing && calls.announce === 0) {
          calls.announce += 1
          return announceHeartbeat.promise
        }
        calls.presence += 1
        return Promise.resolve()
      },
      log: nolog,
    })

    // Existing presence-owned id, successfully heartbeated earlier.
    state.setPresence(["ses_existing"])
    await Promise.resolve()
    calls.announce = 0
    calls.presence = 0

    // Announce "ses_new" — it will block until we resolve/reject the heartbeat.
    announcing = true
    const announcePromise = state.announce("ses_new")
    await Promise.resolve()

    // Concurrent presence replacement adopts the in-flight pending id.
    state.setPresence(["ses_existing", "ses_new"])
    await Promise.resolve()

    expect(calls.presence).toBe(1)
    // The pending id was adopted by presence, so the announce's pending
    // entry is gone before the announce heartbeat resolves.
    expect([...state.union()].sort()).toEqual(["ses_existing", "ses_new"])

    // Reject the announce heartbeat. With the adoption-shield contract,
    // the announce resolves cleanly because presence owns the id.
    announceHeartbeat.reject(new Error("announce failed: credential=must-not-leak"))
    await announcePromise

    // Final local state reflects the presence set.
    expect([...state.union()].sort()).toEqual(["ses_existing", "ses_new"])

    // A subsequent setPresence with the same set must NOT fire another
    // heartbeat (the relay already received {ses_existing, ses_new} from
    // the setPresence call above).
    calls.presence = 0
    state.setPresence(["ses_existing", "ses_new"])
    await Promise.resolve()
    expect(calls.presence).toBe(0)

    // A subsequent setPresence that REMOVES ses_new must fire a heartbeat
    // because the relay's last sent union was {ses_existing, ses_new} and
    // the new union is {ses_existing}.
    calls.presence = 0
    state.setPresence(["ses_existing"])
    await Promise.resolve()
    expect(calls.presence).toBe(1)
  })

  test("announce rolls back and throws when the heartbeat rejects (no remote)", async () => {
    const state = AttachedState.create({
      heartbeat: () => Promise.reject(new Error("no remote connection")),
      log: nolog,
    })

    await expect(state.announce("ses_new")).rejects.toThrow("no remote connection")
    // The id must not linger in the union after a failed announce.
    expect([...state.union()]).toEqual([])
  })

  // Concurrent announce(id) callers must share the same in-flight outcome
  // and fire the heartbeat exactly once. Driven by published promises
  // (no setTimeout / sleep) so the assertion is deterministic.
  test("concurrent announce callers share one in-flight promise and fire one heartbeat", async () => {
    const heartbeat = Promise.withResolvers<void>()
    let heartbeatCalls = 0
    const state = AttachedState.create({
      heartbeat: () => {
        heartbeatCalls += 1
        return heartbeat.promise
      },
      log: nolog,
    })

    // Both callers start before the heartbeat resolves. They must converge
    // on a single in-flight promise and not race two heartbeats.
    const a = state.announce("ses_concurrent")
    const b = state.announce("ses_concurrent")
    // Yield so both synchronous prefixes have run before we resolve.
    await Promise.resolve()
    expect(heartbeatCalls).toBe(1)
    expect([...state.union()].sort()).toEqual(["ses_concurrent"])

    heartbeat.resolve()
    await Promise.all([a, b])
    expect(heartbeatCalls).toBe(1)
    expect([...state.union()].sort()).toEqual(["ses_concurrent"])
  })

  // If the shared heartbeat rejects, every concurrent caller observes the
  // same error and the id is rolled back exactly once.
  test("concurrent announce callers observe the same rejection and roll back once", async () => {
    const heartbeat = Promise.withResolvers<void>()
    let heartbeatCalls = 0
    const state = AttachedState.create({
      heartbeat: () => {
        heartbeatCalls += 1
        return heartbeat.promise
      },
      log: nolog,
    })

    const a = state.announce("ses_shared_fail")
    const b = state.announce("ses_shared_fail")
    const c = state.announce("ses_shared_fail")
    await Promise.resolve()
    expect(heartbeatCalls).toBe(1)

    heartbeat.reject(new Error("shared failure"))
    const results = await Promise.allSettled([a, b, c])
    expect(results.every((r) => r.status === "rejected")).toBe(true)
    // The id must not linger in the union after a shared failure.
    expect([...state.union()]).toEqual([])
  })

  // Presence adopting an in-flight announce must leave a coherent outcome:
  // - the union reflects both presence and pending,
  // - a later setPresence with the same union does NOT fire a redundant
  //   heartbeat (the relay already learned about it from setPresence's
  //   own fire-and-forget).
  test("presence adoption during an in-flight announce keeps the union coherent and avoids a redundant heartbeat", async () => {
    const announceHeartbeat = Promise.withResolvers<void>()
    const calls: { announce: number; presence: number } = { announce: 0, presence: 0 }
    const state = AttachedState.create({
      heartbeat: () => {
        if (calls.announce === 0) {
          // First call is the announce (blocks on announceHeartbeat).
          calls.announce += 1
          return announceHeartbeat.promise
        }
        // Subsequent calls are setPresence fire-and-forget.
        calls.presence += 1
        return Promise.resolve()
      },
      log: nolog,
    })

    const announcePromise = state.announce("ses_coexist")
    await Promise.resolve()
    // The announce reached its first `await`; the in-flight heartbeat is the
    // announce heartbeat (not yet resolved).
    expect(calls.announce).toBe(1)
    expect(calls.presence).toBe(0)

    // Concurrent presence replacement that includes the pending id.
    state.setPresence(["ses_coexist"])
    // Drain the setPresence fire-and-forget heartbeat microtask.
    await Promise.resolve()
    // setPresence fired its own heartbeat.
    expect(calls.presence).toBe(1)
    // The pending id is now in the union via presence; the pending entry
    // is gone so the announce's success path leaves the state consistent.
    expect([...state.union()].sort()).toEqual(["ses_coexist"])

    // Resolve the in-flight announce heartbeat. It must NOT fire another
    // heartbeat of its own (the contract is "exactly one per attach").
    announceHeartbeat.resolve()
    await announcePromise
    expect(calls.presence).toBe(1)
    expect([...state.union()].sort()).toEqual(["ses_coexist"])
  })

  // Gap 3: presence adopts an in-flight announce, then the OLD announce
  // heartbeat rejects. The attach is successful because presence is the
  // authoritative owner — the announce caller must resolve cleanly, the
  // pending entry must stay clean (already deleted by setPresence), and
  // the in-flight map must not retain a stale entry.
  test("presence adoption during an in-flight announce shields a later heartbeat failure", async () => {
    const announceHeartbeat = Promise.withResolvers<void>()
    let heartbeatCalls = 0
    const state = AttachedState.create({
      heartbeat: () => {
        heartbeatCalls += 1
        return announceHeartbeat.promise
      },
      log: nolog,
    })

    // Start the announce; it blocks on the heartbeat.
    const announcePromise = state.announce("ses_shield")
    await Promise.resolve()
    expect(heartbeatCalls).toBe(1)

    // Presence adopts the in-flight id and fires its own heartbeat.
    state.setPresence(["ses_shield"])
    await Promise.resolve()
    expect(heartbeatCalls).toBe(2)
    // Presence adopted; the pending entry was already cleared.
    expect([...state.union()].sort()).toEqual(["ses_shield"])

    // Now the OLD announce heartbeat rejects. The attach was successful
    // (presence owns the id), so the announce caller must NOT see this
    // as an attach failure.
    announceHeartbeat.reject(new Error("late relay failure"))
    await expect(announcePromise).resolves.toBeUndefined()
    // Presence is still authoritative; the union still reflects the id.
    expect([...state.union()].sort()).toEqual(["ses_shield"])

    // A subsequent announce for the same id must short-circuit on the
    // presence check, NOT start a new heartbeat (no stale inflight entry).
    const followup = state.announce("ses_shield")
    await followup
    expect(heartbeatCalls).toBe(2)
  })

  // Truly unadopted announce heartbeat failure must still reject and roll
  // back. Pair with the shield test above to prove both paths behave
  // coherently.
  test("unadopted heartbeat failure still rejects and rolls back", async () => {
    let resolve: () => void = () => {}
    let reject: (reason: unknown) => void = () => {}
    const make = () =>
      new Promise<void>((res, rej) => {
        resolve = res
        reject = rej
      })
    let current = make()
    let heartbeatCalls = 0
    const state = AttachedState.create({
      heartbeat: () => {
        heartbeatCalls += 1
        return current
      },
      log: nolog,
    })

    const announcePromise = state.announce("ses_unadopted")
    // Mark the announce's eventual rejection as handled so the unhandled
    // rejection tracker does not stall the test. expect.rejects.toThrow
    // only attaches a handler when awaited; the explicit catch keeps the
    // runtime happy between the two await points.
    announcePromise.catch(() => {})

    await Promise.resolve()
    expect(heartbeatCalls).toBe(1)

    // Presence does NOT adopt the id — its set is empty.
    reject(new Error("relay down"))
    await expect(announcePromise).rejects.toThrow("relay down")
    expect([...state.union()]).toEqual([])

    // A fresh announce must start a new heartbeat; no stale inflight entry.
    current = make()
    const second = state.announce("ses_unadopted")
    await Promise.resolve()
    expect(heartbeatCalls).toBe(2)
    resolve()
    await second
    expect([...state.union()].sort()).toEqual(["ses_unadopted"])
  })

  // Gap 2 (lifecycle): after a settled in-flight entry, a later announce
  // for the same id must NOT be pinned to the old promise. With the
  // map<id, Promise> design, the owner clears its entry in `finally` only
  // if the map still points to its own promise. A new announce can
  // therefore start a fresh heartbeat, and a stale promise never blocks
  // later traffic.
  test("a settled in-flight entry is cleared and does not pin later announces", async () => {
    let resolve: () => void = () => {}
    let reject: (reason: unknown) => void = () => {}
    const make = () =>
      new Promise<void>((res, rej) => {
        resolve = res
        reject = rej
      })
    let current = make()
    let heartbeatCalls = 0
    const state = AttachedState.create({
      heartbeat: () => {
        heartbeatCalls += 1
        return current
      },
      log: nolog,
    })

    // First announce runs to completion. After it settles, its inflight
    // entry must be gone (the owner finally clears it).
    const a = state.announce("ses_pinned")
    await Promise.resolve()
    resolve()
    await a
    expect(heartbeatCalls).toBe(1)
    expect([...state.union()].sort()).toEqual(["ses_pinned"])

    // The id is still in pending (presence has not adopted it), so a
    // second announce short-circuits via the pending check without
    // starting a new heartbeat. The inflight map is empty; the
    // settled promise is not pinned.
    const b = state.announce("ses_pinned")
    await b
    expect(heartbeatCalls).toBe(1)
    expect([...state.union()].sort()).toEqual(["ses_pinned"])

    // Drop the id from the union (reset) and announce again. The new
    // announce must take a fresh heartbeat path with no stale pin.
    state.reset()
    current = make()
    const c = state.announce("ses_pinned")
    await Promise.resolve()
    expect(heartbeatCalls).toBe(2)
    resolve()
    await c
    expect([...state.union()].sort()).toEqual(["ses_pinned"])
  })

  // reset() must drop every in-flight entry so new announces after reset
  // can start fresh heartbeats.
  test("reset drops in-flight entries and a follow-up announce starts fresh", async () => {
    let resolve: () => void = () => {}
    let reject: (reason: unknown) => void = () => {}
    const make = () =>
      new Promise<void>((res, rej) => {
        resolve = res
        reject = rej
      })
    let current = make()
    let heartbeatCalls = 0
    const state = AttachedState.create({
      heartbeat: () => {
        heartbeatCalls += 1
        return current
      },
      log: nolog,
    })

    // Start an announce, then reset before it settles.
    const a = state.announce("ses_reset")
    await Promise.resolve()
    expect(heartbeatCalls).toBe(1)
    state.reset()
    // The map was cleared by reset; resolving the old promise is a no-op
    // for any future caller because the entry is gone.
    resolve()
    await a
    expect([...state.union()]).toEqual([])

    // After reset, a fresh announce must start a new heartbeat (the
    // cleared inflight entry does not block it).
    current = make()
    const b = state.announce("ses_reset")
    await Promise.resolve()
    expect(heartbeatCalls).toBe(2)
    resolve()
    await b
    expect([...state.union()].sort()).toEqual(["ses_reset"])
  })

  // Collision regression: two distinct id sets must never produce the
  // same union key. The historical "|" separator was unsafe — sets
  // ["a", "b"] and ["a|b"] both encoded to the same key, which let
  // setPresence skip a heartbeat it should have fired. The fix length-
  // prefixes each id; this test pins the observable consequence
  // (the two distinct sets fire two heartbeats).
  test("union key is collision-safe across distinct id sets containing the historical separator", () => {
    let calls = 0
    const state = AttachedState.create({
      heartbeat: () => {
        calls += 1
        return Promise.resolve()
      },
      log: nolog,
    })
    state.setPresence(["a", "b"])
    state.setPresence(["a|b"])
    // With the old key, the second setPresence would have been a no-op
    // because the keys collided. With the collision-safe key it must fire.
    expect(calls).toBe(2)
    expect([...state.union()]).toEqual(["a|b"])
  })

  // Gap 4 (lifecycle): after reset(), a late success from an in-flight
  // announce started before the reset must not overwrite lastSentKey.
  // Without the generation guard, the old promise's
  // `lastSentKey = keyOf(union())` writes a value derived from the new
  // generation's union, causing redundant or stale change detection in
  // subsequent setPresence calls. The old completion must be a no-op
  // for lastSentKey; the new lifecycle's setPresence calls drive the
  // baseline.
  test("stale announce completion after reset does not overwrite lastSentKey", async () => {
    const staleHeartbeat = Promise.withResolvers<void>()
    const presenceHeartbeat = Promise.withResolvers<void>()
    let heartbeatCalls = 0
    const state = AttachedState.create({
      heartbeat: () => {
        heartbeatCalls += 1
        if (heartbeatCalls === 1) return staleHeartbeat.promise
        return presenceHeartbeat.promise
      },
      log: nolog,
    })

    // Start the stale announce; it blocks on the controlled heartbeat.
    const stale = state.announce("ses_stale")
    await Promise.resolve()
    expect(heartbeatCalls).toBe(1)

    // Reset clears state and the in-flight map; the stale announce's
    // captured generation no longer matches the current one.
    state.reset()

    // Fresh presence replacement after reset fires a new heartbeat.
    state.setPresence(["ses_fresh"])
    await Promise.resolve()
    expect(heartbeatCalls).toBe(2)

    // Resolve the stale heartbeat. The stale announce's success path must
    // NOT overwrite lastSentKey (the new lifecycle's baseline).
    staleHeartbeat.resolve()
    await stale

    // Resolve the presence heartbeat so it does not stall the test.
    presenceHeartbeat.resolve()

    // Union reflects the new presence set; the stale id is not added back.
    expect([...state.union()].sort()).toEqual(["ses_fresh"])

    // Repeat the same setPresence; it must NOT fire a redundant heartbeat
    // because lastSentKey is still accurate.
    const heartbeatsBeforeRepeat = heartbeatCalls
    state.setPresence(["ses_fresh"])
    expect(heartbeatCalls).toBe(heartbeatsBeforeRepeat)
    expect([...state.union()].sort()).toEqual(["ses_fresh"])
  })

  // Gap 4 (lifecycle, replacement): after reset(), a late completion from
  // an in-flight announce started before the reset must not clobber a
  // replacement in-flight entry installed after the reset. The existing
  // `finally` guard (`inflight.get(id) === owned`) already handles the
  // in-flight map; this test pins the contract end-to-end so a future
  // refactor cannot accidentally drop the replacement entry when an old
  // promise settles.
  test("stale announce completion after reset does not clobber a replacement in-flight entry", async () => {
    const staleHeartbeat = Promise.withResolvers<void>()
    const replacementHeartbeat = Promise.withResolvers<void>()
    let heartbeatCalls = 0
    const state = AttachedState.create({
      heartbeat: () => {
        heartbeatCalls += 1
        if (heartbeatCalls === 1) return staleHeartbeat.promise
        return replacementHeartbeat.promise
      },
      log: nolog,
    })

    // Start the stale announce; it blocks on the controlled heartbeat.
    const stale = state.announce("ses_x")
    await Promise.resolve()
    expect(heartbeatCalls).toBe(1)

    // Reset clears state and the in-flight map.
    state.reset()

    // Install a replacement in-flight entry for the same id.
    const replacement = state.announce("ses_x")
    await Promise.resolve()
    expect(heartbeatCalls).toBe(2)

    // Resolve the stale heartbeat. The stale announce's finally must NOT
    // delete the replacement in-flight entry; the map still points to
    // the replacement's Promise, not the stale one.
    staleHeartbeat.resolve()
    await stale

    // The replacement in-flight entry is still in the map. Resolve the
    // replacement heartbeat and verify it settles cleanly.
    replacementHeartbeat.resolve()
    await replacement
    expect([...state.union()].sort()).toEqual(["ses_x"])
  })

  // AC6d: announce(id) must forward { requireSessionId: id } to the
  // heartbeat callback so the relay only resolves the attach once a fresh
  // heartbeat whose payload contains that id was actually sent. Presence
  // fire-and-forget heartbeats (from setPresence) continue to call
  // without an id and resolve on any fresh send.
  test("announce(id) forwards { requireSessionId: id } to the heartbeat callback", async () => {
    const calls: Array<{ requireSessionId?: string }> = []
    const state = AttachedState.create({
      heartbeat: (opts) => {
        calls.push(opts ? { ...opts } : {})
        return Promise.resolve()
      },
      log: nolog,
    })

    // setPresence fires a fire-and-forget heartbeat with NO id.
    state.setPresence(["ses_a"])
    await Promise.resolve()

    // announce(id) forwards the id to the awaited heartbeat.
    await state.announce("ses_b")

    expect(calls).toEqual([{}, { requireSessionId: "ses_b" }])
  })

  // K1 W1: detach semantics — basic happy path.
  test("detach removes the id from both sets and awaits a heartbeat whose payload no longer contains it", async () => {
    let detachResolved = false
    const state = AttachedState.create({
      heartbeat: (opts) => {
        if (opts?.detachSessionId) {
          detachResolved = true
          return Promise.resolve()
        }
        return Promise.resolve()
      },
      log: nolog,
    })
    state.setPresence(["ses_a"])
    await Promise.resolve()
    expect(state.has("ses_a")).toBe(true)

    // Detach awaits a heartbeat whose payload no longer contains ses_a.
    // The state machine removes the id synchronously before awaiting.
    await state.detach("ses_a")
    expect(detachResolved).toBe(true)
    expect([...state.union()]).toEqual([])
  })

  // K1 W1: detach surfaces a specific error for an id this CLI does not own.
  test("detach throws for an id this CLI does not own (no silent re-attach)", async () => {
    const state = AttachedState.create({
      heartbeat: () => Promise.resolve(),
      log: nolog,
    })
    await expect(state.detach("ses_missing")).rejects.toThrow("not owned")
  })

  // K1 W1: heartbeat failure during detach rolls back by restoring ownership.
  test("detach rolls back by restoring prior ownership on heartbeat failure", async () => {
    const state = AttachedState.create({
      heartbeat: (opts) => {
        if (opts?.detachSessionId) return Promise.reject(new Error("relay down"))
        return Promise.resolve()
      },
      log: nolog,
    })
    state.setPresence(["ses_a"])
    await Promise.resolve()
    await expect(state.detach("ses_a")).rejects.toThrow("relay down")
    // The id must be back in presence so a future setPresence does not
    // accidentally treat the session as detached.
    expect(state.has("ses_a")).toBe(true)
  })

  // K1 W1: suppression tombstone prevents a presence replacement that
  // still includes a just-exited id from instantly re-adopting it.
  test("setPresence does not re-adopt a detached id while presence still reports it", async () => {
    const state = AttachedState.create({
      heartbeat: () => Promise.resolve(),
      log: nolog,
    })
    state.setPresence(["ses_a", "ses_b"])
    expect(state.has("ses_a")).toBe(true)

    // Detach ses_a; the tombstone is set BEFORE the sets are mutated.
    await state.detach("ses_a")
    expect(state.has("ses_a")).toBe(false)

    // A presence churn that still includes ses_a must NOT re-adopt it
    // (the relay is the source of truth and the upstream side has not
    // dropped the id yet).
    state.setPresence(["ses_a", "ses_b"])
    expect(state.has("ses_a")).toBe(false)

    // Once presence genuinely drops ses_a, the tombstone is released
    // and a later real re-open (via announce) is not blocked.
    state.setPresence(["ses_b"])
    expect(state.has("ses_a")).toBe(false)
    await state.announce("ses_a")
    expect(state.has("ses_a")).toBe(true)
  })

  // K1 W1: has(id) reflects presence ∪ pending.
  test("has(id) is true for presence-owned and pending ids, false otherwise", async () => {
    const announced = Promise.withResolvers<void>()
    const state = AttachedState.create({
      heartbeat: (opts) => {
        if (opts?.requireSessionId === "ses_pending") return announced.promise
        return Promise.resolve()
      },
      log: nolog,
    })
    state.setPresence(["ses_present"])
    expect(state.has("ses_present")).toBe(true)
    expect(state.has("ses_pending")).toBe(false)
    expect(state.has("ses_other")).toBe(false)

    // Announce with a held heartbeat so the id sits in pending.
    const p = state.announce("ses_pending")
    await Promise.resolve()
    expect(state.has("ses_pending")).toBe(true)
    announced.resolve()
    await p
    expect(state.has("ses_pending")).toBe(true)
  })

  // K1 W1: reset() also clears the detach in-flight map and tombstones
  // so a new connection lifecycle does not inherit stale state.
  test("reset() clears tombstones and detach in-flight map", async () => {
    const state = AttachedState.create({
      heartbeat: () => Promise.resolve(),
      log: nolog,
    })
    state.setPresence(["ses_a"])
    await state.detach("ses_a")
    state.setPresence(["ses_a"])
    expect(state.has("ses_a")).toBe(false) // tombstone held

    state.reset()
    // After reset, a presence report including ses_a is accepted (the
    // previous tombstone is gone).
    state.setPresence(["ses_a"])
    expect(state.has("ses_a")).toBe(true)
  })
})
