import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ReadToolFileSystem } from "@opencode-ai/core/tool/read-filesystem"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(FSUtil.defaultLayer)

function withTmp<A, E, R>(f: (dir: string) => Effect.Effect<A, E, R>) {
  return Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => f(tmp.path)))
}

describe("ReadToolFileSystem", () => {
  it.live("rejects a target replaced by a symlink after inspection", () =>
    withTmp((dir) =>
      Effect.gen(function* () {
        if (process.platform === "win32") return
        const file = path.join(dir, "approved.txt")
        const moved = path.join(dir, "moved.txt")
        const secret = path.join(dir, "secret.txt")
        yield* Effect.promise(() => Promise.all([fs.writeFile(file, "approved"), fs.writeFile(secret, "secret")]))
        const util = yield* FSUtil.Service
        const target = yield* ReadToolFileSystem.inspect(util, file)

        yield* Effect.promise(async () => {
          await fs.rename(file, moved)
          await fs.symlink(secret, file)
        })
        const exit = yield* ReadToolFileSystem.read(util, target, "approved.txt").pipe(Effect.exit)

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          const errors = Cause.prettyErrors(exit.cause).map((err) => err.message)
          expect(errors).toContain("Path changed after approval")
        }
      }),
    ),
  )

  it.live("stops after the first extra line establishes a continuation", () =>
    withTmp((dir) =>
      Effect.gen(function* () {
        const file = path.join(dir, "large.txt")
        yield* Effect.promise(() => fs.writeFile(file, `first\nsecond\n${"x".repeat(70 * 1024)}\0`))
        const util = yield* FSUtil.Service
        const target = yield* ReadToolFileSystem.inspect(util, file)
        const page = yield* ReadToolFileSystem.read(util, target, "large.txt", { limit: 1 })

        expect(page).toMatchObject({
          type: "text-page",
          content: "first",
          offset: 1,
          truncated: true,
          next: 2,
        })
      }),
    ),
  )
})
