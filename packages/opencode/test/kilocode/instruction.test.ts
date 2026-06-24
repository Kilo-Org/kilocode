import { describe, expect } from "bun:test"
import path from "path"
import { Effect, FileSystem, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { NodeFileSystem } from "@effect/platform-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Reference } from "../../src/reference/reference"
import { Instruction } from "../../src/session/instruction"
import { MessageID } from "../../src/session/schema"
import { Global } from "@opencode-ai/core/global"
import { TestConfig } from "../fixture/config"
import { provideInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const reference = Layer.mock(Reference.Service)({
  init: () => Effect.void,
  list: () => Effect.succeed([]),
  get: () => Effect.succeed(undefined),
  ensure: () => Effect.void,
  contains: () => Effect.succeed(false),
})
const it = testEffect(
  Layer.mergeAll(CrossSpawnSpawner.defaultLayer, NodeFileSystem.layer, reference, RuntimeFlags.layer()),
)

const instructionLayer = (
  global: Partial<Global.Interface>,
  config: Partial<Config.Info> = {},
  flags: Partial<RuntimeFlags.Info> = {},
) =>
  Instruction.layer.pipe(
    Layer.provide(TestConfig.layer({ get: () => Effect.succeed(config) })),
    Layer.provide(AppFileSystem.defaultLayer),
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

const withEnv =
  (name: string, value: string | undefined) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const previous = process.env[name]
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
        return previous
      }),
      () => self,
      (previous) =>
        Effect.sync(() => {
          if (previous === undefined) delete process.env[name]
          else process.env[name] = previous
        }),
    )

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
  it.live("loads unscoped configured local Markdown rules at startup", () =>
    Effect.gen(function* () {
      const dir = yield* tmpWithFiles({ "rules/global.md": "# Global Rule" })

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const rules = yield* svc.system()

        expect(rules).toEqual([`Instructions from: ${path.join(dir, "rules", "global.md")}\n# Global Rule`])
      }).pipe(
        provideInstance(dir),
        provideInstruction({ home: dir, config: dir }, { instructions: [path.join(dir, "rules", "global.md")] }),
      )
    }),
  )

  it.live("excludes configured rules with paths frontmatter from startup", () =>
    Effect.gen(function* () {
      const dir = yield* tmpWithFiles({
        "rules/api.md": ["---", "paths:", "  - src/api/**/*.ts", "---", "", "# API Rule"].join("\n"),
      })

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const paths = yield* svc.systemPaths()
        const rules = yield* svc.system()

        expect(paths.has(path.join(dir, "rules", "api.md"))).toBe(false)
        expect(rules).toEqual([])
      }).pipe(
        provideInstance(dir),
        provideInstruction({ home: dir, config: dir }, { instructions: [path.join(dir, "rules", "api.md")] }),
      )
    }),
  )

  it.live("injects matching configured path-scoped rules and strips frontmatter", () =>
    Effect.gen(function* () {
      const dir = yield* tmpWithFiles({
        "rules/api.md": [
          "---",
          "paths:",
          "  - src/api/**/*.{ts,tsx}",
          "  - tests/**/*.test.ts",
          "---",
          "",
          "# API Rule",
        ].join("\n"),
        "src/api/user.ts": "export const user = true",
      })

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const results = yield* svc.resolve(
          [],
          path.join(dir, "src", "api", "user.ts"),
          MessageID.make("msg_message-scoped-1"),
        )

        expect(results).toHaveLength(1)
        expect(results[0].filepath).toBe(path.join(dir, "rules", "api.md"))
        expect(results[0].content).toContain("# API Rule")
        expect(results[0].content).not.toContain("paths:")
        expect(results[0].content).not.toContain("---")
      }).pipe(
        provideInstance(dir),
        provideInstruction({ home: dir, config: dir }, { instructions: [path.join(dir, "rules", "*.md")] }),
      )
    }),
  )

  it.live("does not inject non-matching path-scoped rules", () =>
    Effect.gen(function* () {
      const dir = yield* tmpWithFiles({
        "rules/api.md": ["---", "paths: src/api/**/*.ts", "---", "", "# API Rule"].join("\n"),
        "src/ui/view.ts": "export const view = true",
      })

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const results = yield* svc.resolve(
          [],
          path.join(dir, "src", "ui", "view.ts"),
          MessageID.make("msg_message-scoped-2"),
        )

        expect(results).toEqual([])
      }).pipe(
        provideInstance(dir),
        provideInstruction({ home: dir, config: dir }, { instructions: [path.join(dir, "rules", "api.md")] }),
      )
    }),
  )

  it.live("injects matching path-scoped per-directory AGENTS.md", () =>
    Effect.gen(function* () {
      const dir = yield* tmpWithFiles({
        "src/AGENTS.md": ["---", "paths: src/api/**/*.ts", "---", "", "# API Directory Rule"].join("\n"),
        "src/api/user.ts": "export const user = true",
      })

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const results = yield* svc.resolve(
          [],
          path.join(dir, "src", "api", "user.ts"),
          MessageID.make("msg_message-scoped-agents-1"),
        )

        expect(results).toHaveLength(1)
        expect(results[0].filepath).toBe(path.join(dir, "src", "AGENTS.md"))
        expect(results[0].content).toContain("# API Directory Rule")
        expect(results[0].content).not.toContain("paths:")
      }).pipe(provideInstance(dir), provideInstruction({ home: dir, config: dir }))
    }),
  )

  it.live("does not inject non-matching path-scoped per-directory AGENTS.md", () =>
    Effect.gen(function* () {
      const dir = yield* tmpWithFiles({
        "src/AGENTS.md": ["---", "paths: src/api/**/*.ts", "---", "", "# API Directory Rule"].join("\n"),
        "src/ui/view.ts": "export const view = true",
      })

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const results = yield* svc.resolve(
          [],
          path.join(dir, "src", "ui", "view.ts"),
          MessageID.make("msg_message-scoped-agents-2"),
        )

        expect(results).toEqual([])
      }).pipe(provideInstance(dir), provideInstruction({ home: dir, config: dir }))
    }),
  )

  it.live("discovers .claude/rules only when Claude compatibility is enabled", () =>
    Effect.gen(function* () {
      const home = yield* tmpWithFiles({
        ".claude/rules/global.md": "# Global Claude Rule",
      })
      const dir = yield* tmpWithFiles({
        ".claude/rules/project.md": ["---", "paths: src/**/*.ts", "---", "", "# Project Claude Rule"].join("\n"),
        "src/file.ts": "export const value = 1",
      })

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const rules = yield* svc.system()
        const results = yield* svc.resolve(
          [],
          path.join(dir, "src", "file.ts"),
          MessageID.make("msg_message-scoped-3"),
        )

        expect(rules).toEqual([`Instructions from: ${path.join(home, ".claude", "rules", "global.md")}\n# Global Claude Rule`])
        expect(results).toHaveLength(1)
        expect(results[0].filepath).toBe(path.join(dir, ".claude", "rules", "project.md"))
      }).pipe(provideInstance(dir), provideInstruction({ home, config: home }))

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const rules = yield* svc.system()
        const results = yield* svc.resolve(
          [],
          path.join(dir, "src", "file.ts"),
          MessageID.make("msg_message-scoped-4"),
        )

        expect(rules).toEqual([])
        expect(results).toEqual([])
      }).pipe(provideInstance(dir), provideInstruction({ home, config: home }, {}, { disableClaudeCodePrompt: true }))

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const rules = yield* svc.system()
        const results = yield* svc.resolve(
          [],
          path.join(dir, "src", "file.ts"),
          MessageID.make("msg_message-scoped-5"),
        )

        expect(rules).toEqual([`Instructions from: ${path.join(home, ".claude", "rules", "global.md")}\n# Global Claude Rule`])
        expect(results).toEqual([])
      }).pipe(
        provideInstance(dir),
        provideInstruction({ home, config: home }),
        withEnv("KILO_DISABLE_PROJECT_CONFIG", "true"),
      )
    }),
  )
})
