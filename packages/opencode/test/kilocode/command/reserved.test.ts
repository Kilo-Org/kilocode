import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Npm } from "@opencode-ai/core/npm"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { pathToFileURL } from "url"
import { Account } from "../../../src/account/account"
import { Auth } from "../../../src/auth"
import { Command } from "../../../src/command"
import { Config } from "../../../src/config/config"
import { RuntimeFlags } from "../../../src/effect/runtime-flags"
import { Plugin } from "../../../src/plugin/index"
import * as Reserved from "../../../src/kilocode/command/reserved"
import { AccountTest } from "../../fake/account"
import { AuthTest } from "../../fake/auth"
import { NpmTest } from "../../fake/npm"
import { TestInstance, provideTmpdirInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Command.node, Config.node, CrossSpawnSpawner.node])))

// One graph so Plugin and Command share a Config: a plugin registers its commands by
// mutating the loaded config, and the warning has to be derived from that same object.
const plugin = testEffect(
  LayerNode.compile(LayerNode.group([Plugin.node, Command.node, Config.node, CrossSpawnSpawner.node]), [
    [Auth.node, AuthTest.empty],
    [Account.node, AccountTest.empty],
    [Npm.node, NpmTest.noop],
    [RuntimeFlags.node, RuntimeFlags.layer({ disableDefaultPlugins: true })],
  ]),
)

