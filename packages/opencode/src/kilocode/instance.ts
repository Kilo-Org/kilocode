import { Context, Fiber } from "effect"
import { InstanceRef } from "@/effect/instance-ref"
import { context, type InstanceContext } from "@/project/instance-context"
import { LocalContext } from "@/util/local-context"

export type { InstanceContext } from "@/project/instance-context"

function current() {
  const ctx = capture()
  if (!ctx) throw new LocalContext.NotFound("instance")
  return ctx
}

export const Instance = {
  get current() {
    return current()
  },
  get directory() {
    return current().directory
  },
  get worktree() {
    return current().worktree
  },
  get project() {
    return current().project
  },
  bind<F extends (...args: never[]) => unknown>(fn: F): F {
    const ctx = capture()
    if (!ctx) return fn
    return ((...args: Parameters<F>) => context.provide(ctx, () => fn(...args))) as F
  },
  restore<R>(ctx: InstanceContext, fn: () => R): R {
    return context.provide(ctx, fn)
  },
}

export function capture() {
  try {
    return context.use()
  } catch (err) {
    if (!(err instanceof LocalContext.NotFound)) throw err
  }
  const fiber = Fiber.getCurrent()
  return fiber ? Context.getReferenceUnsafe(fiber.context, InstanceRef) : undefined
}

export function bind<F extends (...args: never[]) => unknown>(fn: F): F {
  return Instance.bind(fn)
}

export async function provide<R>(input: { directory: string; fn: () => R }): Promise<R> {
  const runtime = await import("@/effect/app-runtime")
  const project = await import("@/project/instance-store")
  const ctx = await runtime.AppRuntime.runPromise(
    project.InstanceStore.Service.use((store) => store.load({ directory: input.directory })),
  )
  return context.provide(ctx, input.fn)
}
