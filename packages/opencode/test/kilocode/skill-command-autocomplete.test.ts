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

  // The slash-command path runs a template's `!`cmd`` shell without a permission
  // prompt, so it must only do so for trusted skills. A project-local skill is
  // untrusted, and Command.Info carries the flag the prompt executor gates on.
  it.live("marks project skills untrusted so their slash-command shell is disabled", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".kilo", "skill", "proj", "SKILL.md"),
              `---\nname: proj\ndescription: proj.\n---\n\nRun: !\`printf hi\`\n`,
            ),
          )

          const command = yield* Command.Service
          const proj = yield* command.get("proj")

          expect(proj?.source).toBe("skill")
          expect(proj?.trusted).toBe(false)
        }),
      { git: true },
    ),
  )

  it.live("applies a partial override to a skill command", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".kilo", "skill", "proj", "SKILL.md"),
              "---\nname: proj\ndescription: Project skill.\n---\n\nReview files.\n",
            ),
          )

          const command = yield* Command.Service
          const skill = yield* command.get("proj:skill")

          expect(skill?.source).toBe("skill")
          expect(skill?.model).toBe("anthropic/claude-sonnet")
          expect(skill?.variant).toBe("high")
        }),
      {
        git: true,
        config: {
          command: {
            proj: {
              model: "anthropic/claude-sonnet",
              variant: "high",
            },
          },
        },
      },
    ),
  )

  it.live("applies a skill alias override when a command has the same name", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".kilo", "skill", "review", "SKILL.md"),
              "---\nname: review\ndescription: Review skill.\n---\n\nReview files.\n",
            ),
          )

          const command = yield* Command.Service
          const skill = yield* command.get("review:skill")
          const list = yield* command.list()

          expect(skill?.source).toBe("skill")
          expect(skill?.model).toBe("anthropic/claude-sonnet")
          expect(list.filter((item) => item.source === "skill" && item.name === "review")).toHaveLength(1)
        }),
      {
        git: true,
        config: {
          command: {
            "review:skill": { model: "anthropic/claude-sonnet" },
            review: { template: "Command content." },
          },
        },
      },
    ),
  )

  it.live("does not apply a missing MCP alias to a command with the same name", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const command = yield* Command.Service
          const plain = yield* command.get("review")
          const missing = yield* command.get("review:mcp")

          expect(plain?.model).toBeUndefined()
          expect(missing).toBeUndefined()
        }),
      {
        git: true,
        config: {
          command: {
            review: { template: "Command content." },
            "review:mcp": { model: "anthropic/claude-sonnet" },
          },
        },
      },
    ),
  )
})
