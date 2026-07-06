import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Command } from "../../src/command"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Command.defaultLayer, CrossSpawnSpawner.defaultLayer))

describe("skill slash commands", () => {
  it.live("lists and resolves skills that conflict with commands", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".kilo", "skill", "review", "SKILL.md"),
              `---
name: review
description: Skill with command conflict.
---

# Review Skill

Skill content.
`,
            ),
          )

          const command = yield* Command.Service
          const list = yield* command.list()
          const matches = list.filter((item) => item.name === "review")

          expect(matches.some((item) => item.source === "command")).toBe(true)
          expect(matches.some((item) => item.source === "skill")).toBe(true)

          const cmd = yield* command.get("review")
          const skill = yield* command.get("review:skill")

          expect(cmd?.source).toBe("command")
          expect(skill?.source).toBe("skill")
          expect(yield* Effect.promise(async () => skill?.template)).toContain("Skill content.")
        }),
      {
        git: true,
        config: {
          command: {
            review: {
              template: "Command content.",
            },
          },
        },
      },
    ),
  )
})
