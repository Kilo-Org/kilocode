import { describe, expect, test } from "bun:test"
import { AttachedState } from "../../../src/kilo-sessions/attached-state"

const nolog = { warn: () => {} }

function key(ids: Iterable<string>) {
  return [...ids].sort().join("|")
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
      expect(key(state.union())).toBe("ses_a")
    })
  })

  // Regression: lastKey was being updated BEFORE the awaited heartbeat, so a
  // concurrent setPresence that adopted the same id would skip its heartbeat
  // because the (false) cache said the relay already knew. When the announce
  // then failed, the relay was left believing the old union. The fix is to
  // only update the last-sent key on a successful heartbeat, and to let
  // setPresence always fire when the current union diverges from it.
  test("setPresence adopts an in-flight pending id and still fires heartbeat when the announce later fails", async () => {
    // Controlled resolvers — no setTimeout, no real timers.
    let resolveAnnounceHeartbeat: ((value: void) => void) | undefined
    let rejectAnnounceHeartbeat: ((reason: unknown) => void) | undefined
    const announceHeartbeat = Promise.withResolvers<void>()
    resolveAnnounceHeartbeat = announceHeartbeat.resolve
    rejectAnnounceHeartbeat = announceHeartbeat.reject

    // Distinguish the two call sites so the assertion can prove setPresence
    // fired (not just the announce path).
    const calls: { announce: number; presence: number } = { announce: 0, presence: 0 }
    const state = AttachedState.create({
      heartbeat: () => {
        // First call is the announce (blocks on announceHeartbeat). Any
        // subsequent call is from setPresence (returns immediately).
        if (calls.announce === 0) {
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
    // Drain the first setPresence's fire-and-forget heartbeat microtask.
    await Promise.resolve()
    calls.announce = 0
    calls.presence = 0

    // Announce "ses_new" — it will block until we resolve/reject the heartbeat.
    const announcePromise = state.announce("ses_new")
    // Yield so the announce reaches its `await`.
    await Promise.resolve()

    // Concurrent presence replacement adopts the in-flight pending id.
    state.setPresence(["ses_existing", "ses_new"])
    // Drain the setPresence fire-and-forget heartbeat microtask.
    await Promise.resolve()

    // setPresence MUST have fired a heartbeat; otherwise the relay would be
    // left believing the old union after the announce fails below.
    expect(calls.presence).toBe(1)
    // The pending id was adopted by presence, so the announce's pending
    // entry is gone before the announce heartbeat resolves.
    expect([...state.union()].sort()).toEqual(["ses_existing", "ses_new"])

    // Now reject the announce heartbeat. The factory must NOT have poisoned
    // the last-sent key with the pre-success union, and the rollback must
    // not leave the relay desynced.
    rejectAnnounceHeartbeat!(new Error("announce failed: credential=must-not-leak"))
    await expect(announcePromise).rejects.toThrow("must-not-leak")

    // Final local state reflects the presence set.
    expect([...state.union()].sort()).toEqual(["ses_existing", "ses_new"])

    // A subsequent setPresence with the same set must NOT fire another
    // heartbeat (the relay already received {ses_existing, ses_new} from the
    // setPresence call above).
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
})
