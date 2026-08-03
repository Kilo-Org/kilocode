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
  const input = {
    text: "/code",
    mode: "normal" as const,
    parts: 0,
    editor: "none" as const,
  }

  test("resolves an exact silent agent-switch command", () => {
    expect(silentAgent(input, commands)).toBe("code")
    expect(silentAgent({ ...input, text: "/code  " }, commands)).toBe("code")
    expect(silentAgent({ ...input, editor: "sent" }, commands)).toBe("code")
  })

  test("preserves commands with arguments or multiple lines for normal submission", () => {
    expect(silentAgent({ ...input, text: "/code fix the login bug" }, commands)).toBeUndefined()
    expect(silentAgent({ ...input, text: "/code\nfix the login bug" }, commands)).toBeUndefined()
    expect(silentAgent({ ...input, text: "/code\n" }, commands)).toBeUndefined()
  })

  test("preserves ineligible prompt states for normal submission", () => {
    expect(silentAgent({ ...input, mode: "shell" }, commands)).toBeUndefined()
    expect(silentAgent({ ...input, parts: 1 }, commands)).toBeUndefined()
    expect(silentAgent({ ...input, editor: "pending" }, commands)).toBeUndefined()
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
          expect(silentAgent(input, command ? [command] : [])).toBe("code")
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
    expect(silentAgent({ ...input, text: "code" }, commands)).toBeUndefined()
    expect(silentAgent({ ...input, text: "/plan" }, commands)).toBeUndefined()
    expect(silentAgent(input, [{ ...commands[0], silent: false }])).toBeUndefined()
    expect(silentAgent(input, [{ ...commands[0], agent: undefined }])).toBeUndefined()
    expect(silentAgent(input, [{ ...commands[0], source: "mcp" }])).toBeUndefined()
  })
})
