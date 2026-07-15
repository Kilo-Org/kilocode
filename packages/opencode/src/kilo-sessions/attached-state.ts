// kilocode_change - extracted state machine that separates presence-owned
// attached session ids from newly-created (pending) session announcements.
// `setPresence` (driven by the presence service) uses a passive
// `notifyHeartbeat` — fire-and-forget, no relay confirmation. `announce`
// (driven by the create_session command) uses `announceHeartbeat` — awaited,
// rejects if the relay never confirms, rolls back only its own pending entry
// on failure so a presence-owned id is never removed by a remote create
// failure.
//
// Concurrency invariant: `lastSentKey` is the union the relay last observed
// through a successfully completed heartbeat. It is updated:
//   - synchronously by `setPresence` (fire-and-forget, but the union we
//     record is the current union which includes any in-flight pending ids,
//     so a later `setPresence` with the same union correctly skips)
//   - by `announce` only on a successful awaited heartbeat
// It is NEVER updated on:
//   - the synchronous prefix of `announce` (would let a concurrent
//     `setPresence` skip its heartbeat because the cache falsely claims the
//     relay is up to date, leaving the relay desynced if the announce then
//     fails)
//   - the failure branch of `announce` (the relay never saw the new union,
//     and a concurrent `setPresence` may have already advanced lastSentKey to
//     a newer state via its own fire-and-forget heartbeat)
//
// Legacy `heartbeat` option is still accepted: when neither
// `notifyHeartbeat` nor `announceHeartbeat` is provided, the legacy
// `heartbeat` function is used for both — preserving the original behavior
// for callers that have not migrated.

export namespace AttachedState {
  export type Options = {
    /**
     * Fires the passive (fire-and-forget) relay heartbeat used by
     * `setPresence`. Must return a resolved promise on success and a
     * rejected promise when no relay connection is available. The
     * rejection is swallowed by a fire-and-forget catch and only logged.
     */
    notifyHeartbeat?: () => Promise<void> | void
    /**
     * Fires the awaited relay heartbeat used by `announce`. Must reject
     * (not resolve) when no relay connection is available so that
     * `announce` cannot silently mark a session as attached. The
     * returned promise is awaited; the announce entry is rolled back on
     * rejection.
     */
    announceHeartbeat?: () => Promise<void> | void
    /** @deprecated Use `notifyHeartbeat` and `announceHeartbeat` instead. */
    heartbeat?: () => Promise<void> | void
    log?: { warn: (msg: string, meta?: unknown) => void }
  }

  export type Interface = {
    /** Replace the presence-owned set. Adopts any pending ids now covered by
     *  presence and fires a passive heartbeat if and only if the current
     *  union diverges from `lastSentKey`. The fire-and-forget heartbeat's
     *  union is recorded into `lastSentKey` synchronously (the current
     *  union already includes any in-flight pending ids). */
    setPresence(ids: readonly string[]): void
    /** Awaitable duplicate-safe announcement. No-ops when the id is already
     *  present in either set. On heartbeat failure rolls back only its own
     *  pending entry, does NOT touch `lastSentKey`, and re-throws. On
     *  success advances `lastSentKey` to the current union. */
    announce(id: string): Promise<void>
    /** Current union of presence ∪ pending for the next heartbeat payload. */
    union(): ReadonlySet<string>
    /** Clear both sets across a connection lifecycle. The next setPresence
     *  call after reset will fire a heartbeat because the baseline key is
     *  empty. */
    reset(): void
  }

  function keyOf(ids: Iterable<string>): string {
    return [...ids].sort().join("|")
  }

  export function create(options: Options): Interface {
    const presence = new Set<string>()
    const pending = new Set<string>()
    let lastSentKey = ""

    // Resolve which heartbeat function to use for each path. Legacy callers
    // that only pass `heartbeat` get the original behavior for both paths.
    const notify = options.notifyHeartbeat ?? options.heartbeat ?? (() => {})
    const announce = options.announceHeartbeat ?? options.heartbeat ?? (() => {})

    function union(): Set<string> {
      const out = new Set(presence)
      for (const id of pending) out.add(id)
      return out
    }

    function fireHeartbeat() {
      void Promise.resolve(notify()).catch((err) =>
        options.log?.warn("attached-state heartbeat failed", { error: String(err) }),
      )
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
        if (presence.has(id) || pending.has(id)) return
        pending.add(id)
        try {
          await Promise.resolve(announce())
        } catch (err) {
          // Roll back only the entry this call added. A presence-owned id is
          // never reachable here because the early return above guards it.
          // Do NOT touch lastSentKey: the relay never observed the new
          // union, and a concurrent setPresence may have already advanced
          // it. Overwriting it here would clobber that newer state.
          pending.delete(id)
          throw err
        }
        // Success: the relay now has the union that includes this id.
        // Advance lastSentKey so the next setPresence with the same union
        // is a no-op. The id stays in `pending` until presence adopts it;
        // this keeps the union stable across presence churn.
        lastSentKey = keyOf(union())
      },

      union() {
        return union()
      },

      reset() {
        presence.clear()
        pending.clear()
        lastSentKey = ""
      },
    }
  }
}
