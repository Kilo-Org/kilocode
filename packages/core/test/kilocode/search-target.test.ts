import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Exit, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import * as SearchTarget from "@opencode-ai/core/kilocode/search-target"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(FSUtil.defaultLayer, Ripgrep.defaultLayer))
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

        const result = yield* (yield* Ripgrep.Service)
          .grep({ cwd: target, pattern: "secret", limit: 10, validate: SearchTarget.validate(fsys, approved) })
          .pipe(Effect.exit)

        expect(Exit.isFailure(result)).toBe(true)
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
