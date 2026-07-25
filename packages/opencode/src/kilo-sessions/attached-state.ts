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
     *  forget heartbeats call without an id and resolve on any fresh send.
     *
     *  `opts.detachSessionId` is forwarded by `detach(id)` so the relay
     *  only resolves the detach promise when a fresh heartbeat whose
     *  payload DOES NOT contain that id was actually sent (the negative-
     *  containment fence). */
    heartbeat: (opts?: { requireSessionId?: string; detachSessionId?: string }) => Promise<void>
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
    /**
     * Awaitable session-detach. Removes the id from BOTH the presence and
     * pending sets and awaits a fresh heartbeat whose payload no longer
     * contains the id (id-containment fence so a stale "still contains"
     * cycle cannot falsely report the detach as complete).
     *
     * On heartbeat failure: rolls back by restoring the prior ownership
     * (presence add + pending add as appropriate), re-throws, and the
     * caller is responsible for NOT sending the success response so the
     * CLI can keep the session attached and the process alive.
     *
     * The id is also added to a suppression tombstone: until presence
     * itself stops reporting the id, subsequent `setPresence` calls
     * will NOT re-adopt it (this prevents an immediately-following
     * presence replacement from instantly re-attaching a session that
     * the remote just exited). The tombstone is released the moment
     * `setPresence` receives a set that does not contain the id (i.e.
     * presence has genuinely dropped it), so a later real reopen
     * (a fresh announce after a legitimate re-open) is not blocked.
     */
    detach(id: string): Promise<void>
    /** Current union of presence ∪ pending for the next heartbeat payload. */
    union(): ReadonlySet<string>
    /** True iff the id is in either the presence or pending set. */
    has(id: string): boolean
    /** Clear both sets across a connection lifecycle. The next setPresence
     *  call after reset will fire a heartbeat because the baseline key is
     *  empty. Also clears the suppressions. */
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
    // kilocode_change - K1 W1: tombstones for ids that have been remotely
    // detached but are still being reported by presence. While an id is in
    // this set, setPresence MUST NOT re-adopt it, so a presence replacement
    // that still includes a just-exited id cannot instantly re-attach it.
    // The entry is released the first time presence reports a set that no
    // longer includes the id (the upstream side has genuinely dropped it).
    const suppressed = new Set<string>()
    // kilocode_change - in-flight dedup. Concurrent announce(id) callers
    // share the same Promise so they observe one consistent outcome and
    // the heartbeat fires at most once per id. The owner is the caller
    // that installed the Promise; only it manages the map entry. On settle
    // the owner clears the entry if the map still points to its Promise
    // (a later announce may have replaced it). Joiners only await.
    const inflight = new Map<string, Promise<void>>()
    // kilocode_change - in-flight detach dedup, mirrors `inflight` for the
    // `detach` path. Multiple concurrent detach(id) callers share one
    // Promise (id-containment heartbeat) so we never fire two conflicting
    // detaches for the same id. Concurrent announce(id) and detach(id)
    // also share this map so the two paths serialize on the same in-flight
    // outcome (the detach-fence Promise resolves only when the id is
    // absent from the sent payload).
    const detachInflight = new Map<string, Promise<void>>()
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
        // kilocode_change - K1 W1: suppression tombstone. Any id in `next`
        // that is currently suppressed (a remote detach is in-flight or
        // was just completed) MUST be filtered out so presence does not
        // re-adopt a session the mobile client has just exited. The
        // tombstone is released once presence reports a set that no
        // longer includes the id (genuine drop upstream).
        for (const tombstone of [...suppressed]) {
          if (!next.has(tombstone)) suppressed.delete(tombstone)
          else next.delete(tombstone)
        }
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
        // kilocode_change - join a same-kind in-flight announce so concurrent
        // callers share one heartbeat and one outcome.
        const existing = inflight.get(id)
        if (existing) {
          await existing
          return
        }
        // kilocode_change - K1 W1: if a detach is in flight for this id, we
        // must NOT join its Promise. The detach-fence resolves when the id is
        // ABSENT from the sent payload — the opposite of what announce
        // promises — so joining it would report a successful attach for a
        // session that was actually detached. Wait for the detach to settle
        // (its outcome is irrelevant to us) and then perform a real announce.
        const inflightDetach = detachInflight.get(id)
        if (inflightDetach) {
          await inflightDetach.catch(() => undefined)
          if (presence.has(id)) return
          // A concurrent announce may have started while we awaited; join it.
          const raced = inflight.get(id)
          if (raced) {
            await raced
            return
          }
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
          // kilocode_change - K1 W1: an explicit announce is a deliberate
          // (re)attach that overrides any lingering detach tombstone, so
          // presence can adopt this id again. No-op when not suppressed.
          suppressed.delete(id)
          pending.add(id)
          try {
            // kilocode_change - forward the announced id so the relay only
            // resolves the attach once a fresh heartbeat whose payload
            // contains this id was actually sent (id-containment fence).
            await options.heartbeat({ requireSessionId: id })
          } catch (err) {
            // kilocode_change - K1 W1: if reset() ran while this heartbeat was
            // in flight, this announce belongs to a dead lifecycle. reset()
            // clears the SAME set instances, so rolling back here would delete
            // a `pending` entry a fresh post-reset announce for this id just
            // installed. Bail without mutating the new generation's sets (the
            // success path guards the same way before writing lastSentKey).
            if (myGeneration !== generation) return
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

      // kilocode_change - K1 W1: session-detach semantics.
      async detach(id) {
        // kilocode_change - join a same-kind in-flight detach so concurrent
        // callers share one fence and one outcome.
        const existingDetach = detachInflight.get(id)
        if (existingDetach) {
          await existingDetach
          return
        }
        // kilocode_change - K1 W1: if an announce is in flight for this id we
        // must NOT join it. `announce` adds the id to `pending` synchronously
        // before its first await, so joining the announce Promise would
        // resolve detach() successfully while the session is still fully
        // attached — and exit_cli treats a resolved detach as license to ACK
        // and close the CLI. Wait for the announce to settle, then run the
        // real detach so the negative-containment fence actually fires.
        const inflightAnnounce = inflight.get(id)
        if (inflightAnnounce) {
          await inflightAnnounce.catch(() => undefined)
          const racedDetach = detachInflight.get(id)
          if (racedDetach) {
            await racedDetach
            return
          }
        }
        // Verify we own the id, AFTER settling any in-flight announce so the
        // check sees the announce's real outcome. A detach for an id this CLI
        // does not own is a caller bug; surfacing it as a specific error means
        // the exit_cli handler can refuse to ACK and keep the CLI running.
        const wasInPresence = presence.has(id)
        const wasInPending = pending.has(id)
        if (!wasInPresence && !wasInPending) {
          throw new Error(`detach: ${id} is not owned by this CLI`)
        }
        // Tombstone the id BEFORE removing it from the sets. While the id
        // is in `suppressed`, subsequent setPresence calls that still
        // report the id (a presence churn race) will NOT re-adopt it. The
        // tombstone is released the first time presence reports a set that
        // genuinely no longer contains the id.
        suppressed.add(id)
        if (wasInPresence) presence.delete(id)
        if (wasInPending) pending.delete(id)
        const myGeneration = generation
        const owned = (async () => {
          try {
            // Forward the id we are detaching via the relay's containment
            // fence. The relay resolves this Promise only when a fresh
            // heartbeat whose payload DOES NOT contain this id was
            // actually sent over a live socket.
            await options.heartbeat({ detachSessionId: id })
          } catch (err) {
            // kilocode_change - K1 W1: if reset() ran while this heartbeat was
            // in flight, this detach belongs to a dead lifecycle. reset()
            // clears the SAME set instances, so restoring ownership / clearing
            // the tombstone here would resurrect this id into a fresh
            // post-reset lifecycle and could wipe a tombstone a concurrent
            // post-reset detach legitimately set. Bail without mutating the
            // new generation's sets (mirrors the success-path guard below).
            if (myGeneration !== generation) return
            // Roll back: restore the id to whichever sets it lived in AND
            // release the tombstone. The detach failed, so the session is
            // genuinely still attached and must stay adoptable by presence.
            // Leaving the tombstone would make setPresence's suppression loop
            // drop the still-present id on the very next call and never clear
            // (presence keeps reporting it), permanently losing the session.
            if (wasInPresence) presence.add(id)
            if (wasInPending) pending.add(id)
            suppressed.delete(id)
            throw err
          }
          if (myGeneration !== generation) return
          // The relay no longer has the id. The tombstone is released
          // by setPresence's suppression logic the first time presence
          // reports a set that no longer includes the id; we keep it in
          // place here so the case where presence churn keeps reporting
          // it for a few cycles (before the upstream side drops it) is
          // handled coherently.
          lastSentKey = keyOf(union())
        })()
        detachInflight.set(id, owned)
        try {
          await owned
        } finally {
          if (detachInflight.get(id) === owned) detachInflight.delete(id)
        }
      },

      union() {
        return union()
      },

      has(id) {
        return presence.has(id) || pending.has(id)
      },

      reset() {
        presence.clear()
        pending.clear()
        inflight.clear()
        // kilocode_change - K1 W1: also drop the in-flight detach map and
        // tombstones so a new connection lifecycle starts with a clean
        // slate and stale tombstones from a previous connection do not
        // suppress a legitimate attach on the new one.
        detachInflight.clear()
        suppressed.clear()
        lastSentKey = ""
        // kilocode_change - bump the lifecycle generation so any in-flight
        // announce started before this reset will skip its lastSentKey
        // write on success (its captured generation no longer matches).
        generation += 1
      },
    }
  }
}
