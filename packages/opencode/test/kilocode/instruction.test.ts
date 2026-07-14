// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect, FileSystem, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { NodeFileSystem } from "@effect/platform-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { KilocodeInstruction } from "../../src/kilocode/session/instruction"
import { Instruction } from "../../src/session/instruction"
import { MessageID } from "../../src/session/schema"
import { Global } from "@opencode-ai/core/global"
import { TestConfig } from "../fixture/config"
import { provideInstance, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(CrossSpawnSpawner.defaultLayer, NodeFileSystem.layer, RuntimeFlags.layer(), testInstanceStoreLayer),
)

const instructionLayer = (
  global: Partial<Global.Interface>,
  config: Partial<Config.Info> = {},
  flags: Partial<RuntimeFlags.Info> = {},
) =>
  Instruction.layer.pipe(
    Layer.provide(TestConfig.layer({ get: () => Effect.succeed(config) })),
    Layer.provide(FSUtil.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Global.layerWith(global)),
    Layer.provide(RuntimeFlags.layer(flags)),
  )

const provideInstruction =
  (global: Partial<Global.Interface>, config?: Partial<Config.Info>, flags?: Partial<RuntimeFlags.Info>) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(Effect.provide(instructionLayer(global, config, flags)))

const write = (filepath: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.makeDirectory(path.dirname(filepath), { recursive: true })
    yield* fs.writeFileString(filepath, content)
  })

const writeFiles = (dir: string, files: Record<string, string>) =>
  Effect.all(
    Object.entries(files).map(([file, content]) => write(path.join(dir, file), content)),
    { discard: true },
  )

const tmpWithFiles = (files: Record<string, string>) =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    yield* writeFiles(dir, files)
    return dir
  })

const withConfigDir =
  (value: string | undefined) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const original = process.env["KILO_CONFIG_DIR"]
      if (value === undefined) delete process.env["KILO_CONFIG_DIR"]
      else process.env["KILO_CONFIG_DIR"] = value
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (original === undefined) delete process.env["KILO_CONFIG_DIR"]
          else process.env["KILO_CONFIG_DIR"] = original
        }),
      )
      return yield* self
    })

describe("Instruction.systemPaths KILO_CONFIG_DIR profile fallback", () => {
  it.live("prefers KILO_CONFIG_DIR AGENTS.md over global when both exist", () =>
    Effect.gen(function* () {
      const profileTmp = yield* tmpWithFiles({ "AGENTS.md": "# Profile Instructions" })
      const globalTmp = yield* tmpWithFiles({ "AGENTS.md": "# Global Instructions" })
      const projectTmp = yield* tmpdirScoped()

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const paths = yield* svc.systemPaths()
        expect(paths.has(path.join(profileTmp, "AGENTS.md"))).toBe(true)
        expect(paths.has(path.join(globalTmp, "AGENTS.md"))).toBe(false)
      }).pipe(
        provideInstance(projectTmp),
        provideInstruction({ home: globalTmp, config: globalTmp }),
        withConfigDir(profileTmp),
      )
    }),
  )

  it.live("falls back to global AGENTS.md when KILO_CONFIG_DIR has no AGENTS.md", () =>
    Effect.gen(function* () {
      const profileTmp = yield* tmpdirScoped()
      const globalTmp = yield* tmpWithFiles({ "AGENTS.md": "# Global Instructions" })
      const projectTmp = yield* tmpdirScoped()

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const paths = yield* svc.systemPaths()
        expect(paths.has(path.join(profileTmp, "AGENTS.md"))).toBe(false)
        expect(paths.has(path.join(globalTmp, "AGENTS.md"))).toBe(true)
      }).pipe(
        provideInstance(projectTmp),
        provideInstruction({ home: globalTmp, config: globalTmp }),
        withConfigDir(profileTmp),
      )
    }),
  )

  it.live("uses global AGENTS.md when KILO_CONFIG_DIR is not set", () =>
    Effect.gen(function* () {
      const globalTmp = yield* tmpWithFiles({ "AGENTS.md": "# Global Instructions" })
      const projectTmp = yield* tmpdirScoped()

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const paths = yield* svc.systemPaths()
        expect(paths.has(path.join(globalTmp, "AGENTS.md"))).toBe(true)
      }).pipe(
        provideInstance(projectTmp),
        provideInstruction({ home: globalTmp, config: globalTmp }),
        withConfigDir(undefined),
      )
    }),
  )
})

