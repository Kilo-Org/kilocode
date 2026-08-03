import { describe, expect } from "bun:test"
import { Effect, Exit, Layer, Schema } from "effect"
import path from "path"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Agent } from "../../../src/agent/agent"
import { Git } from "../../../src/git"
import { GrepTool, Parameters } from "../../../src/tool/grep"
import { Truncate } from "../../../src/tool/truncate"
import { MessageID, SessionID } from "../../../src/session/schema"
import { TestInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    CrossSpawnSpawner.defaultLayer,
    FSUtil.defaultLayer,
    Ripgrep.defaultLayer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
    Git.defaultLayer,
  ),
)

const ctx = {
  sessionID: SessionID.make("ses_grep_signal_controls"),
  messageID: MessageID.make("msg_grep_signal_controls"),
  callID: "",
  agent: "code",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const file = (test: { readonly directory: string }, name: string) => path.join(test.directory, name)

const init = Effect.gen(function* () {
  const info = yield* GrepTool
  return yield* info.init()
})

describe("Kilo grep signal-to-noise controls", () => {
  it.effect("validates signal controls", () =>
    Effect.sync(() => {
      expect(Schema.decodeUnknownSync(Parameters)({ pattern: "needle", context: 0, limit: 1 })).toMatchObject({
        context: 0,
        limit: 1,
      })
      expect(() => Schema.decodeUnknownSync(Parameters)({ pattern: "needle", context: -1 })).toThrow()
      expect(() => Schema.decodeUnknownSync(Parameters)({ pattern: "needle", limit: 0 })).toThrow()
      expect(() => Schema.decodeUnknownSync(Parameters)({ pattern: "needle", limit: 1.5 })).toThrow()
    }),
  )

  it.instance("preserves the default match output", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => Bun.write(file(test, "default.txt"), "before\nneedle\nafter\n"))
      const grep = yield* init
      const result = yield* grep.execute({ pattern: "needle", path: test.directory }, ctx)

      expect(result.metadata.matches).toBe(1)
      expect(result.output).toContain("Line 2: needle")
      expect(result.output).not.toContain("[match]")
    }),
  )

  it.instance("stops after the custom match limit", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        Bun.write(file(test, "many.txt"), `${Array.from({ length: 20 }, () => "needle").join("\n")}\n`),
      )
      const grep = yield* init
      const result = yield* grep.execute({ pattern: "needle", path: test.directory, limit: 2 }, ctx)

      expect(result.metadata.matches).toBe(2)
      expect(result.metadata.truncated).toBe(true)
      expect(result.output).toContain("2 matches limit reached. Use limit=4 for more, or refine pattern.")
      expect(result.output).not.toContain("(Results truncated")
      expect(result.output).not.toContain("Line 3: needle")
    }),
  )

  it.instance("supports literal and case-insensitive matching", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        Promise.all([
          Bun.write(file(test, "literal.txt"), "a.*b\n"),
          Bun.write(file(test, "regex.txt"), "azb\n"),
          Bun.write(file(test, "case.txt"), "Needle\n"),
        ]),
      )
      const grep = yield* init
      const literal = yield* grep.execute({ pattern: "a.*b", path: test.directory, literal: true }, ctx)
      const insensitive = yield* grep.execute({ pattern: "needle", path: test.directory, ignoreCase: true }, ctx)

      expect(literal.metadata.matches).toBe(1)
      expect(literal.output).toContain("literal.txt")
      expect(literal.output).not.toContain("regex.txt")
      expect(insensitive.metadata.matches).toBe(1)
      expect(insensitive.output).toContain("case.txt")
    }),
  )

  it.instance("formats only bounded context around returned matches", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        Bun.write(
          file(test, "context.txt"),
          ["before", "needle", "after", "far", "later needle", "later after"].join("\n") + "\n",
        ),
      )
      const grep = yield* init
      const result = yield* grep.execute({ pattern: "needle", path: test.directory, context: 1, limit: 1 }, ctx)

      expect(result.metadata.matches).toBe(1)
      expect(result.output).toContain("[context] Line 1: before")
      expect(result.output).toContain("[match] Line 2: needle")
      expect(result.output).toContain("[context] Line 3: after")
      expect(result.output).not.toContain("Line 4: far")
      expect(result.output).not.toContain("later needle")
    }),
  )

  it.instance("does not count context lines toward the match limit", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const content = Array.from(
        { length: 35 },
        (_, index) => `before-${index}\nneedle-${index}\nafter-${index}\ngap-${index}`,
      ).join("\n")
      yield* Effect.promise(() => Bun.write(file(test, "context-limit.txt"), `${content}\n`))
      const grep = yield* init
      const result = yield* grep.execute({ pattern: "needle", path: test.directory, context: 1, limit: 100 }, ctx)

      expect(result.metadata.matches).toBe(35)
      expect(result.metadata.truncated).toBe(false)
      expect(result.output).toContain("needle-34")
      expect(result.output).not.toContain("matches limit reached")
    }),
  )

  it.instance("guides the model to read truncated lines", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => Bun.write(file(test, "long.txt"), `${"x".repeat(2_100)}needle\n`))
      const grep = yield* init
      const result = yield* grep.execute({ pattern: "needle", path: test.directory }, ctx)

      expect(result.metadata.matches).toBe(1)
      expect(result.output).toContain("Some matching or context lines were truncated. Use read for full lines.")
    }),
  )

  it.instance("retains include filtering", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        Promise.all([
          Bun.write(file(test, "included.ts"), "needle\n"),
          Bun.write(file(test, "excluded.txt"), "needle\n"),
        ]),
      )
      const grep = yield* init
      const result = yield* grep.execute({ pattern: "needle", path: test.directory, include: "*.ts" }, ctx)

      expect(result.metadata.matches).toBe(1)
      expect(result.output).toContain("included.ts")
      expect(result.output).not.toContain("excluded.txt")
    }),
  )

  it.instance("honors cancellation", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => Bun.write(file(test, "cancel.txt"), "needle\n".repeat(10_000)))
      const grep = yield* init
      const controller = new AbortController()
      controller.abort()
      const exit = yield* grep
        .execute({ pattern: "needle", path: test.directory }, { ...ctx, abort: controller.signal })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )
})
