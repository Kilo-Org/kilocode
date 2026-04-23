import { describe, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import os from "os"
import { Cause, Effect, Exit, Layer } from "effect"
import { GlobTool } from "../../src/tool/glob"
import { SessionID, MessageID } from "../../src/session/schema"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Ripgrep } from "../../src/file/ripgrep"
import { AppFileSystem } from "@opencode-ai/shared/filesystem"
import { Truncate } from "../../src/tool"
import { Agent } from "../../src/agent/agent"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    CrossSpawnSpawner.defaultLayer,
    AppFileSystem.defaultLayer,
    Ripgrep.defaultLayer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
  ),
)

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

describe("tool.glob", () => {
  it.live("matches files from a directory path", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => Bun.write(path.join(dir, "a.ts"), "export const a = 1\n"))
        yield* Effect.promise(() => Bun.write(path.join(dir, "b.txt"), "hello\n"))
        const info = yield* GlobTool
        const glob = yield* info.init()
        const result = yield* glob.execute(
          {
            pattern: "*.ts",
            path: dir,
          },
          ctx,
        )
        expect(result.metadata.count).toBe(1)
        expect(result.output).toContain(path.join(dir, "a.ts"))
        expect(result.output).not.toContain(path.join(dir, "b.txt"))
      }),
    ),
  )

  it.live("rejects exact file paths", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const file = path.join(dir, "a.ts")
        yield* Effect.promise(() => Bun.write(file, "export const a = 1\n"))
        const info = yield* GlobTool
        const glob = yield* info.init()
        const exit = yield* glob
          .execute(
            {
              pattern: "*.ts",
              path: file,
            },
            ctx,
          )
          .pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          const err = Cause.squash(exit.cause)
          expect(err instanceof Error ? err.message : String(err)).toContain("glob path must be a directory")
        }
      }),
    ),
  )

  // kilocode_change start - absolute glob patterns outside the project
  it.live("supports absolute glob patterns outside the project", () =>
    provideTmpdirInstance(
      (_dir) =>
        Effect.gen(function* () {
          const outer = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "glob-outer-")))
          yield* Effect.promise(() => Bun.write(path.join(outer, "one.md"), "one"))
          yield* Effect.promise(() => Bun.write(path.join(outer, "two.md"), "two"))
          yield* Effect.promise(() => Bun.write(path.join(outer, "three.txt"), "three"))
          const info = yield* GlobTool
          const glob = yield* info.init()
          const result = yield* glob.execute(
            {
              pattern: path.join(outer, "*.md"),
            },
            ctx,
          )
          expect(result.output).toContain(path.join(outer, "one.md"))
          expect(result.output).toContain(path.join(outer, "two.md"))
          expect(result.output).not.toContain(path.join(outer, "three.txt"))
        }),
      { git: true },
    ),
  )
  // kilocode_change end
})
