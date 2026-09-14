import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { Effect, Layer } from "effect"
import { Config } from "@/config/config"
import { InstanceBootstrap } from "@/project/bootstrap"
import { InstanceStore } from "@/project/instance-store"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Instruction } from "@/session/instruction"
import { Skill } from "@/skill"
import { ClaudeMigration } from "@/kilocode/config/claude-migration"
import { TestConfig } from "../../fixture/config"
import { provideTmpdirInstance, testInstanceStoreLayer, tmpdirScoped } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const base = AppNodeBuilder.build(
  LayerNode.group([CrossSpawnSpawner.node, LayerNodePlatform.filesystem, InstanceStore.node]),
  [
    [
      InstanceBootstrap.node,
      Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void })),
    ],
  ],
)

const configLayer = Layer.succeed(Config.Service, TestConfig.make())
const instructionLayer = AppNodeBuilder.build(Instruction.node, [
  [Config.node, configLayer],
  [Global.node, Global.layerWith({})],
  [RuntimeFlags.node, RuntimeFlags.layer({})],
])
const instructionIt = testEffect(base)
const provideInstruction = <A, E, R>(self: Effect.Effect<A, E, R>) => self.pipe(Effect.provide(instructionLayer))

const skillNode = AppNodeBuilder.build(Skill.node, [
  [Global.node, Global.layerWith({})],
  [RuntimeFlags.node, RuntimeFlags.layer({ disableExternalSkills: false, disableClaudeCodeSkills: false })],
])
const skillIt = testEffect(
  Layer.mergeAll(skillNode, AppNodeBuilder.build(CrossSpawnSpawner.node), testInstanceStoreLayer),
)

const withPaths = <A, E, R>(home: string, config: string, state: string, self: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const prev = {
        config: Global.Path.config,
        home: process.env.KILO_TEST_HOME,
        state: Global.Path.state,
      }
      process.env.KILO_TEST_HOME = home
      ;(Global.Path as { config: string; state: string }).config = config
      ;(Global.Path as { config: string; state: string }).state = state
      return prev
    }),
    () => self,
    (prev) =>
      Effect.sync(() => {
        if (prev.home === undefined) delete process.env.KILO_TEST_HOME
        else process.env.KILO_TEST_HOME = prev.home
        ;(Global.Path as { config: string; state: string }).config = prev.config
        ;(Global.Path as { config: string; state: string }).state = prev.state
      }),
  )

describe("Claude migration handoff", () => {
  instructionIt.live("loads copied instructions and ignores the global Claude source after handoff", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const global = yield* tmpdirScoped()
        const config = path.join(global, "config")
        const state = path.join(global, "state")
        const source = path.join(global, ".claude", "CLAUDE.md")
        yield* Effect.promise(() => fs.mkdir(path.dirname(source), { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(source, "Claude source"))

        yield* withPaths(
          global,
          config,
          state,
          Effect.gen(function* () {
            const result = yield* Effect.promise(() =>
              ClaudeMigration.run({ enabled: true, roots: { home: global, config, state } }),
            )
            expect(result.status).toBe("complete")
            const service = yield* Instruction.Service
            const paths = yield* service.systemPaths()
            expect(paths.has(path.join(config, "AGENTS.md"))).toBe(true)
            expect(paths.has(source)).toBe(false)
            expect(yield* service.system()).toEqual([
              `Instructions from: ${path.join(config, "AGENTS.md")}\nClaude source`,
            ])
          }).pipe(provideInstruction),
        )
      }),
    ),
  )

  skillIt.live("discovers the copied skill and excludes the global Claude skill after handoff", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const global = yield* tmpdirScoped()
        const config = path.join(global, "config")
        const state = path.join(global, "state")
        const source = path.join(global, ".claude", "skills", "migrated", "SKILL.md")
        yield* Effect.promise(() => fs.mkdir(path.dirname(source), { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(source, "Use the migrated skill."))

        yield* withPaths(
          global,
          config,
          state,
          Effect.gen(function* () {
            const result = yield* Effect.promise(() =>
              ClaudeMigration.run({ enabled: true, roots: { home: global, config, state } }),
            )
            expect(result.status).toBe("complete")
            const service = yield* Skill.Service
            const list = (yield* service.all()).filter(
              (item) => item.location !== Skill.BUILTIN_LOCATION && item.location !== "<built-in>",
            )
            expect(list.map((item) => item.name)).toEqual(["migrated"])
            expect(list[0]?.location).toContain(path.join(config, "skills", "migrated", "SKILL.md"))
            expect(list[0]?.location).not.toContain(path.join(global, ".claude"))
          }),
        )
      }),
    ),
  )
})
