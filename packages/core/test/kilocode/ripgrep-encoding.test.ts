import { describe, expect } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(Ripgrep.node))

// "Handläggning" with a raw Latin-1 "ä" (0xE4), which is not valid UTF-8
const latin = Buffer.concat([Buffer.from('title = "Handl'), Buffer.from([0xe4]), Buffer.from('ggning"\n')])

const search = (input: { readonly content: Buffer; readonly pattern: string; readonly context?: number }) =>
  Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    (tmp) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "legacy.java"), input.content))
        return yield* (yield* Ripgrep.Service).grep({
          cwd: tmp.path,
          pattern: input.pattern,
          context: input.context,
          limit: 10,
        })
      }),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

describe("Ripgrep non-UTF-8 output", () => {
  it.live("replaces non-UTF-8 bytes with U+FFFD", () =>
    Effect.gen(function* () {
      const result = yield* search({ content: latin, pattern: "Handl" })
      expect(result.items).toHaveLength(1)
      // 0xE4 is not valid UTF-8 on its own, so it becomes the replacement character
      expect(result.items[0]?.text).toBe('title = "Handl\uFFFDggning"\n')
      expect(result.items[0]?.submatches).toEqual([{ text: "Handl", start: 9, end: 14 }])
    }),
  )

  it.live("replaces non-UTF-8 bytes in submatches with U+FFFD", () =>
    Effect.gen(function* () {
      // Unicode `.` never matches an invalid UTF-8 byte; a byte-level class does
      const result = yield* search({ content: latin, pattern: "Handl(?-u:.)ggning" })
      expect(result.items[0]?.submatches).toEqual([{ text: "Handl\uFFFDggning", start: 9, end: 21 }])
    }),
  )

  it.live("replaces each invalid byte with its own U+FFFD", () =>
    Effect.gen(function* () {
      const result = yield* search({
        content: Buffer.concat([Buffer.from("price "), Buffer.from([0x80, 0x93]), Buffer.from(" needle\n")]),
        pattern: "needle",
      })
      expect(result.items[0]?.text).toBe("price \uFFFD\uFFFD needle\n")
    }),
  )

  it.live("replaces non-UTF-8 bytes in context lines", () =>
    Effect.gen(function* () {
      const result = yield* search({
        content: Buffer.concat([latin, Buffer.from("needle\n")]),
        pattern: "needle",
        context: 1,
      })
      expect(result.items.map((item) => item.text)).toEqual(['title = "Handl\uFFFDggning"\n', "needle\n"])
      expect(result.items.map((item) => item.context)).toEqual([true, false])
    }),
  )
})
