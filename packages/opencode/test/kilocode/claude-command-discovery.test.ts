import { describe, expect } from "bun:test"
import { ConfigProvider, Effect, Layer } from "effect"
import path from "path"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Command } from "../../src/command"
import { ClaudeCommands } from "../../src/kilocode/command/claude"
import { Git } from "../../src/git"
import { provideTmpdirInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const empty = ConfigProvider.layer(ConfigProvider.fromUnknown({}))
const base = Layer.mergeAll(Command.defaultLayer.pipe(Layer.provide(empty)), CrossSpawnSpawner.defaultLayer)
const disabled = (input: Record<string, string>) =>
  Layer.mergeAll(
    Command.defaultLayer.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(input)))),
    CrossSpawnSpawner.defaultLayer,
  )
const it = testEffect(base)
const flags = testEffect(disabled({ KILO_DISABLE_CLAUDE_CODE_COMMANDS: "true" }))
const broad = testEffect(disabled({ KILO_DISABLE_CLAUDE_CODE: "true" }))

function writeCommand(file: string, body: string) {
  return Effect.promise(async () => {
    await Bun.$`mkdir -p ${path.dirname(file)}`
    await Bun.write(file, body)
  })
}

function writeSkill(file: string, body: string) {
  return Effect.promise(async () => {
    await Bun.$`mkdir -p ${path.dirname(file)}`
    await Bun.write(file, body)
  })
}

describe("Claude command discovery", () => {
  it.live("lists project Claude commands with origin", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* writeCommand(path.join(dir, ".claude", "commands", "frontend", "component.md"), "Build component")

          const command = yield* Command.Service
          const item = (yield* command.list()).find((cmd) => cmd.name === "frontend/component")

          expect(item).toMatchObject({ name: "frontend/component", source: "command", origin: "claude" })
          expect(yield* Effect.promise(async () => item?.template)).toBe("Build component")
        }),
      { git: true },
    ),
  )

  it.live("discovers global Claude commands", () =>
    Effect.gen(function* () {
      const home = yield* tmpdirScoped()
      yield* provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            yield* writeCommand(path.join(home, ".claude", "commands", "global.md"), "Global command")

            const items = yield* ClaudeCommands.load({ directory: dir, worktree: dir, disabled: false }).pipe(
              Effect.provide(Global.layerWith({ home })),
              Effect.provide(FSUtil.defaultLayer),
              Effect.provide(Git.defaultLayer),
            )
            const item = items.global

            expect(item?.template).toBe("Global command")
          }),
        { git: true },
      )
    }),
  )

  it.live("keeps Kilo commands before Claude commands", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* writeCommand(path.join(dir, ".claude", "commands", "native.md"), "Claude command")

          const command = yield* Command.Service
          const item = yield* command.get("native")

          expect(item?.origin).toBeUndefined()
          expect(item?.source).toBe("command")
        }),
      { git: true, config: { command: { native: { template: "Kilo command" } } } },
    ),
  )

  flags.live("is disabled by the Claude command flag", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* writeCommand(path.join(dir, ".claude", "commands", "blocked.md"), "Blocked")

          const command = yield* Command.Service

          expect(yield* command.get("blocked")).toBeUndefined()
        }),
      { git: true },
    ),
  )

  broad.live("is disabled by the broad Claude flag", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* writeCommand(path.join(dir, ".claude", "commands", "blocked.md"), "Blocked")

          const command = yield* Command.Service

          expect(yield* command.get("blocked")).toBeUndefined()
        }),
      { git: true },
    ),
  )

  it.live("tags Claude skills as Claude slash commands", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* writeSkill(
            path.join(dir, ".claude", "skills", "helper", "SKILL.md"),
            "---\nname: helper\ndescription: Claude helper.\n---\n\nClaude skill",
          )

          const command = yield* Command.Service
          const item = yield* command.get("helper")

          expect(item).toMatchObject({ source: "skill", origin: "claude" })
        }),
      { git: true },
    ),
  )
})
