import { Effect, Scope } from "effect"
import { SessionRunCoordinator } from "../../session/run-coordinator"

type Entry = {
  readonly release: () => void
  count: number
}

/**
 * Holds one drain reservation per key from an accepted `run` or `wake` until its execution chain is idle and every
 * wrapped call that used it has finished. Redundant holds from racing acquisitions are released at once: they only
 * exist while the key's primary hold is live, so releasing them never makes the key look drained.
 */
export const make = <Key, E>(options: {
  readonly hold: (key: Key) => Effect.Effect<() => void>
  readonly drain: (key: Key, force: boolean) => Effect.Effect<void, E>
}): Effect.Effect<SessionRunCoordinator.Coordinator<Key, E>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const entries = new Map<Key, Entry>()

    const remove = (key: Key, entry: Entry) => {
      if (entries.get(key) !== entry) return
      entries.delete(key)
      entry.release()
    }

    // Added before the coordinator so it runs after the coordinator's fibers finish cleanup. A successor queued while
    // the scope closes never runs, so it never reports idle.
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const [key, entry] of entries) remove(key, entry)
      }),
    )

    const coordinator = yield* SessionRunCoordinator.make<Key, E>({
      drain: options.drain,
      idle: (key) => {
        const entry = entries.get(key)
        if (entry?.count === 0) remove(key, entry)
      },
    })

    const acquire = Effect.fnUntraced(function* (key: Key) {
      const found = entries.get(key)
      if (found) {
        found.count++
        return found
      }
      const release = yield* options.hold(key)
      const current = entries.get(key)
      if (current) {
        current.count++
        release()
        return current
      }
      const entry = { release, count: 1 }
      entries.set(key, entry)
      return entry
    })

    // Every coordinator start happens inside a wrapped call, so an idle key with no calls left has nothing to reserve.
    const leave = Effect.fnUntraced(function* (key: Key, entry: Entry) {
      entry.count--
      if (entry.count > 0) return
      if ((yield* coordinator.active).has(key)) return
      remove(key, entry)
    })

    const wrap =
      <X>(call: (key: Key) => Effect.Effect<void, X>) =>
      (key: Key) =>
        Effect.acquireUseRelease(
          acquire(key),
          () => call(key),
          (entry) => leave(key, entry),
        )

    const wake = wrap(coordinator.wake)

    return {
      active: coordinator.active,
      interrupt: coordinator.interrupt,
      run: wrap(coordinator.run),
      // Uninterruptible so a caller cannot reserve and then lose the wake.
      wake: (key) => Effect.uninterruptible(wake(key)),
    }
  })

export * as ExecutionDrain from "./execution-drain"
