import { context, type InstanceContext } from "./instance-context"
import type { Effect } from "effect"

export type { InstanceContext } from "./instance-context"
export type { LoadInput } from "./instance-store" // kilocode_change

export const Instance = {
  // kilocode_change start - keep promise-based Kilo callsites working during Effect migration
  async provide<R>(input: { directory: string; init?: Effect.Effect<void, unknown, unknown>; fn: () => R }) {
    const mod = await import("./instance-runtime")
    const ctx = await mod.InstanceRuntime.load({ directory: input.directory, init: input.init })
    return context.provide(ctx, () => input.fn())
  },
  // kilocode_change end
  get current() {
    return context.use()
  },
  get directory() {
    return context.use().directory
  },
  get worktree() {
    return context.use().worktree
  },
  get project() {
    return context.use().project
  },

  /**
   * Captures the current instance ALS context and returns a wrapper that
   * restores it when called. Use this for callbacks that fire outside the
   * instance async context (native addons, event emitters, timers, etc.).
   */
  bind<F extends (...args: any[]) => any>(fn: F): F {
    const ctx = context.use()
    return ((...args: any[]) => context.provide(ctx, () => fn(...args))) as F
  },
  /**
   * Run a synchronous function within the given instance context ALS.
   * Use this to bridge from Effect (where InstanceRef carries context)
   * back to sync code that reads Instance.directory from ALS.
   */
  restore<R>(ctx: InstanceContext, fn: () => R): R {
    return context.provide(ctx, fn)
  },
}
