import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { Ripgrep } from "@opencode/core/ripgrep"
import { tmpdir } from "../fixture/tmpdir"
import { tempLocationLayer } from "../fixture/location"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(Ripgrep.node, [Location.node.replace(tempLocationLayer)]))

describe("Ripgrep non-UTF-8 matches", () => {
  // A non-UTF-8 path cannot be created portably on Windows, so only the line and submatch bytes shapes have tests.
  it.live("decodes base64 bytes as lossy UTF-8", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          // "needle:" followed by a raw Latin-1 a-umlaut byte, which ripgrep reports as base64 bytes.
          yield* Effect.promise(() =>
            fs.writeFile(
              path.join(tmp.path, "latin1.txt"),
              Buffer.from([0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0x3a, 0xe4, 0x0a]),
            ),
          )

          const ripgrep = yield* Ripgrep.Service
          const matches = yield* ripgrep.grep({ cwd: tmp.path, pattern: "needle", limit: 10 })

          expect(matches).toHaveLength(1)
          expect(matches[0]?.text).toBe("needle:\uFFFD\n")
          expect(matches[0]?.submatches).toEqual([{ text: "needle", start: 0, end: 6 }])
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("decodes base64 submatch bytes as lossy UTF-8", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            fs.writeFile(path.join(tmp.path, "latin1.txt"), Buffer.from([0x6e, 0x65, 0x65, 0x64, 0xe4, 0x0a])),
          )

          const ripgrep = yield* Ripgrep.Service
          const matches = yield* ripgrep.grep({ cwd: tmp.path, pattern: "(?-u:.)", limit: 10 })

          expect(matches).toHaveLength(1)
          expect(matches[0]?.submatches.at(-1)).toEqual({ text: "\uFFFD", start: 4, end: 5 })
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})
