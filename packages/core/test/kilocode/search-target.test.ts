import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { FSUtil } from "@opencode-ai/core/fs-util"
import * as SearchTarget from "@opencode-ai/core/kilocode/search-target"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { RelativePath } from "@opencode-ai/core/schema"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(FSUtil.defaultLayer, AppNodeBuilder.build(Ripgrep.node)))
const withTmp = <A, E, R>(f: (dir: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => f(tmp.path)))

describe("search target confinement", () => {
  it.live("rejects a directory replaced before ripgrep spawn", () =>
    withTmp((tmp) =>
      Effect.gen(function* () {
        const target = path.join(tmp, "target")
        const moved = path.join(tmp, "moved")
        yield* Effect.promise(() => fs.mkdir(target))
        const fsys = yield* FSUtil.Service
        const approved = yield* SearchTarget.inspect(fsys, target)
        yield* Effect.promise(() => fs.rename(target, moved))
        yield* Effect.promise(() => fs.mkdir(target))
        yield* Effect.promise(() => fs.writeFile(path.join(target, "secret.txt"), "secret"))

        const ripgrep = yield* Ripgrep.Service
        const input = { cwd: target, pattern: "secret", limit: 10, validate: SearchTarget.validate(fsys, approved) }
        expect(Exit.isFailure(yield* ripgrep.find(input).pipe(Effect.exit))).toBe(true)
        expect(Exit.isFailure(yield* ripgrep.glob(input).pipe(Effect.exit))).toBe(true)
        expect(Exit.isFailure(yield* ripgrep.grep(input).pipe(Effect.exit))).toBe(true)
      }),
    ),
  )

  it.live("shares active listings and drops them when requests finish", () =>
    withTmp((tmp) =>
      Effect.gen(function* () {
        const fsys = yield* FSUtil.Service
        const ripgrep = yield* Ripgrep.Service
        const target = yield* SearchTarget.inspect(fsys, tmp)
        const started = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        let calls = 0
        const list = yield* SearchTarget.listing(
          fsys,
          {
            ...ripgrep,
            find: () =>
              Effect.gen(function* () {
                calls++
                yield* Deferred.succeed(started, undefined)
                yield* Deferred.await(release)
                return [{ path: RelativePath.make(`scan-${calls}.ts`), type: "file" as const }]
              }),
          },
          100_000,
        )
        expect(calls).toBe(0)
        const one = yield* Scope.make()
        const two = yield* Scope.make()
        const first = yield* Scope.provide(one)(list(target)).pipe(Effect.forkChild)
        yield* Deferred.await(started)
        const second = yield* Scope.provide(two)(list({ ...target })).pipe(Effect.forkChild)
        yield* Deferred.succeed(release, undefined)
        const results = yield* Effect.all([Fiber.join(first), Fiber.join(second)])
        expect(calls).toBe(1)
        expect(results.map((items) => String(items[0].path))).toEqual(["scan-1.ts", "scan-1.ts"])
        yield* Scope.close(one, Exit.void)
        yield* Scope.close(two, Exit.void)
        const fresh = yield* list(target).pipe(Effect.scoped)
        expect(calls).toBe(2)
        expect(String(fresh[0].path)).toBe("scan-2.ts")
      }),
    ),
  )

  it.live("interrupts an abandoned file scan", () =>
    withTmp((tmp) =>
      Effect.gen(function* () {
        const fsys = yield* FSUtil.Service
        const ripgrep = yield* Ripgrep.Service
        const target = yield* SearchTarget.inspect(fsys, tmp)
        const started = yield* Deferred.make<void>()
        const stopped = yield* Deferred.make<void>()
        const list = yield* SearchTarget.listing(
          fsys,
          {
            ...ripgrep,
            find: () =>
              Deferred.succeed(started, undefined).pipe(
                Effect.andThen(Effect.never),
                Effect.onInterrupt(() => Deferred.succeed(stopped, undefined)),
              ),
          },
          100_000,
        )
        const pending = yield* list(target).pipe(Effect.scoped, Effect.forkChild)
        yield* Deferred.await(started)
        yield* Fiber.interrupt(pending)
        yield* Deferred.await(stopped).pipe(Effect.timeout("5 seconds"))
      }),
    ),
  )

  it.live("does not start a second listing for a replaced directory while one is active", () =>
    withTmp((tmp) =>
      Effect.gen(function* () {
        const fsys = yield* FSUtil.Service
        const ripgrep = yield* Ripgrep.Service
        const target = yield* SearchTarget.inspect(fsys, tmp)
        let calls = 0
        const list = yield* SearchTarget.listing(
          fsys,
          {
            ...ripgrep,
            find: () =>
              Effect.sync(() => {
                calls++
                return []
              }),
          },
          100_000,
        )
        const scope = yield* Scope.make()
        yield* Scope.provide(scope)(list(target))
        const changed = yield* list({ ...target, ino: target.ino + 1 }).pipe(Effect.scoped, Effect.exit)
        expect(Exit.isFailure(changed)).toBe(true)
        expect(calls).toBe(1)
        yield* Scope.close(scope, Exit.void)
      }),
    ),
  )

  it.live("recognizes only real managed output files", () =>
    withTmp((tmp) =>
      Effect.gen(function* () {
        const directory = path.join(tmp, "tool-output")
        const retained = path.join(directory, "tool_123")
        const unrelated = path.join(directory, "notes.txt")
        yield* Effect.promise(() => fs.mkdir(directory))
        yield* Effect.promise(() => fs.writeFile(retained, "retained"))
        yield* Effect.promise(() => fs.writeFile(unrelated, "unrelated"))
        const fsys = yield* FSUtil.Service

        expect(yield* SearchTarget.managed(fsys, tmp, yield* SearchTarget.inspect(fsys, retained))).toBe(true)
        expect(yield* SearchTarget.managed(fsys, tmp, yield* SearchTarget.inspect(fsys, unrelated))).toBe(false)
      }),
    ),
  )
})
