import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { Command } from "../../../src/command"
import { MCP } from "../../../src/mcp"
import * as Reserved from "../../../src/kilocode/command/reserved"
import { provideTmpdirInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

// A reserved name arriving from an MCP server used to fail the whole list the same way a
// config one did, so both sources are covered.
const mcp = Layer.mock(MCP.Service)({
  prompts: () =>
    Effect.succeed({
      goal: { name: "goal", description: "Plugin goal", client: "plugin" },
      deploy: { name: "deploy", description: "Ship it", client: "plugin" },
    }),
})

const it = testEffect(
  LayerNode.compile(LayerNode.group([Command.node, CrossSpawnSpawner.node]), [[MCP.node, mcp]]),
)

describe("reserved command names", () => {
  test("names the source and the resolution in its warning", () => {
    expect(Reserved.reserved("goal")).toBe(true)
    expect(Reserved.reserved("review")).toBe(false)
    expect(Reserved.notice("goal", "command")).toContain('custom command named "goal"')
    expect(Reserved.notice("goal", "mcp")).toContain('MCP prompt named "goal"')
    for (const source of ["command", "mcp"] as const) {
      expect(Reserved.notice("goal", source)).toContain("reserved for Kilo's own command")
      expect(Reserved.notice("goal", source)).toContain("Rename it")
    }
  })

  it.live("keeps every other command when config claims a reserved name", () =>
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
        expect(list.filter((item) => item.name === "goal")).toHaveLength(1)
        expect(yield* command.get("goal")).toMatchObject({ source: "command", template: "$ARGUMENTS" })
        expect(yield* command.get("ship")).toMatchObject({ source: "command" })
      }),
    ),
  )

  it.live("keeps every other MCP prompt when one claims a reserved name", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const command = yield* Command.Service
        const list = yield* command.list()

        expect(yield* command.get("deploy")).toMatchObject({ source: "mcp" })
        expect(list.filter((item) => item.name === "goal")).toHaveLength(1)
        expect(yield* command.get("goal")).toMatchObject({ source: "command", template: "$ARGUMENTS" })
      }),
    ),
  )
})
