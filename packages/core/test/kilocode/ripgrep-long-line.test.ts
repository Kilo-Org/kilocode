import { describe, expect } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { RelativePath } from "@opencode-ai/core/schema"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(Ripgrep.node))

// A matched line longer than 64 KiB, like a minified bundle or a source map
const bundle = `needle${"x".repeat(70 * 1024)}\n`

describe("Ripgrep long lines", () => {
  it.live("returns a bounded preview for matches on oversized lines", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "bundle.min.js"), bundle))
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "source.ts"), "const needle = 1\n"))

          const result = yield* (yield* Ripgrep.Service).grep({ cwd: tmp.path, pattern: "needle", limit: 10 })

          const items = result.items.toSorted((a, b) => a.entry.path.localeCompare(b.entry.path))
          expect(items.map((item) => item.entry.path)).toEqual([
            RelativePath.make("bundle.min.js"),
            RelativePath.make("source.ts"),
          ])
          expect(items[0]?.text).toHaveLength(2_003)
          expect(items[0]?.text.endsWith("...")).toBe(true)
          expect(items[0]?.textTruncated).toBe(true)
          expect(items[0]?.submatches).toEqual([{ text: "needle", start: 0, end: 6 }])
          expect(items[1]?.text).toBe("const needle = 1\n")
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("keeps oversized context lines from failing the search", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            fs.writeFile(path.join(tmp.path, "data.json"), `needle\n${"x".repeat(70 * 1024)}\n`),
          )

          const result = yield* (yield* Ripgrep.Service).grep({
            cwd: tmp.path,
            pattern: "needle",
            context: 1,
            limit: 10,
          })

          expect(result.items.map((item) => [item.line, item.context])).toEqual([
            [1, false],
            [2, true],
          ])
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})
