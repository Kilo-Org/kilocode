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

const it = testEffect(
  Layer.mergeAll(CrossSpawnSpawner.defaultLayer, NodeFileSystem.layer, testInstanceStoreLayer, RuntimeFlags.layer()),
)

const configLayer = TestConfig.layer()

const layer = (dir: string, config = configLayer) =>
  Instruction.layer.pipe(
    Layer.provide(config),
    Layer.provide(FSUtil.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Global.layerWith({ home: dir, config: dir })),
  )

const write = (filepath: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.makeDirectory(path.dirname(filepath), { recursive: true })
    yield* fs.writeFileString(filepath, content)
  })

describe("instruction markdown substitutions", () => {
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
