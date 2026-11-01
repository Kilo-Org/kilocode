import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { afterEach, expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { Agent } from "../../src/agent/agent"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { cacheKey } from "../../src/kilocode/agent"
import { MCP } from "../../src/mcp"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { InstanceBootstrap as InstanceBootstrapNode } from "../../src/project/bootstrap"
import { TestInstance, disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(LayerNode.group([Agent.node, Config.node]), [
    [MCP.node, Layer.mock(MCP.Service)({})],
    [RuntimeFlags.node, RuntimeFlags.layer({})],
    [
      InstanceBootstrapNode.node,
      Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void })),
    ],
  ]),
)

afterEach(async () => {
  await disposeAllInstances()
})

it.instance(
  "subagent_steps caps subagent and all-mode agents but leaves primary agents and explicit steps alone",
  () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service.use((svc) => svc.list())
      const find = (name: string) => agents.find((a) => a.name === name)

      expect(find("general")?.mode).toBe("subagent")
      expect(find("general")?.steps).toBe(5)
      expect(find("dual")?.mode).toBe("all")
      expect(find("dual")?.steps).toBe(5)
      expect(find("code")?.mode).toBe("primary")
      expect(find("code")?.steps).toBeUndefined()
      expect(find("budgeted")?.steps).toBe(99)
    }),
  {
    config: {
      subagent_steps: 5,
      agent: {
        dual: { description: "Runs as primary or subagent" },
        budgeted: { description: "Own budget", steps: 99 },
      },
    },
  },
)

it.instance(
  "subagent_steps stays unlimited when unset or zero",
  () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service.use((svc) => svc.list())
      expect(agents.find((a) => a.name === "general")?.steps).toBeUndefined()
      expect(agents.find((a) => a.name === "dual")?.steps).toBeUndefined()
    }),
  {
    config: {
      subagent_steps: 0,
      agent: { dual: { description: "Runs as primary or subagent" } },
    },
  },
)

it.instance("a runtime subagent_steps change invalidates the cached agents", () =>
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const config = yield* Config.Service
    const test = yield* TestInstance

    expect((yield* agents.get("general"))?.steps).toBeUndefined()

    // a live config edit: rewrite the project config and let the runtime reload it
    yield* Effect.promise(() =>
      Bun.write(path.join(test.directory, "kilo.json"), JSON.stringify({ subagent_steps: 7 })),
    )
    yield* config.invalidate()

    expect((yield* agents.get("general"))?.steps).toBe(7)
  }),
)

it.instance("cacheKey changes when subagent_steps changes", () =>
  Effect.gen(function* () {
    const cfg = yield* (yield* Config.Service).get()
    expect(cacheKey({ ...cfg, subagent_steps: 7 })).not.toBe(cacheKey(cfg))
  }),
)