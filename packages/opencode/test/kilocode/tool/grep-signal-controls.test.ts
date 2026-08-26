import { describe, expect } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Agent } from "../../../src/agent/agent"
import { Git } from "../../../src/git"
import { GrepTool } from "../../../src/tool/grep"
import { Truncate } from "../../../src/tool/truncate"
import { MessageID, SessionID } from "../../../src/session/schema"
import { TestInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([CrossSpawnSpawner.node, FSUtil.node, Ripgrep.node, Truncate.node, Agent.node, Git.node]),
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
  it.instance("preserves the default match output", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => Bun.write(file(test, "default.txt"), "before\nneedle\nafter\n"))
      const grep = yield* init
      const result = yield* grep
        .execute({ pattern: "needle", path: test.directory }, ctx)
        .pipe(Effect.timeout("30 seconds"))

      expect(result.metadata.matches).toBe(1)
      expect(result.output).toContain("Line 2: needle")
      expect(result.output).not.toContain("[match]")
    }),
  )

  it.instance("executes all signal controls and settles at the custom limit", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        Bun.write(
          file(test, "controls.txt"),
          ["regex before", "NEEDLEzzz", "regex after", "before", "NEEDLE.*", "after", "far", "needle.*"].join("\n") +
            "\n",
        ),
      )
      const grep = yield* init
      const result = yield* grep
        .execute(
          {
            pattern: "needle.*",
            path: test.directory,
            include: "*.txt",
            context: 1,
            limit: 1,
            literal: true,
            ignoreCase: true,
          },
          ctx,
        )
        .pipe(Effect.timeout("30 seconds"))

      expect(result.metadata).toEqual({ matches: 1, truncated: true })
      expect(result.output).toContain("[context] Line 4: before")
      expect(result.output).toContain("[match] Line 5: NEEDLE.*")
      expect(result.output).toContain("[context] Line 6: after")
      expect(result.output).not.toContain("NEEDLEzzz")
      expect(result.output).not.toContain("Line 7: far")
      expect(result.output).not.toContain("Line 8: needle.*")
      expect(result.output).toContain("1 matches limit reached. Use limit=2 for more, or refine pattern.")
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
      const result = yield* grep
        .execute({ pattern: "needle", path: test.directory, context: 1, limit: 100 }, ctx)
        .pipe(Effect.timeout("30 seconds"))

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
})
