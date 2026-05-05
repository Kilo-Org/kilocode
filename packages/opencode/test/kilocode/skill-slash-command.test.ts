import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Command } from "../../src/command"
import { Instance } from "../../src/project/instance"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Command.defaultLayer, CrossSpawnSpawner.defaultLayer))

afterEach(async () => {
  await Instance.disposeAll()
})

describe("skills as slash commands", () => {
  it.live("registers the built-in kilo-config skill under both /kilo-config and /skill:kilo-config", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const svc = yield* Command.Service
          const commands = yield* svc.list()

          const bare = commands.find((c) => c.name === "kilo-config")
          const aliased = commands.find((c) => c.name === "skill:kilo-config")

          expect(bare).toBeDefined()
          expect(bare!.source).toBe("skill")
          expect(aliased).toBeDefined()
          expect(aliased!.source).toBe("skill")
          expect(aliased!.description).toBe(bare!.description)

          // Both should resolve to the same skill content.
          const bareTemplate = yield* Effect.promise(async () => await bare!.template)
          const aliasedTemplate = yield* Effect.promise(async () => await aliased!.template)
          expect(bareTemplate).toBe(aliasedTemplate)
          expect(bareTemplate.length).toBeGreaterThan(0)
        }),
      { git: true },
    ),
  )

  it.live("keeps /skill:<name> reachable even when the bare name is shadowed by a user command", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          // Write a user command that collides with the built-in kilo-config skill name.
          yield* Effect.promise(() =>
            Bun.write(
              `${dir}/.kilo/command/kilo-config.md`,
              `---
description: user override command
---

user template body
`,
            ),
          )

          const svc = yield* Command.Service
          const commands = yield* svc.list()

          const bare = commands.find((c) => c.name === "kilo-config")
          const aliased = commands.find((c) => c.name === "skill:kilo-config")

          expect(bare).toBeDefined()
          expect(bare!.source).toBe("command")
          expect(aliased).toBeDefined()
          expect(aliased!.source).toBe("skill")

          const bareTemplate = yield* Effect.promise(async () => await bare!.template)
          const aliasedTemplate = yield* Effect.promise(async () => await aliased!.template)
          expect(bareTemplate).toContain("user template body")
          expect(aliasedTemplate).not.toBe(bareTemplate)
        }),
      { git: true },
    ),
  )
})
