import path from "node:path"
import { symlink } from "node:fs/promises"
import { describe, expect } from "bun:test"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect, Layer } from "effect"
import { Config } from "@/config/config"
import { Planner } from "@/kilocode/stack/planner"
import { StackRuntime } from "@/kilocode/stack/runtime"
import { Stack } from "@/kilocode/stack/schema"
import { Skill } from "@/skill"
import { TestInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const mcp = Stack.ResourceRef.make("mcp:dbt")
const skill = Stack.ResourceRef.make("skill:demo-skill")
const defects = { config: false, skill: false }
const config = Layer.mock(Config.Service)({
  get: () =>
    defects.config
      ? Effect.die("config defect")
      : Effect.succeed({
          mcp: {
            dbt: { type: "local" as const, command: ["stale-dbt"], enabled: false },
          },
          skills: {},
        }),
  directories: () => Effect.succeed([]),
})
const skills = Layer.mock(Skill.Service)({
  all: () => (defects.skill ? Effect.die("skill defect") : Effect.succeed([])),
})
const runtime = StackRuntime.layer.pipe(
  Layer.provide(config),
  Layer.provide(skills),
  Layer.provide(AppFileSystem.defaultLayer),
)
const it = testEffect(Layer.mergeAll(runtime, AppFileSystem.defaultLayer))

describe("StackRuntime safety and live inventory", () => {
  it.instance(
    "rejects symlinked .kilo roots before staging or inventory",
    () =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const test = yield* TestInstance
        const outside = yield* fs.makeTempDirectoryScoped()
        yield* Effect.promise(() => symlink(outside, path.join(test.directory, ".kilo"), "dir"))
        const service = yield* StackRuntime.Service

        const stage = yield* Effect.flip(Effect.scoped(service.stage()))
        expect(stage._tag).toBe("StackRuntimeError")
        expect(stage.operation).toBe("stage")
        const inventory = yield* Effect.flip(service.inventory({}, [skill]))
        expect(inventory._tag).toBe("StackRuntimeError")
        expect(yield* fs.readDirectoryEntries(outside)).toEqual([])
      }),
    { git: true },
  )

  it.instance(
    "rejects a symlinked skills root before a transaction",
    () =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const test = yield* TestInstance
        const outside = yield* fs.makeTempDirectoryScoped()
        const kilo = path.join(test.directory, ".kilo")
        yield* fs.ensureDir(kilo)
        yield* Effect.promise(() => symlink(outside, path.join(kilo, "skills"), "dir"))
        const service = yield* StackRuntime.Service

        const error = yield* Effect.flip(Effect.scoped(service.transaction()))
        expect(error._tag).toBe("StackRuntimeError")
        expect(error.operation).toBe("transaction")
        expect(yield* fs.readDirectoryEntries(outside)).toEqual([])
      }),
    { git: true },
  )

  it.instance(
    "uses uncached inherited probes and ignores stale managed MCP cache entries",
    () =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const test = yield* TestInstance
        const service = yield* StackRuntime.Service
        yield* fs.writeFileString(
          path.join(test.directory, "kilo.jsonc"),
          '{ "mcp": { "dbt": { "type": "local", "command": ["dbt"], "enabled": false } } }\n',
        )
        const stack = path.join(test.directory, ".kilo", "kilo.jsonc")
        yield* fs.writeWithDirs(stack, '{ "skills": { "paths": ["custom-skills"] } }\n')
        const custom = path.join(test.directory, "custom-skills", "demo-skill", "SKILL.md")
        yield* fs.writeWithDirs(custom, "---\nname: demo-skill\n---\n\nInherited.\n")

        const fresh = yield* service.inventory({}, [mcp, skill], [mcp])
        expect(fresh.inherited).toEqual([mcp, skill])
        expect(yield* fs.readFileString(custom)).toContain("Inherited.")

        yield* fs.remove(path.join(test.directory, "kilo.jsonc"))
        yield* fs.remove(stack)
        const stale = yield* service.inventory({}, [mcp, skill], [mcp])
        expect(stale.inherited).toEqual([])
      }),
    { git: true },
  )

  it.instance(
    "maps Config and Skill defects to typed inventory errors",
    () =>
      Effect.gen(function* () {
        const service = yield* StackRuntime.Service
        defects.config = true
        const configError = yield* Effect.flip(service.inventory({}, [mcp])).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              defects.config = false
            }),
          ),
        )
        expect(configError._tag).toBe("StackRuntimeError")
        expect(configError.operation).toBe("inventory")

        defects.skill = true
        const skillError = yield* Effect.flip(service.inventory({}, [skill])).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              defects.skill = false
            }),
          ),
        )
        expect(skillError._tag).toBe("StackRuntimeError")
        expect(skillError.operation).toBe("inventory")
      }),
    { git: true },
  )

  it.instance(
    "decodes exact-target MCP entries exactly like Config.Info",
    () =>
      Effect.gen(function* () {
        const service = yield* StackRuntime.Service
        const canonical = yield* service.inventory(
          { dbt: { type: "local", command: ["dbt"], environment: { VALUE: "literal" }, enabled: false } },
          [mcp],
        )
        const alias = yield* service.inventory(
          { dbt: { type: "local", command: ["dbt"], env: { VALUE: "literal" }, enabled: false } },
          [mcp],
        )
        expect(alias.project[mcp]).toBe(canonical.project[mcp])
        expect(alias.project[mcp]).toBe(
          Planner.fingerprintMcp({
            type: "local",
            command: ["dbt"],
            environment: { VALUE: "literal" },
            enabled: false,
          }),
        )

        const legacy = yield* service.inventory({ dbt: { enabled: false } }, [mcp])
        expect(legacy.project[mcp]).toBe(Planner.fingerprintMcp({ enabled: false }))

        const invalid = [
          { type: "local", command: ["dbt"], unsupported: true },
          { type: "local", enabled: false },
          { enabled: false, unsupported: true },
        ]
        for (const value of invalid) {
          const error = yield* Effect.flip(service.inventory({ dbt: value }, [mcp]))
          expect(error._tag).toBe("StackRuntimeError")
          expect(error.resource).toBe(mcp)
        }
      }),
    { git: true },
  )
})
