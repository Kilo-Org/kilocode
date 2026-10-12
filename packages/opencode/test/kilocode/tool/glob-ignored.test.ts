import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Cause, Effect, Exit } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Agent } from "../../../src/agent/agent"
import { Config } from "../../../src/config/config"
import { Git } from "../../../src/git"
import { GlobTool } from "../../../src/tool/glob"
import { Truncate } from "../../../src/tool/truncate"
import { MessageID, SessionID } from "../../../src/session/schema"
import { TestInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      CrossSpawnSpawner.node,
      FSUtil.node,
      Ripgrep.node,
      Truncate.node,
      Agent.node,
      Git.node,
      Config.node,
    ]),
  ),
)

// Windows CI skips glob tool tests that depend on ripgrep path output (#9496).
const unix = process.platform !== "win32" ? it.instance : it.instance.skip

const context = (asked: string[] = []) => ({
  sessionID: SessionID.make("ses_glob_ignored"),
  messageID: MessageID.make("msg_glob_ignored"),
  callID: "",
  agent: "code",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: (input: { permission: string }) =>
    Effect.sync(() => {
      asked.push(input.permission)
    }),
})

// The WASM ripgrep used in tests only applies directory patterns from the root .gitignore, so use `build/`.
const seed = (dir: string) =>
  Effect.promise(async () => {
    await fs.mkdir(path.join(dir, "build"), { recursive: true })
    await Bun.write(path.join(dir, ".gitignore"), "build/\n")
    await Bun.write(path.join(dir, "build", "ignored.txt"), "ignored\n")
    await Bun.write(path.join(dir, ".cache", "hidden.txt"), "hidden\n")
    await Bun.write(path.join(dir, "visible.txt"), "visible\n")
    await Bun.write(path.join(dir, ".git", "probe.txt"), "git\n")
  })

const init = Effect.gen(function* () {
  const info = yield* GlobTool
  return yield* info.init()
})

describe("Kilo glob includeIgnored", () => {
  unix(
    "respects ignore files and skips hidden directories without includeIgnored",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* seed(test.directory)
        const glob = yield* init
        const result = yield* glob.execute({ pattern: "**/*.txt", path: test.directory }, context())
        expect(result.output).toContain(path.join(test.directory, "visible.txt"))
        expect(result.output).not.toContain("ignored.txt")
        expect(result.output).not.toContain("hidden.txt")
      }),
    { git: true, config: { experimental: { glob_search_ignored: true } } },
  )

  unix(
    "rejects includeIgnored before prompting when the setting is off",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* seed(test.directory)
        const asked: string[] = []
        const glob = yield* init
        const exit = yield* glob
          .execute({ pattern: "**/*.txt", path: test.directory, includeIgnored: true }, context(asked))
          .pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          const err = Cause.squash(exit.cause)
          expect(err instanceof Error ? err.message : String(err)).toContain("experimental.glob_search_ignored")
        }
        expect(asked).toEqual([])
      }),
    { git: true },
  )

  unix(
    "includes ignored files and hidden directories but never .git when the setting is on",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* seed(test.directory)
        const asked: string[] = []
        const glob = yield* init
        const result = yield* glob.execute(
          { pattern: "**/*.txt", path: test.directory, includeIgnored: true },
          context(asked),
        )
        expect(result.output).toContain(path.join(test.directory, "visible.txt"))
        expect(result.output).toContain(path.join(test.directory, "build", "ignored.txt"))
        expect(result.output).toContain(path.join(test.directory, ".cache", "hidden.txt"))
        expect(result.output).not.toContain("probe.txt")
        expect(asked).toEqual(["glob"])
      }),
    { git: true, config: { experimental: { glob_search_ignored: true } } },
  )
})
