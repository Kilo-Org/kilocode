import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { describe, expect } from "bun:test"
import path from "node:path"
import { Effect, FileSystem, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { NodeFileSystem } from "@effect/platform-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { RuntimeFlags } from "../../../src/effect/runtime-flags"
import { Instruction } from "../../../src/session/instruction"
import { MessageID } from "../../../src/session/schema"
import { Global } from "@opencode-ai/core/global"
import { provideInstance, provideTmpdirInstance, testInstanceStoreLayer, tmpdirScoped } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"
import { TestConfig } from "../../fixture/config"
import { Config } from "../../../src/config/config"

const it = testEffect(
  Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), NodeFileSystem.layer, testInstanceStoreLayer, RuntimeFlags.layer()),
)

const configLayer = TestConfig.layer()

const layer = (dir: string, config = configLayer) =>
  AppNodeBuilder.build(Instruction.node, [
    [Config.node, config],
    [Global.node, Global.layerWith({ home: dir, config: dir })],
  ])

const write = (filepath: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.makeDirectory(path.dirname(filepath), { recursive: true })
    yield* fs.writeFileString(filepath, content)
  })

describe("instruction markdown substitutions", () => {
  for (const relative of [false, true]) {
    it.live(`loads trusted ${relative ? "home-relative" : "absolute"} recursive instruction globs`, () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped()
        const project = path.join(dir, "project")
        const home = path.join(dir, "global[profile]{one,two}")
        const item = path.join(home, ".shared-rules", "nested", "guide.md")
        const pattern = relative ? "~/.shared-rules/**/*.md" : path.join(home, ".shared-rules", "**", "*.md")
        yield* write(path.join(project, "README.md"), "project")
        yield* write(item, "Keep changes focused and verify their behavior.")
        const config = TestConfig.layer({
          get: () =>
            Effect.succeed({
              instructions: [pattern],
              instruction_origins: { [pattern]: { trusted: true, source: "global config" } },
            }),
        })

        yield* provideInstance(project)(
          Effect.gen(function* () {
            const svc = yield* Instruction.Service
            expect(yield* svc.system()).toEqual([
              `Instructions from: ${item}\nKeep changes focused and verify their behavior.`,
            ])
          }).pipe(Effect.provide(layer(home, config))),
        )
      }),
    )
  }

  for (const pattern of ["guide.md", "*.md"]) {
    it.live(`preserves literal ancestor directory names when loading ${pattern}`, () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped()
        const project = path.join(dir, "project")
        const home = path.join(dir, "global")
        const folder = path.join(home, "My[Docs]{one,two}")
        const item = path.join(folder, "guide.md")
        const extra = path.join(folder, "other.md")
        const instruction = path.join(folder, pattern)
        yield* write(path.join(project, "README.md"), "project")
        yield* write(item, "literal directory instructions")
        yield* write(extra, "additional instructions")
        yield* write(path.join(home, "MyDone", "guide.md"), "wrong directory instructions")
        const config = TestConfig.layer({
          get: () =>
            Effect.succeed({
              instructions: [instruction],
              instruction_origins: { [instruction]: { trusted: true, source: "global config" } },
            }),
        })

        yield* provideInstance(project)(
          Effect.gen(function* () {
            const svc = yield* Instruction.Service
            const expected = [
              `Instructions from: ${item}\nliteral directory instructions`,
              ...(pattern === "*.md" ? [`Instructions from: ${extra}\nadditional instructions`] : []),
            ]
            expect((yield* svc.system()).toSorted()).toEqual(expected.toSorted())
          }).pipe(Effect.provide(layer(home, config))),
        )
      }),
    )
  }

  it.live("expands wildcard directory segments below a literal directory prefix", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const project = path.join(dir, "project")
      const home = path.join(dir, "global[profile]")
      const pattern = path.join(home, "rules", "team-{a,b}", "*.md")
      yield* write(path.join(project, "README.md"), "project")
      const files = ["a", "b"].map((team) => path.join(home, "rules", `team-${team}`, "guide.md"))
      for (const file of files) yield* write(file, "team instructions")
      yield* write(path.join(home, "rules", "team-c", "guide.md"), "excluded team")
      const config = TestConfig.layer({
        get: () =>
          Effect.succeed({
            instructions: [pattern],
            instruction_origins: { [pattern]: { trusted: true, source: "global config" } },
          }),
      })

      yield* provideInstance(project)(
        Effect.gen(function* () {
          const svc = yield* Instruction.Service
          expect((yield* svc.system()).toSorted()).toEqual(
            files.map((file) => `Instructions from: ${file}\nteam instructions`).toSorted(),
          )
        }).pipe(Effect.provide(layer(home, config))),
      )
    }),
  )

  it.live("does not read outside-project files selected by an untrusted recursive instruction glob", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const project = path.join(dir, "project")
      const home = path.join(dir, "global")
      const pattern = path.join(home, "rules", "**", "*.md")
      yield* write(path.join(project, "README.md"), "project")
      yield* write(path.join(home, "rules", "nested", "private.md"), "private global instructions")
      const config = TestConfig.layer({
        get: () =>
          Effect.succeed({
            instructions: [pattern],
            instruction_origins: {
              [pattern]: { trusted: false, source: path.join(project, "kilo.json"), root: project },
            },
          }),
      })

      yield* provideInstance(project)(
        Effect.gen(function* () {
          const svc = yield* Instruction.Service
          expect(yield* svc.system()).toEqual([])
        }).pipe(Effect.provide(layer(home, config))),
      )
    }),
  )

  it.live("preserves trusted relative instructions when project config is disabled", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const prior = {
          flag: process.env.KILO_DISABLE_PROJECT_CONFIG,
          secret: process.env.KILO_INSTRUCTION_GLOBAL_PATTERN_SECRET,
        }
        process.env.KILO_DISABLE_PROJECT_CONFIG = "1"
        process.env.KILO_INSTRUCTION_GLOBAL_PATTERN_SECRET = "environment secret"
        return prior
      }),
      () =>
        Effect.gen(function* () {
          const dir = yield* tmpdirScoped()
          const project = path.join(dir, "project")
          const home = path.join(dir, "global")
          yield* write(path.join(project, "README.md"), "project")
          yield* write(
            path.join(home, "rules", "trusted.md"),
            "{env:KILO_INSTRUCTION_GLOBAL_PATTERN_SECRET}",
          )
          const config = TestConfig.layer({
            get: () =>
              Effect.succeed({
                instructions: ["rules/*.md"],
                instruction_origins: { "rules/*.md": { trusted: true, source: "global config" } },
              }),
          })

          yield* provideInstance(project)(
            Effect.gen(function* () {
              const svc = yield* Instruction.Service
              const results = yield* svc.system()
              expect(results.join("\n")).toContain("environment secret")
            }).pipe(Effect.provide(layer(home, config))),
          )
        }),
      (prior) =>
        Effect.sync(() => {
          if (prior.flag === undefined) delete process.env.KILO_DISABLE_PROJECT_CONFIG
          else process.env.KILO_DISABLE_PROJECT_CONFIG = prior.flag
          if (prior.secret === undefined) delete process.env.KILO_INSTRUCTION_GLOBAL_PATTERN_SECRET
          else process.env.KILO_INSTRUCTION_GLOBAL_PATTERN_SECRET = prior.secret
        }),
    ),
  )

  it.live("does not trust project markdown selected by a trusted relative instruction", () =>
    provideTmpdirInstance((dir) => {
      const config = TestConfig.layer({
        get: () =>
          Effect.succeed({
            instructions: ["AGENTS.md"],
            instruction_origins: { "AGENTS.md": { trusted: true, source: "global config" } },
          }),
      })
      return Effect.gen(function* () {
        const name = "KILO_INSTRUCTION_RELATIVE_SECRET"
        process.env[name] = "environment secret"
        yield* write(path.join(dir, "AGENTS.md"), `{env:${name}}`)

        const svc = yield* Instruction.Service
        const results = yield* svc.system()
        expect(results.join("\n")).not.toContain("environment secret")
        delete process.env[name]
      }).pipe(Effect.provide(layer(path.join(dir, "global"), config)))
    }),
  )

  it.live("does not trust a global-path instruction selected by project config", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const project = path.join(dir, "project")
      const home = path.join(dir, "global")
      const item = path.join(home, "private.md")
      const secret = path.join(dir, "secret.txt")
      const name = "KILO_INSTRUCTION_SELECTED_SECRET"
      process.env[name] = "environment secret"
      yield* write(path.join(project, "README.md"), "project")
      yield* write(secret, "file secret")
      yield* write(item, [`{file:${secret}}`, `{env:${name}}`].join("\n"))
      const config = TestConfig.layer({
        get: () =>
          Effect.succeed({
            instructions: [item],
            instruction_origins: {
              [item]: { trusted: false, source: path.join(project, "kilo.json"), root: project },
            },
          }),
      })

      yield* provideInstance(project)(
        Effect.gen(function* () {
          const svc = yield* Instruction.Service
          const results = yield* svc.system()
          expect(results.join("\n")).not.toContain("file secret")
          expect(results.join("\n")).not.toContain("environment secret")
        }).pipe(Effect.provide(layer(home, config))),
      )
      delete process.env[name]
    }),
  )

  it.live("trusts a global-path instruction declared by trusted config", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const project = path.join(dir, "project")
      const home = path.join(dir, "global")
      const item = path.join(home, "private.md")
      const secret = path.join(dir, "secret.txt")
      const name = "KILO_INSTRUCTION_TRUSTED_SECRET"
      process.env[name] = "environment secret"
      yield* write(path.join(project, "README.md"), "project")
      yield* write(secret, "file secret")
      yield* write(item, [`{file:${secret}}`, `{env:${name}}`].join("\n"))
      const config = TestConfig.layer({
        get: () =>
          Effect.succeed({
            instructions: [item],
            instruction_origins: { [item]: { trusted: true, source: "global config" } },
          }),
      })

      yield* provideInstance(project)(
        Effect.gen(function* () {
          const svc = yield* Instruction.Service
          const results = yield* svc.system()
          expect(results.join("\n")).toContain("file secret")
          expect(results.join("\n")).toContain("environment secret")
        }).pipe(Effect.provide(layer(home, config))),
      )
      delete process.env[name]
    }),
  )

  it.live("applies in-project file substitutions to nearby AGENTS.md", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* write(path.join(dir, "subdir", "guide.md"), "file content")
        yield* write(path.join(dir, "subdir", "AGENTS.md"), ["# Instructions", "", "{file:guide.md}"].join("\n"))
        yield* write(path.join(dir, "subdir", "nested", "file.ts"), "const value = 1")

        const svc = yield* Instruction.Service
        const results = yield* svc.resolve([], path.join(dir, "subdir", "nested", "file.ts"), MessageID.ascending())

        expect(results).toHaveLength(1)
        expect(results[0].content).toContain("file content")
        expect(results[0].content).not.toContain("{file:")
      }).pipe(Effect.provide(layer(path.join(dir, "global")))),
    ),
  )

  it.live("omits nearby project instructions with environment substitutions", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const name = "KILO_INSTRUCTION_PROJECT_SECRET"
        process.env[name] = "environment secret"
        yield* write(path.join(dir, "subdir", "AGENTS.md"), `{env:${name}}`)
        yield* write(path.join(dir, "subdir", "nested", "file.ts"), "const value = 1")

        const svc = yield* Instruction.Service
        const results = yield* svc.resolve([], path.join(dir, "subdir", "nested", "file.ts"), MessageID.ascending())

        expect(results).toEqual([])
        delete process.env[name]
      }).pipe(Effect.provide(layer(path.join(dir, "global")))),
    ),
  )

  it.live("preserves substitutions in trusted global instructions", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const name = "KILO_INSTRUCTION_GLOBAL_SECRET"
        process.env[name] = "environment secret"
        const home = path.join(dir, "global")
        yield* write(path.join(home, "guide.md"), "file secret")
        yield* write(path.join(home, "AGENTS.md"), [`{file:guide.md}`, `{env:${name}}`].join("\n"))

        const svc = yield* Instruction.Service
        const results = yield* svc.system()

        expect(results.join("\n")).toContain("file secret")
        expect(results.join("\n")).toContain("environment secret")
        delete process.env[name]
      }).pipe(Effect.provide(layer(path.join(dir, "global")))),
    ),
  )
})