describe("path-scoped instruction rules", () => {
  it.live("loads unscoped configured Markdown at startup", () =>
    Effect.gen(function* () {
      const dir = yield* tmpWithFiles({ "rules/global.md": "# Global Rule" })
      const item = path.join(dir, "rules", "global.md")

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        expect(yield* svc.system()).toEqual([`Instructions from: ${item}\n# Global Rule`])
      }).pipe(provideInstance(dir), provideInstruction({ home: dir, config: dir }, { instructions: [item] }))
    }),
  )

  it.live("excludes scoped rules from startup and injects matching rules once", () =>
    Effect.gen(function* () {
      const dir = yield* tmpWithFiles({
        "rules/api.md": ["---", "paths:", "  - src/api/**/*.{ts,tsx}", "---", "", "# API Rule"].join("\n"),
        "src/api/user.ts": "export const user = true",
      })
      const rule = path.join(dir, "rules", "api.md")
      const target = path.join(dir, "src", "api", "user.ts")

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const id = MessageID.make("msg_scoped-rule-1")
        expect((yield* svc.systemPaths()).has(rule)).toBe(false)
        expect(yield* svc.system()).toEqual([])

        const first = yield* svc.resolve([], target, id)
        const second = yield* svc.resolve([], target, id)
        expect(first).toHaveLength(1)
        expect(first[0].filepath).toBe(rule)
        expect(first[0].content).toContain("# API Rule")
        expect(first[0].content).not.toContain("paths:")
        expect(second).toEqual([])
      }).pipe(
        provideInstance(dir),
        provideInstruction({ home: dir, config: dir }, { instructions: [path.join(dir, "rules", "*.md")] }),
      )
    }),
  )

  it.live("does not inject scoped rules for non-matching files", () =>
    Effect.gen(function* () {
      const dir = yield* tmpWithFiles({
        "rules/api.md": ["---", "paths: src/api/**/*.ts", "---", "", "# API Rule"].join("\n"),
        "src/ui/view.ts": "export const view = true",
      })
      const rule = path.join(dir, "rules", "api.md")

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        expect(
          yield* svc.resolve([], path.join(dir, "src", "ui", "view.ts"), MessageID.make("msg_scoped-rule-2")),
        ).toEqual([])
      }).pipe(provideInstance(dir), provideInstruction({ home: dir, config: dir }, { instructions: [rule] }))
    }),
  )

  test("matches valid worktree paths whose names begin with two dots", () => {
    const root = path.resolve("workspace")
    expect(KilocodeInstruction.match(["**/*.ts"], path.join(root, "..generated", "file.ts"), root)).toBe(true)
    expect(KilocodeInstruction.match(["**/*.ts"], path.resolve(root, "..", "outside.ts"), root)).toBe(false)
  })

  it.live("keeps conventional instruction files on the existing raw path", () =>
    Effect.gen(function* () {
      for (const name of ["AGENTS.md", "CLAUDE.md"]) {
        const dir = yield* tmpWithFiles({
          [name]: ["---", "paths: src/api/**/*.ts", "---", "", "# Project Instructions"].join("\n"),
        })

        yield* Effect.gen(function* () {
          const svc = yield* Instruction.Service
          const rules = yield* svc.system()
          expect(rules).toHaveLength(1)
          expect(rules[0]).toContain("paths: src/api/**/*.ts")
        }).pipe(provideInstance(dir), provideInstruction({ home: dir, config: dir }))
      }
    }),
  )

  it.live("falls back to raw startup instructions for malformed frontmatter", () =>
    Effect.gen(function* () {
      const dir = yield* tmpWithFiles({
        "rules/raw.md": ["---", "paths: [unterminated", "---", "", "# Raw Rule"].join("\n"),
      })
      const item = path.join(dir, "rules", "raw.md")

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const rules = yield* svc.system()
        expect(rules).toHaveLength(1)
        expect(rules[0]).toContain("paths: [unterminated")
        expect(rules[0]).toContain("# Raw Rule")
      }).pipe(provideInstance(dir), provideInstruction({ home: dir, config: dir }, { instructions: [item] }))
    }),
  )

  it.live("discovers Claude rules only when compatibility is enabled", () =>
    Effect.gen(function* () {
      const home = yield* tmpWithFiles({ ".claude/rules/global.md": "# Global Claude Rule" })
      const dir = yield* tmpWithFiles({
        ".claude/rules/project.md": ["---", "paths: src/**/*.ts", "---", "", "# Project Claude Rule"].join("\n"),
        "src/file.ts": "export const value = 1",
      })

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        expect((yield* svc.system()).join("\n")).toContain("# Global Claude Rule")
        const rules = yield* svc.resolve([], path.join(dir, "src", "file.ts"), MessageID.make("msg_scoped-rule-3"))
        expect(rules).toHaveLength(1)
        expect(rules[0].content).toContain("# Project Claude Rule")
      }).pipe(provideInstance(dir), provideInstruction({ home, config: home }))

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        expect(yield* svc.system()).toEqual([])
        expect(yield* svc.resolve([], path.join(dir, "src", "file.ts"), MessageID.make("msg_scoped-rule-4"))).toEqual(
          [],
        )
      }).pipe(provideInstance(dir), provideInstruction({ home, config: home }, {}, { disableClaudeCodePrompt: true }))

      yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          const value = process.env.KILO_DISABLE_PROJECT_CONFIG
          process.env.KILO_DISABLE_PROJECT_CONFIG = "true"
          return value
        }),
        () =>
          Effect.gen(function* () {
            const svc = yield* Instruction.Service
            expect((yield* svc.system()).join("\n")).toContain("# Global Claude Rule")
            expect(
              yield* svc.resolve([], path.join(dir, "src", "file.ts"), MessageID.make("msg_scoped-rule-5")),
            ).toEqual([])
          }).pipe(provideInstance(dir), provideInstruction({ home, config: home })),
        (value) =>
          Effect.sync(() => {
            if (value === undefined) delete process.env.KILO_DISABLE_PROJECT_CONFIG
            else process.env.KILO_DISABLE_PROJECT_CONFIG = value
          }),
      )
    }),
  )
})
