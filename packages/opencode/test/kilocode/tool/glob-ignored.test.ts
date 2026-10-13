import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
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
import { parse, plan } from "../../../src/kilocode/tool/glob-ignored"
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

const ctx = {
  sessionID: SessionID.make("ses_glob_ignored"),
  messageID: MessageID.make("msg_glob_ignored"),
  callID: "",
  agent: "code",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

// The WASM ripgrep used in tests only applies directory patterns from the root .gitignore, so ignore folders.
const files = [
  "visible.txt",
  "build/out.txt",
  "build/node_modules/dep.txt",
  "node_modules/pkg/index.txt",
  "packages/a/dist/a.txt",
  "packages/b/dist/b.txt",
  "dist/root.txt",
  "out/keep.txt",
  "out/drop.txt",
  "src/main.txt",
  "src/gen/keep.txt",
  "src/gen/drop.txt",
  ".cache/hidden.txt",
  "build/notes.md",
]

const seed = (dir: string) =>
  Effect.promise(async () => {
    await Bun.write(path.join(dir, ".gitignore"), "build/\nnode_modules/\ndist/\nout/\nsrc/gen/\n")
    await Promise.all(files.map((file) => Bun.write(path.join(dir, file), `${file}\n`)))
    await fs.mkdir(path.join(dir, ".git"), { recursive: true })
    await Bun.write(path.join(dir, ".git", "probe.txt"), "git\n")
  })

const run = (pattern: string, dir?: string) =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    yield* seed(test.directory)
    const info = yield* GlobTool
    const glob = yield* info.init()
    const result = yield* glob.execute({ pattern, path: dir ? path.join(test.directory, dir) : test.directory }, ctx)
    return result.output
      .split("\n")
      .filter((line) => line.startsWith(test.directory))
      .map((line) => path.relative(test.directory, line))
      .sort()
  })

const config = (entries: string[]) => ({ git: true, config: { experimental: { glob_include_ignored: entries } } })

describe("Kilo glob include ignored", () => {
  test("parse drops negations, parent escapes, and match-everything patterns", () => {
    expect(["!dist", "../x", "*", "**", "**/*", "*/*", "dist/**/**", ""].map(parse)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      expect.anything(),
      undefined,
    ])
    expect(parse("dist/")?.anchored).toBe(false)
    expect(parse("/dist")?.anchored).toBe(true)
    expect(parse("packages/*/dist/**")?.parts).toEqual(["packages", "*", "dist"])
  })

  test("plan rewrites anchored entries for subdirectory searches and skips unrelated ones", () => {
    expect(plan(["packages/*/dist"], "/w", "/w")).toMatchObject({ include: ["/packages/*/dist/", "/packages/"] })
    expect(plan(["packages/*/dist"], "/w", "/w/packages")?.include).toEqual(["/*/dist/"])
    expect(plan(["packages/*/dist"], "/w", "/w/packages/a/dist")).toBeUndefined()
    expect(plan(["packages/*/dist"], "/w", "/w/src")).toBeUndefined()
    expect(plan(["dist"], "/w", "/elsewhere")).toBeUndefined()
    expect(plan(["dist", "**/gen"], "/w", "/w/src")).toMatchObject({ include: ["dist/", "**/gen/"], filter: undefined })
  })

  unix(
    "keeps the default results when nothing is configured",
    () =>
      Effect.gen(function* () {
        expect(yield* run("**/*.txt")).toEqual(["src/main.txt", "visible.txt"])
      }),
    { git: true },
  )

  unix(
    "searches a listed folder but not ignored folders nested inside it",
    () =>
      Effect.gen(function* () {
        expect(yield* run("**/*.txt")).toEqual(["build/out.txt", "src/main.txt", "visible.txt"])
      }),
    config(["build"]),
  )

  unix(
    "still applies the agent's pattern inside listed folders",
    () =>
      Effect.gen(function* () {
        expect(yield* run("**/*.md")).toEqual(["build/notes.md"])
        expect(yield* run("**/*.csv")).toEqual([])
      }),
    config(["build"]),
  )

  unix(
    "anchors patterns with a slash to the workspace root, also for subdirectory searches",
    () =>
      Effect.gen(function* () {
        expect(yield* run("**/*.txt")).toEqual([
          "packages/a/dist/a.txt",
          "packages/b/dist/b.txt",
          "src/main.txt",
          "visible.txt",
        ])
        expect(yield* run("**/*.txt", "packages")).toEqual(["packages/a/dist/a.txt", "packages/b/dist/b.txt"])
      }),
    config(["packages/*/dist"]),
  )

  unix(
    "includes only the listed file inside an ignored folder",
    () =>
      Effect.gen(function* () {
        expect(yield* run("**/*.txt")).toEqual(["out/keep.txt", "src/gen/keep.txt", "src/main.txt", "visible.txt"])
      }),
    config(["out/keep.txt", "src/gen/keep.txt"]),
  )

  unix(
    "searches listed hidden folders",
    () =>
      Effect.gen(function* () {
        expect(yield* run("**/*.txt")).toEqual([".cache/hidden.txt", "src/main.txt", "visible.txt"])
      }),
    config([".cache"]),
  )

  unix(
    "ignores match-everything entries and never searches .git",
    () =>
      Effect.gen(function* () {
        expect(yield* run("**/*.txt")).toEqual(["src/main.txt", "visible.txt"])
      }),
    config(["*", "**", "**/*", ".git", "!build"]),
  )
})
