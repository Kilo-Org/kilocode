import { Effect, Semaphore } from "effect"
import type { Scope } from "effect"
import type { Bus } from "@/bus"
import type { Config } from "@/config/config"
import type { Session } from "@/session/session"

// Per-instance hook lifecycle: Notification, StopFailure, ConfigChange, the FileChanged watcher,
// SessionEnd on session delete, and the instance scope detached hook runs belong to.

// Every detached hook run (async handlers, observe-only events) shares this bound, so a burst of
// events cannot spawn an unbounded number of processes.
const gate = Semaphore.makeUnsafe(8)

/** Registers the per-instance hook listeners; called once per instance at bootstrap. */
export function subscribe(_input: {
  bus: Bus.Interface
  sessions: Session.Interface
  config: Pick<Config.Interface, "get">
  /** Notification delays in ms (permission prompt, question, idle), overridable for tests. */
  delays?: { permission?: number; question?: number; idle?: number }
}): Effect.Effect<void> {
  return Effect.void
}

/** Adds absolute paths to the instance's FileChanged watch list (`watchPaths`); `[]` clears it. */
export function watch(_directory: string, _paths: readonly string[]): void {}

/** The instance scope detached hook runs are forked into, when an instance is bootstrapped. */
export function scope(): Effect.Effect<Scope.Scope | undefined> {
  return Effect.succeed(undefined)
}

/** Runs an effect in the background, behind the shared bound of 8 detached hook runs. */
export function detach<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<void, never, R> {
  return Effect.forkDetach(gate.withPermits(1)(effect)).pipe(Effect.asVoid)
}

export * as KiloHookLifecycle from "./lifecycle"