describe("reserved command names", () => {
  test("reserves only the name that is intercepted before command lookup", () => {
    expect(Reserved.reserved("goal")).toBe(true)
    expect(Reserved.reserved("review")).toBe(false)
    // Resolved through the registry rather than intercepted, so they stay available.
    for (const name of ["compact", "summarize"]) expect(Reserved.reserved(name)).toBe(false)
    // McpCatalog keys prompts as `<client>:<prompt>`, so an MCP prompt cannot collide.
    expect(Reserved.reserved("myserver:goal")).toBe(false)
  })

  test("names both possible sources and the resolution in its warning", () => {
    const message = Reserved.notice("goal")

    expect(message).toContain('"goal" command registered by your config or a plugin')
    expect(message).toContain("reserved for Kilo's own command")
    expect(message).toContain("Rename it")
    expect(message).toContain("turn it off in the plugin that registers it")
    // No alias was registered, so there is nothing to point the user at.
    expect(message).not.toContain("instead")
  })

  test("names the alias in the warning when one is registered", () => {
    const message = Reserved.notice("goal", "goal:command")
    expect(message).toContain("Run yours as /goal:command instead.")
  })

  test("builds the alias as the reserved name plus the command-source suffix", () => {
    expect(Reserved.alias("goal")).toBe("goal:command")
  })

  describe("rename", () => {
    test("registers the alias for a full template definition", () => {
      expect(Reserved.rename({ goal: { template: "Plugin goal: $ARGUMENTS" } }, "goal")).toBe("goal:command")
    })

    test("has nothing to register for a template-less partial override", () => {
      expect(Reserved.rename({ goal: { model: "test/model" } }, "goal")).toBeUndefined()
    })

    test("defers to an explicit alias that defines its own template", () => {
      expect(
        Reserved.rename(
          {
            goal: { template: "Plugin goal: $ARGUMENTS" },
            "goal:command": { template: "Explicit alias" },
          },
          "goal",
        ),
      ).toBeUndefined()
    })

    test("still registers the alias when the explicit entry is template-less", () => {
      // A template-less `goal:command` is itself a partial override; it is meant to land on
      // top of the auto-registered alias via the deferred-override pass, not to block it.
      expect(
        Reserved.rename(
          {
            goal: { template: "Plugin goal: $ARGUMENTS" },
            "goal:command": { model: "test/model" },
          },
          "goal",
        ),
      ).toBe("goal:command")
    })
  })

  it.live("keeps every other command and exposes the clash as goal:command", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              command: {
                goal: { template: "Plugin goal: $ARGUMENTS", description: "Plugin goal" },
                ship: { template: "Ship it", description: "Ship the branch" },
              },
            }),
          ),
        )

        const command = yield* Command.Service
        const list = yield* command.list()
        const names = list.map((item) => item.name)

        expect(names).toContain("ship")
        expect(names).toContain("init")
        expect(names).toContain("review")
        expect(names).toContain("goal:command")
        expect(list.filter((item) => item.name === "goal")).toHaveLength(1)
        // Kilo's own /goal is untouched.
        expect(yield* command.get("goal")).toMatchObject({ source: "command", template: "$ARGUMENTS" })
        expect(yield* command.get("ship")).toMatchObject({ source: "command" })
        // The clashing template is reachable under the alias instead of being dropped.
        expect(yield* command.get("goal:command")).toMatchObject({
          source: "command",
          template: "Plugin goal: $ARGUMENTS",
          description: "Plugin goal",
        })
      }),
    ),
  )

  it.live("does not alias a template-less partial override", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ command: { goal: { model: "test/model" } } })),
        )

        const command = yield* Command.Service
        const list = yield* command.list()

        expect(list.map((item) => item.name)).not.toContain("goal:command")
        expect(yield* command.get("goal")).toMatchObject({ source: "command", template: "$ARGUMENTS" })

        const warnings = yield* Config.Service.use((svc) => svc.warnings())
        const message = warnings.find((item) => item.path === "command.goal")?.message
        expect(message).toBeDefined()
        expect(message).not.toContain("instead")
      }),
    ),
  )

  for (const order of ["alias-first", "goal-first"] as const) {
    it.live(`lets an explicit goal:command entry win regardless of key order (${order})`, () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const command = {
            "goal:command": { template: "Explicit alias" },
            goal: { template: "Plugin goal: $ARGUMENTS" },
          }
          const ordered =
            order === "alias-first" ? command : { goal: command.goal, "goal:command": command["goal:command"] }
          yield* Effect.promise(() => Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ command: ordered })))

          const svc = yield* Command.Service
          expect(yield* svc.get("goal:command")).toMatchObject({ source: "command", template: "Explicit alias" })
          expect(yield* svc.get("goal")).toMatchObject({ source: "command", template: "$ARGUMENTS" })
        }),
      ),
    )
  }

  it.live("reports a config-sourced clash as a config warning naming the alias", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({ command: { goal: { template: "Plugin goal: $ARGUMENTS" } } }),
          ),
        )

        const warnings = yield* Config.Service.use((svc) => svc.warnings())

        expect(warnings.some((item) => item.path === "command.goal")).toBe(true)
        const message = warnings.find((item) => item.path === "command.goal")?.message
        expect(message).toContain('"goal" command registered by your config or a plugin')
        expect(message).toContain("Run yours as /goal:command instead.")
      }),
    ),
  )

  plugin.instance("reports a plugin-registered clash as a config warning", () =>
    Effect.gen(function* () {
      // What Oh My OpenAgent does: register /goal from a plugin config hook, which runs
      // after config load, so the clash cannot be recorded while the config is read.
      const test = yield* TestInstance
      const file = path.join(test.directory, "plugin.ts")
      yield* Effect.promise(() =>
        Bun.write(
          file,
          [
            "export default async () => ({",
            "  config: (cfg) => {",
            "    cfg.command = cfg.command ?? {}",
            '    cfg.command.goal = { template: "Plugin goal: $ARGUMENTS" }',
            '    cfg.command.handoff = { template: "Hand off" }',
            "  },",
            "})",
            "",
          ].join("\n"),
        ),
      )
      yield* Effect.promise(() =>
        Bun.write(path.join(test.directory, "opencode.json"), JSON.stringify({ plugin: [pathToFileURL(file).href] })),
      )

      // Plugins load during startup in production; the hook has to have run before the
      // warning can be derived.
      yield* Plugin.Service.use((svc) => svc.list())

      const warnings = yield* Config.Service.use((svc) => svc.warnings())
      const message = warnings.find((item) => item.path === "command.goal")?.message
      expect(message).toContain('"goal" command registered by your config or a plugin')
      expect(message).toContain("Run yours as /goal:command instead.")

      // The plugin keeps every command that does not clash, and /goal stays Kilo's.
      const command = yield* Command.Service
      const list = yield* command.list()
      expect(list.map((item) => item.name)).toContain("handoff")
      expect(list.map((item) => item.name)).toContain("goal:command")
      expect(list.filter((item) => item.name === "goal")).toHaveLength(1)
      expect(yield* command.get("goal")).toMatchObject({ source: "command", template: "$ARGUMENTS" })
      // The plugin's own template is reachable under the alias.
      expect(yield* command.get("goal:command")).toMatchObject({
        source: "command",
        template: "Plugin goal: $ARGUMENTS",
      })
    }),
  )
})
