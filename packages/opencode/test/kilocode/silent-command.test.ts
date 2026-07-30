import { describe, expect, test } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import { Command } from "../../src/command"
import { silentAgent } from "../../src/kilocode/cli/cmd/silent-command"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Command.defaultLayer, CrossSpawnSpawner.defaultLayer))

describe("silent agent-switch commands", () => {
  const commands = [
    {
      name: "code",
      source: "command" as const,
      agent: "code",
      silent: true,
    },
  ]

  test("resolves the configured agent without using the command body", () => {
    expect(silentAgent("/code", commands)).toBe("code")
    expect(silentAgent("/code ignored arguments", commands)).toBe("code")
  })

  it.live("exposes silent command frontmatter to clients", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const service = yield* Command.Service
          const command = yield* service.get("code")

          expect(command).toMatchObject({
            name: "code",
            agent: "code",
            silent: true,
            source: "command",
          })
          expect(silentAgent("/code", command ? [command] : [])).toBe("code")
        }),
      {
        git: true,
        config: {
          command: {
            code: {
              template: "This body must not be sent.",
              agent: "code",
              silent: true,
            },
          },
        },
      },
    ),
  )

  test("ignores commands that are not explicit silent agent switches", () => {
    expect(silentAgent("code", commands)).toBeUndefined()
    expect(silentAgent("/plan", commands)).toBeUndefined()
    expect(silentAgent("/code", [{ ...commands[0], silent: false }])).toBeUndefined()
    expect(silentAgent("/code", [{ ...commands[0], agent: undefined }])).toBeUndefined()
    expect(silentAgent("/code", [{ ...commands[0], source: "mcp" }])).toBeUndefined()
  })
})
