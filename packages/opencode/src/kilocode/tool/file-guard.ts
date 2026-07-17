import { type BigIntStats } from "node:fs"
import { lstat, stat } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import type { InstanceContext } from "@/project/instance-context"
import { IgnorePermission } from "@/kilocode/permission/ignore"
import { KiloReadObject } from "./read-object"

export namespace KiloFileGuard {
  export class ChangedError extends Error {}

  export type Plan = {
    requested: string
    target: string
    exists: boolean
    parent?: string
    suffix?: string[]
    authority: BigIntStats
  }

  const failure = (err: unknown) => (err instanceof Error ? err : new Error(String(err)))
  const same = (left: BigIntStats, right: BigIntStats) => left.dev === right.dev && left.ino === right.ino

  async function inspect(_ctx: InstanceContext, requested: string) {
    const requestedPath = path.resolve(requested)
    let current = requestedPath
    try {
      await lstat(current, { bigint: true })
      const target = await IgnorePermission.physical(current)
      return { requested: requestedPath, target, exists: true, authority: await stat(target, { bigint: true }) }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
      const suffix: string[] = []
      while (true) {
        suffix.unshift(path.basename(current))
        current = path.dirname(current)
        try {
          const parent = await IgnorePermission.physical(current)
          const authority = await stat(parent, { bigint: true })
          return {
            requested: requestedPath,
            target: path.join(parent, ...suffix),
            exists: false,
            parent,
            suffix,
            authority,
          }
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
        }
      }
    }
  }

  export const plan = Effect.fn("KiloFileGuard.plan")(function* (input: {
    ctx: InstanceContext
    requested: string
    access?: IgnorePermission.Access
  }) {
    const item = yield* Effect.tryPromise({ try: () => inspect(input.ctx, input.requested), catch: failure })
    yield* IgnorePermission.assert({
      ctx: input.ctx,
      access: input.access ?? "edit",
      candidates: [{ requested: item.requested, target: item.target }],
    })
    return item satisfies Plan
  })

  export const revalidate = Effect.fn("KiloFileGuard.revalidate")(function* (input: {
    ctx: InstanceContext
    plan: Plan
    access?: IgnorePermission.Access
  }) {
    const item = input.plan.exists
      ? yield* Effect.tryPromise({ try: () => inspect(input.ctx, input.plan.requested), catch: failure })
      : input.plan
    const authority = input.plan.exists
      ? item.authority
      : yield* Effect.tryPromise({ try: () => stat(input.plan.parent!, { bigint: true }), catch: failure })
    if (item.target !== input.plan.target || !same(authority, input.plan.authority)) {
      return yield* Effect.fail(new ChangedError(`File changed after authorization: ${input.plan.requested}`))
    }
    if (!input.plan.exists) {
      let current = input.plan.parent!
      for (const [index, item] of input.plan.suffix!.entries()) {
        current = path.join(current, item)
        const info = yield* Effect.tryPromise({
          try: () => lstat(current, { bigint: true }),
          catch: (err) => {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Error("missing")
            return failure(err)
          },
        }).pipe(Effect.catch((err) => (err.message === "missing" ? Effect.succeed(undefined) : Effect.fail(err))))
        if (!info) break
        if (info.isSymbolicLink() || index === input.plan.suffix!.length - 1 || !info.isDirectory()) {
          return yield* Effect.fail(new ChangedError(`File changed after authorization: ${input.plan.requested}`))
        }
      }
    }
    yield* IgnorePermission.assert({
      ctx: input.ctx,
      access: input.access ?? "edit",
      candidates: [{ requested: item.requested, target: item.target }],
    })
    return item satisfies Plan
  })

  export const file = Effect.fn("KiloFileGuard.file")(function* (input: { ctx: InstanceContext; requested: string }) {
    const info = yield* KiloReadObject.file(input.requested)
    yield* IgnorePermission.assert({
      ctx: input.ctx,
      access: "read",
      candidates: [{ requested: info.requested, target: info.target }],
    })
    return info
  })

  export const read = Effect.fn("KiloFileGuard.read")(function* (input: { ctx: InstanceContext; requested: string }) {
    const info = yield* KiloFileGuard.file(input)
    return yield* KiloFileGuard.use({ ctx: input.ctx, info }, (file) => Effect.tryPromise(() => file.read()))
  })

  export function use<A, E, R>(
    input: { ctx: InstanceContext; info: KiloReadObject.FileInfo },
    fn: (file: KiloReadObject.File) => Effect.Effect<A, E, R>,
  ) {
    return KiloReadObject.use(input.info, (file) =>
      IgnorePermission.assert({
        ctx: input.ctx,
        access: "read",
        candidates: [{ requested: file.requested, target: file.target }],
      }).pipe(Effect.andThen(fn(file))),
    )
  }
}
