// kilocode_change - extracted state machine that separates presence-owned
// attached session ids from newly-created (pending) session announcements.
// `setPresence` (driven by the presence service) is authoritative for the
// presence set and adopts any pending ids it now covers. `announce` (driven
// by the create_session command) is duplicate-safe across both sets and
// resolves coherently with presence semantics on heartbeat failure so a
// presence-adopted id is never reported as an attach failure.
//
// Concurrency invariant: `lastSentKey` is the union the relay last observed
// through a successfully completed heartbeat. It is updated:
//   - synchronously by `setPresence` (fire-and-forget, but the union we
//     record is the current union which includes any in-flight pending ids,
//     so a later `setPresence` with the same union correctly skips)
//   - by `announce` only on a successful awaited heartbeat AND only when
//     the announce still belongs to the current lifecycle (the captured
//     `myGeneration` matches the current `generation`)
// It is NEVER updated on:
//   - the synchronous prefix of `announce` (would let a concurrent
//     `setPresence` skip its heartbeat because the cache falsely claims the
//     relay is up to date, leaving the relay desynced if the announce then
//     fails)
//   - the failure branch of `announce` (the relay never saw the new union,
//     and a concurrent setPresence may have already advanced lastSentKey to
//     a newer state via its own fire-and-forget heartbeat)
//   - a stale success after `reset()` (the relay's observed state belongs
//     to the old lifecycle; the new lifecycle's setPresence calls must
//     drive the new baseline, not a stale overwrite)

export namespace AttachedState {
  export type Options = {
    /** Fires the relay heartbeat. May be fire-and-forget or awaited. Must
     *  reject (not resolve) when no relay connection is available so that
     *  `announce` cannot silently mark a session as attached.
     *
     *  `opts.requireSessionId` is forwarded by `announce(id)` so the relay
     *  only resolves the attach promise when a fresh heartbeat whose
     *  payload contains that id was actually sent. Presence fire-and-
     *  forget heartbeats call without an id and resolve on any fresh send. */
    heartbeat: (opts?: { requireSessionId?: string }) => Promise<void>
    log?: { warn: (msg: string, meta?: unknown) => void }
  }

  export type Interface = {
    /** Replace the presence-owned set. Adopts any pending ids now covered by
     *  presence and fires a heartbeat if and only if the current union
     *  diverges from `lastSentKey`. The fire-and-forget heartbeat's union
     *  is recorded into `lastSentKey` synchronously (the current union
     *  already includes any in-flight pending ids). */
    setPresence(ids: readonly string[]): void
    /** Awaitable duplicate-safe announcement. No-ops when the id is already
     *  present in either set. On heartbeat failure rolls back only its own
     *  pending entry, does NOT touch `lastSentKey`, and re-throws — unless
     *  presence adopted the id while the heartbeat was in flight, in which
     *  case presence is authoritative and the attach resolves successfully.
     *  On success advances `lastSentKey` to the current union. */
    announce(id: string): Promise<void>
    /** Current union of presence ∪ pending for the next heartbeat payload. */
    union(): ReadonlySet<string>
    /** Clear both sets across a connection lifecycle. The next setPresence
     *  call after reset will fire a heartbeat because the baseline key is
     *  empty. */
    reset(): void
  }

  // kilocode_change - collision-safe union key. The historical "|" join
  // was ambiguous: {"a", "b"} and {"a|b"} both encoded to "a|b" so two
  // distinct id sets could collide. Length-prefixing each id makes the
  // encoding unambiguous for any string id: knowing the prefix length
  // tells the decoder exactly how many characters of id follow, so no
  // delimiter can ever escape its enclosing id.
  function keyOf(ids: Iterable<string>): string {
    const sorted = [...ids].sort()
    const parts: string[] = []
    for (const id of sorted) parts.push(`${id.length}:${id}`)
    return parts.join(",")
  }

  export function create(options: Options): Interface {
    const presence = new Set<string>()
    const pending = new Set<string>()
    // kilocode_change - in-flight dedup. Concurrent announce(id) callers
    // share the same Promise so they observe one consistent outcome and
    // the heartbeat fires at most once per id. The owner is the caller
    // that installed the Promise; only it manages the map entry. On settle
    // the owner clears the entry if the map still points to its Promise
    // (a later announce may have replaced it). Joiners only await.
    const inflight = new Map<string, Promise<void>>()
    // kilocode_change end
    let lastSentKey = ""
    // kilocode_change - lifecycle generation. Incremented on reset() so a
    // late success from an in-flight announce started before the reset
    // cannot overwrite the new lifecycle's lastSentKey. The old completion
    // would otherwise write keyOf(union()) using the new generation's union,
    // causing redundant/stale change detection in subsequent setPresence calls.
    let generation = 0

    function union(): Set<string> {
      const out = new Set(presence)
      for (const id of pending) out.add(id)
      return out
    }

    function fireHeartbeat() {
      void options
        .heartbeat()
        .catch((err) => options.log?.warn("attached-state heartbeat failed", { error: String(err) }))
    }

    return {
      setPresence(ids) {
        const next = new Set(ids)
        presence.clear()
        for (const id of next) presence.add(id)
        // Adopt any pending ids that presence now covers so the relay does
        // not receive redundant heartbeat updates for ids it already knows.
        for (const id of [...pending]) {
          if (presence.has(id)) pending.delete(id)
        }
        const key = keyOf(union())
        if (key === lastSentKey) return
        // Record the union synchronously so a subsequent setPresence with
        // the same union is a no-op. The union already includes any
        // in-flight pending ids, so a concurrent announce cannot poison it.
        lastSentKey = key
        fireHeartbeat()
      },

      async announce(id) {
        if (presence.has(id)) return
        // kilocode_change - join an in-flight Promise for this id instead
        // of starting a second heartbeat.
        const existing = inflight.get(id)
        if (existing) {
          await existing
          return
        }
        if (pending.has(id)) {
          // A previous announce already resolved and is awaiting presence
          // adoption. No further work to do.
          return
        }
        // kilocode_change - capture the lifecycle generation so a late
        // success after reset() cannot overwrite the new lifecycle's
        // lastSentKey with keyOf(union()) computed from the new state.
        const myGeneration = generation
        const owned = (async () => {
          pending.add(id)
          try {
            // kilocode_change - forward the announced id so the relay only
            // resolves the attach once a fresh heartbeat whose payload
            // contains this id was actually sent (id-containment fence).
            await options.heartbeat({ requireSessionId: id })
          } catch (err) {
            // Roll back only the entry this call added. If presence adopted
            // the id while the heartbeat was in flight, presence is the
            // authoritative owner and the attach succeeded from the
            // caller's perspective — resolve cleanly and leave the union
            // alone. Otherwise the id is truly unattached: drop the pending
            // entry and surface the failure. lastSentKey is never touched
            // here because the relay never observed the new union and a
            // concurrent setPresence may have already advanced it.
            if (presence.has(id)) return
            pending.delete(id)
            throw err
          }
          // Success: the relay now has the union that includes this id.
          // Advance lastSentKey so the next setPresence with the same union
          // is a no-op. The id stays in `pending` until presence adopts it;
          // this keeps the union stable across presence churn. If a
          // reset() happened while the heartbeat was in flight, the
          // captured generation no longer matches and we must NOT write
          // lastSentKey — the new lifecycle owns the baseline now.
          if (myGeneration !== generation) return
          lastSentKey = keyOf(union())
        })()
        inflight.set(id, owned)
        try {
          await owned
        } finally {
          // Only clear if the map still points to OUR promise; a later
          // announce may have replaced it and we must not clobber that.
          if (inflight.get(id) === owned) inflight.delete(id)
        }
      },

      union() {
        return union()
      },

      reset() {
        presence.clear()
        pending.clear()
        inflight.clear()
        lastSentKey = ""
        // kilocode_change - bump the lifecycle generation so any in-flight
        // announce started before this reset will skip its lastSentKey
        // write on success (its captured generation no longer matches).
        generation += 1
      },
    }
  }
}
